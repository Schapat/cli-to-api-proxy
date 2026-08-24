import express, { Request, Response, NextFunction } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Configuration
const PORT = process.env.PROXY_PORT || 8082;
const HOST = process.env.PROXY_HOST || '0.0.0.0';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '300000', 10);

// CLI Paths
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH || 'claude';
const KIRO_CLI_PATH = process.env.KIRO_CLI_PATH || 'kiro-cli';

// Default provider: 'claude' or 'kiro'
const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER || 'claude';

// API Key Configuration
const API_KEY = process.env.PROXY_API_KEY || 'sk-claude-proxy-key';
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false';

// MCP Configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || '';
const MCP_API_KEY = process.env.MCP_API_KEY || '';

// Provider type
type Provider = 'claude' | 'kiro';

// ============================================================================
// MCP CLIENT - Connects to n8n MCP Server
// ============================================================================

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

class MCPClient {
  private serverUrl: string;
  private apiKey: string;
  private tools: MCPTool[] = [];
  private initialized = false;

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl;
    this.apiKey = apiKey;
  }

  async initialize(): Promise<void> {
    if (!this.serverUrl) {
      log('info', 'MCP not configured - no server URL');
      return;
    }

    try {
      // First initialize the MCP session
      const initResponse = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'cli-to-api-proxy', version: '3.0' },
          },
        }),
      });

      if (!initResponse.ok) {
        throw new Error(`MCP initialize returned ${initResponse.status}`);
      }

      // Parse SSE response
      const initText = await initResponse.text();
      const initData = this.parseSSEResponse(initText);
      log('info', 'MCP session initialized', { serverInfo: initData?.result?.serverInfo });

      // Fetch available tools from MCP server
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
      });

      if (!response.ok) {
        throw new Error(`MCP server returned ${response.status}`);
      }

      // Parse SSE response
      const text = await response.text();
      const result = this.parseSSEResponse(text);
      
      if (result?.result?.tools) {
        this.tools = result.result.tools;
        this.initialized = true;
        log('info', 'MCP initialized', { toolCount: this.tools.length, tools: this.tools.map(t => t.name) });
      }
    } catch (error) {
      log('error', 'MCP initialization failed', { error: (error as Error).message });
    }
  }

  // Parse SSE response format (event: message\ndata: {...})
  private parseSSEResponse(text: string): unknown {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          // Continue looking
        }
      }
    }
    return null;
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  isEnabled(): boolean {
    return this.initialized && this.tools.length > 0;
  }

  // Convert MCP tools to OpenAI function format
  getOpenAITools(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }> {
    return this.tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  // Call a tool on the MCP server
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.initialized) {
      throw new Error('MCP client not initialized');
    }

    log('info', 'Calling MCP tool', { name, args });

    const response = await fetch(this.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP tool call failed: ${response.status}`);
    }

    const text = await response.text();
    const result = this.parseSSEResponse(text) as { result?: MCPToolResult; error?: { message: string } };
    
    if (result?.error) {
      return {
        content: [{ type: 'text', text: `Error: ${result.error.message}` }],
        isError: true,
      };
    }

    return result?.result || { content: [{ type: 'text', text: 'No result' }] };
  }

  // Generate system prompt addition for tools
  getToolsSystemPrompt(): string {
    if (!this.isEnabled()) return '';

    const toolDescriptions = this.tools.map(tool => {
      const params = tool.inputSchema.properties 
        ? Object.entries(tool.inputSchema.properties)
            .map(([key, val]: [string, unknown]) => `  - ${key}: ${(val as {description?: string}).description || 'No description'}`)
            .join('\n')
        : '  (no parameters)';
      
      return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
    }).join('\n\n');

    return `
## Available Tools

You have access to the following tools. To use a tool, respond with a JSON object in this exact format:

\`\`\`json
{"tool_call": {"name": "tool_name", "arguments": {"param1": "value1"}}}
\`\`\`

After receiving the tool result, continue your response incorporating the information.

${toolDescriptions}

Important: Only use tools when necessary. If you can answer without tools, do so directly.
`;
  }
}

// Global MCP client instance
const mcpClient = new MCPClient(MCP_SERVER_URL, MCP_API_KEY);

// ============================================================================
// MODEL MAPPINGS (same as before)
// ============================================================================

const CLAUDE_MODEL_MAP: Record<string, string> = {
  'claude-opus-4-20250514': 'claude-opus-4-20250514',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'claude-fable-5': 'claude-fable-5',
  'claude-3-7-sonnet-20250219': 'claude-3-7-sonnet-20250219',
  'claude-3-7-sonnet-latest': 'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620': 'claude-3-5-sonnet-20240620',
  'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
  'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229': 'claude-3-opus-20240229',
  'claude-3-opus-latest': 'claude-3-opus-20240229',
  'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
  'opus': 'opus',
  'sonnet': 'sonnet',
  'haiku': 'haiku',
  'fable': 'fable',
  'claude/opus': 'opus',
  'claude/sonnet': 'sonnet',
  'claude/haiku': 'haiku',
  'claude/fable': 'fable',
  'claude/opus-4': 'claude-opus-4-20250514',
  'claude/sonnet-4': 'claude-sonnet-4-20250514',
  'claude/sonnet-3.7': 'claude-3-7-sonnet-20250219',
  'claude/sonnet-3.5': 'claude-3-5-sonnet-20241022',
  'claude/haiku-3.5': 'claude-3-5-haiku-20241022',
  'claude/opus-3': 'claude-3-opus-20240229',
  'claude/sonnet-3': 'claude-3-sonnet-20240229',
  'claude/haiku-3': 'claude-3-haiku-20240307',
};

const KIRO_MODEL_MAP: Record<string, string> = {
  'kiro/sonnet': 'claude-sonnet-4.6',
  'kiro/opus': 'claude-opus-4.5',
  'kiro/haiku': 'claude-haiku-4.5',
  'kiro/auto': 'auto',
  'kiro/sonnet-4.6': 'claude-sonnet-4.6',
  'kiro/sonnet-4.5': 'claude-sonnet-4.5',
  'kiro/sonnet-4': 'claude-sonnet-4',
  'kiro/opus-4.5': 'claude-opus-4.5',
  'kiro/haiku-4.5': 'claude-haiku-4.5',
  'kiro/minimax': 'minimax-m2.5',
  'kiro/minimax-2.5': 'minimax-m2.5',
  'kiro/minimax-2.1': 'minimax-m2.1',
  'kiro/qwen': 'qwen3-coder-next',
  'kiro-sonnet': 'claude-sonnet-4.6',
  'kiro-opus': 'claude-opus-4.5',
  'kiro-haiku': 'claude-haiku-4.5',
};

function parseModel(modelStr: string): { provider: Provider; model: string } {
  if (modelStr.startsWith('kiro/') || modelStr.startsWith('kiro-')) {
    const kiroModel = KIRO_MODEL_MAP[modelStr];
    if (kiroModel) {
      return { provider: 'kiro', model: kiroModel };
    }
    return { provider: 'kiro', model: modelStr.replace(/^kiro[-\/]/, '') };
  }
  
  if (modelStr.startsWith('claude/') || modelStr.startsWith('anthropic/')) {
    const claudeModel = CLAUDE_MODEL_MAP[modelStr];
    if (claudeModel) {
      return { provider: 'claude', model: claudeModel };
    }
    const stripped = modelStr.replace(/^(claude|anthropic)\//, '');
    return { provider: 'claude', model: CLAUDE_MODEL_MAP[stripped] || stripped };
  }

  if (CLAUDE_MODEL_MAP[modelStr]) {
    return { provider: DEFAULT_PROVIDER as Provider, model: CLAUDE_MODEL_MAP[modelStr] };
  }

  if (['sonnet', 'opus', 'haiku', 'auto'].includes(modelStr)) {
    if (DEFAULT_PROVIDER === 'kiro') {
      return { provider: 'kiro', model: KIRO_MODEL_MAP[modelStr] || modelStr };
    }
    return { provider: 'claude', model: modelStr };
  }

  return { provider: DEFAULT_PROVIDER as Provider, model: modelStr };
}

// ============================================================================
// LOGGING & AUTH (same as before)
// ============================================================================

const log = (level: string, message: string, data?: unknown) => {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...(data ? { data } : {}) }));
};

const authenticate = (req: Request, res: Response, next: NextFunction) => {
  if (!REQUIRE_AUTH) return next();

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string;
  
  let providedKey: string | undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({
      type: 'error',
      error: { type: 'authentication_error', message: 'Invalid API key.' },
    });
  }

  next();
};

// ============================================================================
// CLI EXECUTION WITH TOOL HANDLING
// ============================================================================

interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

function messagesToPrompt(messages: Message[]): string {
  let prompt = '';
  
  for (const msg of messages) {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : msg.content.map(block => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_result') return `Tool result for ${block.tool_use_id}: ${block.content}`;
          return '';
        }).filter(Boolean).join('\n');
    
    if (msg.role === 'user') {
      prompt += `Human: ${content}\n\n`;
    } else if (msg.role === 'assistant') {
      prompt += `Assistant: ${content}\n\n`;
    }
  }
  
  return prompt.trim();
}

// Parse tool calls from response
function parseToolCalls(response: string): { text: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let text = response;

  // Look for JSON tool calls in the response
  const toolCallRegex = /```json\s*\n?\s*\{"tool_call":\s*(\{[^}]+\})\s*\}\s*\n?```/g;
  let match;

  while ((match = toolCallRegex.exec(response)) !== null) {
    try {
      const toolCall = JSON.parse(match[1]) as ToolCall;
      if (toolCall.name && toolCall.arguments !== undefined) {
        toolCalls.push(toolCall);
        text = text.replace(match[0], '').trim();
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Also try inline format: {"tool_call": {...}}
  const inlineRegex = /\{"tool_call":\s*\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[^}]*\})\s*\}\s*\}/g;
  while ((match = inlineRegex.exec(response)) !== null) {
    try {
      const toolCall: ToolCall = {
        name: match[1],
        arguments: JSON.parse(match[2]),
      };
      toolCalls.push(toolCall);
      text = text.replace(match[0], '').trim();
    } catch {
      // Not valid JSON, skip
    }
  }

  return { text, toolCalls };
}

async function executeClaudeCli(
  prompt: string,
  systemPrompt?: string,
  model?: string
): Promise<{ response: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '--print',
      '--output-format', 'text',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
    ];

    // Add MCP tools to system prompt if available
    let fullSystemPrompt = systemPrompt || '';
    if (mcpClient.isEnabled()) {
      fullSystemPrompt = fullSystemPrompt + '\n\n' + mcpClient.getToolsSystemPrompt();
    }

    if (fullSystemPrompt) {
      args.push('--system-prompt', fullSystemPrompt);
    }

    if (model) {
      args.push('--model', model);
    }

    args.push(prompt);

    log('debug', 'Executing Claude CLI', { model, hasTools: mcpClient.isEnabled() });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child: ChildProcess = spawn(CLAUDE_CLI_PATH, args, {
      env: { ...process.env },
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, TIMEOUT_MS);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error: Error) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Claude CLI execution failed: ${error.message}`));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutHandle);
      
      if (timedOut) {
        reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS}ms`));
        return;
      }

      if (!stdout && stderr) {
        reject(new Error(`Claude CLI error: ${stderr}`));
        return;
      }

      resolve({
        response: stdout.trim(),
        exitCode: code || 0,
      });
    });
  });
}

async function executeKiroCli(
  prompt: string,
  systemPrompt?: string,
  model?: string
): Promise<{ response: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      'chat',
      '--no-interactive',
      '--trust-all-tools',
      '--wrap', 'never',
    ];

    if (model) {
      args.push('--model', model);
    }

    // Add MCP tools to system prompt if available
    let fullSystemPrompt = systemPrompt || '';
    if (mcpClient.isEnabled()) {
      fullSystemPrompt = fullSystemPrompt + '\n\n' + mcpClient.getToolsSystemPrompt();
    }

    const fullPrompt = fullSystemPrompt 
      ? `System: ${fullSystemPrompt}\n\n${prompt}`
      : prompt;
    
    args.push(fullPrompt);

    log('debug', 'Executing Kiro CLI', { model, hasTools: mcpClient.isEnabled() });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child: ChildProcess = spawn(KIRO_CLI_PATH, args, {
      env: { ...process.env },
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, TIMEOUT_MS);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error: Error) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Kiro CLI execution failed: ${error.message}`));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutHandle);
      
      if (timedOut) {
        reject(new Error(`Kiro CLI timed out after ${TIMEOUT_MS}ms`));
        return;
      }

      let cleanOutput = stdout
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/^\s*All tools are now trusted.*$/gm, '')
        .replace(/^\s*Agents can sometimes.*$/gm, '')
        .replace(/^\s*Learn more at.*$/gm, '')
        .replace(/^\s*▸ Time:.*$/gm, '')
        .replace(/^\s*>\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!cleanOutput && stderr) {
        reject(new Error(`Kiro CLI error: ${stderr}`));
        return;
      }

      resolve({
        response: cleanOutput,
        exitCode: code || 0,
      });
    });
  });
}

// Execute CLI with automatic tool handling
async function executeCliWithTools(
  provider: Provider,
  prompt: string,
  systemPrompt?: string,
  model?: string,
  maxToolIterations = 5
): Promise<{ response: string; exitCode: number; toolsUsed: string[] }> {
  const toolsUsed: string[] = [];
  let currentPrompt = prompt;
  let iteration = 0;

  while (iteration < maxToolIterations) {
    iteration++;
    
    const executeFn = provider === 'kiro' ? executeKiroCli : executeClaudeCli;
    const result = await executeFn(currentPrompt, systemPrompt, model);

    // Check for tool calls in response
    const { text, toolCalls } = parseToolCalls(result.response);

    if (toolCalls.length === 0) {
      // No tool calls, return final response
      return { response: text || result.response, exitCode: result.exitCode, toolsUsed };
    }

    // Execute tool calls
    const toolResults: string[] = [];
    for (const toolCall of toolCalls) {
      try {
        log('info', 'Executing tool', { tool: toolCall.name, iteration });
        const toolResult = await mcpClient.callTool(toolCall.name, toolCall.arguments);
        const resultText = toolResult.content.map(c => c.text).join('\n');
        toolResults.push(`Tool "${toolCall.name}" result:\n${resultText}`);
        toolsUsed.push(toolCall.name);
      } catch (error) {
        toolResults.push(`Tool "${toolCall.name}" failed: ${(error as Error).message}`);
      }
    }

    // Build new prompt with tool results
    currentPrompt = `${prompt}\n\nPrevious response:\n${text}\n\nTool results:\n${toolResults.join('\n\n')}\n\nPlease continue your response incorporating the tool results above.`;
  }

  // Max iterations reached
  const executeFn = provider === 'kiro' ? executeKiroCli : executeClaudeCli;
  const finalResult = await executeFn(currentPrompt, systemPrompt, model);
  return { response: finalResult.response, exitCode: finalResult.exitCode, toolsUsed };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// ENDPOINTS
// ============================================================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    providers: { claude: CLAUDE_CLI_PATH, kiro: KIRO_CLI_PATH },
    defaultProvider: DEFAULT_PROVIDER,
    authRequired: REQUIRE_AUTH,
    mcp: {
      enabled: mcpClient.isEnabled(),
      serverUrl: MCP_SERVER_URL || null,
      toolCount: mcpClient.getTools().length,
    },
  });
});

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Claude & Kiro CLI Proxy with MCP',
    version: '3.0.0',
    description: 'Anthropic and OpenAI compatible API proxy with MCP tool support',
    endpoints: {
      anthropic: '/v1/messages',
      openai: '/v1/chat/completions',
      models: '/v1/models',
      tools: '/v1/tools',
      health: '/health',
    },
    mcp: {
      enabled: mcpClient.isEnabled(),
      tools: mcpClient.getTools().map(t => t.name),
    },
  });
});

// List available tools
app.get('/v1/tools', authenticate, (_req: Request, res: Response) => {
  res.json({
    tools: mcpClient.getOpenAITools(),
    mcp_enabled: mcpClient.isEnabled(),
  });
});

app.get('/v1/models', authenticate, (_req: Request, res: Response) => {
  const models = [
    { id: 'claude/opus', name: 'Claude Opus (latest)', provider: 'claude' },
    { id: 'claude/sonnet', name: 'Claude Sonnet (latest)', provider: 'claude' },
    { id: 'claude/haiku', name: 'Claude Haiku (latest)', provider: 'claude' },
    { id: 'claude/opus-4', name: 'Claude Opus 4', provider: 'claude' },
    { id: 'claude/sonnet-4', name: 'Claude Sonnet 4', provider: 'claude' },
    { id: 'claude/sonnet-3.7', name: 'Claude Sonnet 3.7', provider: 'claude' },
    { id: 'claude/sonnet-3.5', name: 'Claude Sonnet 3.5', provider: 'claude' },
    { id: 'kiro/sonnet', name: 'Claude Sonnet (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/opus', name: 'Claude Opus (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/haiku', name: 'Claude Haiku (via Kiro CLI)', provider: 'kiro' },
  ];

  res.json({
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: Date.now(),
      owned_by: 'anthropic',
      display_name: m.name,
      provider: m.provider,
    })),
  });
});

// OpenAI Chat Completions API with tool support
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

app.post('/v1/chat/completions', authenticate, async (req: Request, res: Response) => {
  const requestId = uuidv4();
  const { provider, model } = parseModel(req.body.model || 'sonnet');
  
  log('info', 'Received OpenAI chat request', { 
    requestId, 
    stream: req.body.stream,
    requestedModel: req.body.model,
    provider,
    model,
    hasTools: !!req.body.tools,
  });

  try {
    const body: OpenAIChatRequest = req.body;
    
    // Extract system message and convert to prompt
    let systemPrompt: string | undefined;
    const chatMessages: Message[] = [];
    
    for (const msg of body.messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else if (msg.role === 'tool') {
        // Handle tool results from client
        chatMessages.push({
          role: 'user',
          content: `Tool result (${msg.tool_call_id}): ${msg.content}`,
        });
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        // Handle assistant messages with tool calls
        chatMessages.push({
          role: 'assistant',
          content: `I need to use tools: ${msg.tool_calls.map(tc => tc.function.name).join(', ')}`,
        });
      } else {
        chatMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }
    
    const prompt = messagesToPrompt(chatMessages);

    // If client provides tools, add them to the system prompt
    if (body.tools && body.tools.length > 0) {
      const clientToolsPrompt = body.tools.map(tool => 
        `### ${tool.function.name}\n${tool.function.description}\nParameters: ${JSON.stringify(tool.function.parameters)}`
      ).join('\n\n');
      
      systemPrompt = (systemPrompt || '') + `\n\n## Client-Provided Tools\n\n${clientToolsPrompt}`;
    }

    // Execute with tool handling
    const { response, toolsUsed } = await executeCliWithTools(provider, prompt, systemPrompt, model);

    const completionId = `chatcmpl-${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    if (body.stream) {
      // Streaming response (OpenAI SSE format)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send the response in chunks to simulate streaming
      const words = response.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunk = (i === 0 ? '' : ' ') + words[i];
        const sseData = {
          id: completionId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: req.body.model || model,
          choices: [{
            index: 0,
            delta: { content: chunk },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(sseData)}\n\n`);
      }

      // Send final chunk with finish_reason
      const finalChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: req.body.model || model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

      log('info', 'Streaming response completed', { requestId, provider, outputLength: response.length, toolsUsed });
    } else {
      // Non-streaming response
      const result = {
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: req.body.model || model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response,
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: estimateTokens(prompt),
          completion_tokens: estimateTokens(response),
          total_tokens: estimateTokens(prompt) + estimateTokens(response),
        },
        _tools_used: toolsUsed,
      };

      log('info', 'Response completed', { requestId, provider, outputLength: response.length, toolsUsed });
      res.json(result);
    }

  } catch (error) {
    log('error', 'Request failed', { requestId, provider, error: (error as Error).message });
    res.status(500).json({
      error: {
        message: (error as Error).message,
        type: 'api_error',
        code: 'internal_error',
      },
    });
  }
});

// Anthropic Messages API (same as before but with tool support)
app.post('/v1/messages', authenticate, async (req: Request, res: Response) => {
  const requestId = uuidv4();
  const { provider, model } = parseModel(req.body.model || 'sonnet');
  
  log('info', 'Received messages request', { requestId, provider, model });

  try {
    const body = req.body;
    const prompt = messagesToPrompt(body.messages);

    const { response, toolsUsed } = await executeCliWithTools(provider, prompt, body.system, model);

    const result = {
      id: `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: response }],
      model: req.body.model || model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: estimateTokens(prompt),
        output_tokens: estimateTokens(response),
      },
      _tools_used: toolsUsed,
    };

    log('info', 'Response completed', { requestId, provider, toolsUsed });
    res.json(result);
  } catch (error) {
    log('error', 'Request failed', { requestId, provider, error: (error as Error).message });
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: (error as Error).message },
    });
  }
});

// ============================================================================
// STARTUP
// ============================================================================

async function start() {
  // Initialize MCP client
  if (MCP_SERVER_URL) {
    log('info', 'Initializing MCP client', { url: MCP_SERVER_URL });
    await mcpClient.initialize();
  }

  app.listen(Number(PORT), HOST, () => {
    log('info', 'CLI Proxy with MCP started', { 
      port: PORT, 
      host: HOST,
      mcpEnabled: mcpClient.isEnabled(),
      mcpTools: mcpClient.getTools().map(t => t.name),
    });
    
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              Claude & Kiro CLI Proxy v3.0 (with MCP)                 ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  API Endpoint: http://${HOST}:${PORT}/v1/chat/completions                  ║
║  Health Check: http://${HOST}:${PORT}/health                               ║
║  Tools List:   http://${HOST}:${PORT}/v1/tools                             ║
║                                                                      ║
║  MCP Status: ${mcpClient.isEnabled() ? '✅ ENABLED' : '❌ DISABLED'}                                           ║
${mcpClient.isEnabled() ? `║  MCP Tools:  ${mcpClient.getTools().map(t => t.name).join(', ').slice(0, 50)}...             ║` : '║                                                                      ║'}
║                                                                      ║
║  To enable MCP, set environment variables:                           ║
║    MCP_SERVER_URL=http://localhost:5678/mcp-server/http              ║
║    MCP_API_KEY=your-n8n-mcp-token                                    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);

export default app;
