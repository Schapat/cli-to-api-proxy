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

// Provider type
type Provider = 'claude' | 'kiro';

// ============================================================================
// CLAUDE CLI MODEL MAPPING
// ============================================================================
// Claude CLI accepts either aliases (opus, sonnet, haiku, fable) or full model names.
// We map API model names to CLI-compatible names.
// Full model names are passed through directly to the CLI.

const CLAUDE_MODEL_MAP: Record<string, string> = {
  // === Claude 4 Models (Latest) ===
  'claude-opus-4-20250514': 'claude-opus-4-20250514',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'claude-fable-5': 'claude-fable-5',
  
  // === Claude 3.7 Models ===
  'claude-3-7-sonnet-20250219': 'claude-3-7-sonnet-20250219',
  'claude-3-7-sonnet-latest': 'claude-3-7-sonnet-20250219',
  
  // === Claude 3.5 Models ===
  'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620': 'claude-3-5-sonnet-20240620',
  'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
  'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
  
  // === Claude 3 Models ===
  'claude-3-opus-20240229': 'claude-3-opus-20240229',
  'claude-3-opus-latest': 'claude-3-opus-20240229',
  'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
  
  // === Simple Aliases (for convenience) ===
  'opus': 'opus',
  'sonnet': 'sonnet',
  'haiku': 'haiku',
  'fable': 'fable',
  
  // === Provider-prefixed aliases ===
  'claude/opus': 'opus',
  'claude/sonnet': 'sonnet',
  'claude/haiku': 'haiku',
  'claude/fable': 'fable',
  
  // === Provider-prefixed with versions ===
  'claude/opus-4': 'claude-opus-4-20250514',
  'claude/sonnet-4': 'claude-sonnet-4-20250514',
  'claude/sonnet-3.7': 'claude-3-7-sonnet-20250219',
  'claude/sonnet-3.5': 'claude-3-5-sonnet-20241022',
  'claude/haiku-3.5': 'claude-3-5-haiku-20241022',
  'claude/opus-3': 'claude-3-opus-20240229',
  'claude/sonnet-3': 'claude-3-sonnet-20240229',
  'claude/haiku-3': 'claude-3-haiku-20240307',
};

// ============================================================================
// KIRO CLI MODEL MAPPING
// ============================================================================
// Kiro CLI uses different model identifiers.
// Available: auto, claude-sonnet-4.6, claude-opus-4.5, claude-sonnet-4.5, 
//            claude-sonnet-4, claude-haiku-4.5
// Also: minimax-m2.5, minimax-m2.1, qwen3-coder-next

const KIRO_MODEL_MAP: Record<string, string> = {
  // === Kiro-prefixed models ===
  'kiro/sonnet': 'claude-sonnet-4.6',
  'kiro/opus': 'claude-opus-4.5',
  'kiro/haiku': 'claude-haiku-4.5',
  'kiro/auto': 'auto',
  
  // === Kiro with versions ===
  'kiro/sonnet-4.6': 'claude-sonnet-4.6',
  'kiro/sonnet-4.5': 'claude-sonnet-4.5',
  'kiro/sonnet-4': 'claude-sonnet-4',
  'kiro/opus-4.5': 'claude-opus-4.5',
  'kiro/haiku-4.5': 'claude-haiku-4.5',
  
  // === Kiro-specific models ===
  'kiro/minimax': 'minimax-m2.5',
  'kiro/minimax-2.5': 'minimax-m2.5',
  'kiro/minimax-2.1': 'minimax-m2.1',
  'kiro/qwen': 'qwen3-coder-next',
  
  // === Legacy dash-style ===
  'kiro-sonnet': 'claude-sonnet-4.6',
  'kiro-opus': 'claude-opus-4.5',
  'kiro-haiku': 'claude-haiku-4.5',
};

// Parse model string to extract provider and model
// Format: "provider/model" or just "model"
function parseModel(modelStr: string): { provider: Provider; model: string } {
  // Check for explicit kiro provider prefix
  if (modelStr.startsWith('kiro/') || modelStr.startsWith('kiro-')) {
    const kiroModel = KIRO_MODEL_MAP[modelStr];
    if (kiroModel) {
      return { provider: 'kiro', model: kiroModel };
    }
    // Unknown kiro model, try to use as-is (strip prefix)
    return { provider: 'kiro', model: modelStr.replace(/^kiro[-\/]/, '') };
  }
  
  // Check for explicit claude/anthropic provider prefix
  if (modelStr.startsWith('claude/') || modelStr.startsWith('anthropic/')) {
    const claudeModel = CLAUDE_MODEL_MAP[modelStr];
    if (claudeModel) {
      return { provider: 'claude', model: claudeModel };
    }
    // Strip prefix and try to use as-is
    const stripped = modelStr.replace(/^(claude|anthropic)\//, '');
    return { provider: 'claude', model: CLAUDE_MODEL_MAP[stripped] || stripped };
  }

  // Check if it's a known Claude model (API format like claude-3-5-sonnet-20241022)
  if (CLAUDE_MODEL_MAP[modelStr]) {
  if (CLAUDE_MODEL_MAP[modelStr]) {
    return { provider: DEFAULT_PROVIDER as Provider, model: CLAUDE_MODEL_MAP[modelStr] };
  }

  // Check for simple CLI aliases - use default provider
  if (['sonnet', 'opus', 'haiku', 'auto'].includes(modelStr)) {
    if (DEFAULT_PROVIDER === 'kiro') {
      return { provider: 'kiro', model: KIRO_MODEL_MAP[modelStr] || modelStr };
    }
    return { provider: 'claude', model: modelStr };
  }

  // Default: use default provider with model as-is
  return { provider: DEFAULT_PROVIDER as Provider, model: modelStr };
}

// Logging
const log = (level: string, message: string, data?: unknown) => {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...(data ? { data } : {}) }));
};

// Authentication middleware
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  if (!REQUIRE_AUTH) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string;
  
  let providedKey: string | undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  if (!providedKey) {
    log('warn', 'Authentication failed: No API key provided');
    return res.status(401).json({
      type: 'error',
      error: {
        type: 'authentication_error',
        message: 'No API key provided. Use Authorization: Bearer <key> or x-api-key header.',
      },
    });
  }

  if (providedKey !== API_KEY) {
    log('warn', 'Authentication failed: Invalid API key');
    return res.status(401).json({
      type: 'error',
      error: {
        type: 'authentication_error',
        message: 'Invalid API key.',
      },
    });
  }

  next();
};

// Types matching Anthropic API
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

interface MessagesRequest {
  model: string;
  max_tokens: number;
  messages: Message[];
  system?: string;
  stream?: boolean;
  temperature?: number;
}

interface MessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Convert messages to prompt
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

// Execute Claude CLI
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

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Pass model to CLI - accepts both aliases (sonnet, opus) and full names (claude-3-5-sonnet-20241022)
    if (model) {
      args.push('--model', model);
    }

    args.push(prompt);

    log('debug', 'Executing Claude CLI', { model });

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

// Execute Kiro CLI
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

    // For Kiro, we pass the prompt as the input argument
    const fullPrompt = systemPrompt 
      ? `System: ${systemPrompt}\n\n${prompt}`
      : prompt;
    
    args.push(fullPrompt);

    log('debug', 'Executing Kiro CLI', { model });

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

      // Clean up Kiro's ANSI codes and extra output
      let cleanOutput = stdout
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI codes
        .replace(/^\s*All tools are now trusted.*$/gm, '') // Remove trust warning
        .replace(/^\s*Agents can sometimes.*$/gm, '')
        .replace(/^\s*Learn more at.*$/gm, '')
        .replace(/^\s*▸ Time:.*$/gm, '') // Remove timing info
        .replace(/^\s*>\s*/gm, '') // Remove prompt markers
        .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
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

// Execute CLI based on provider
async function executeCli(
  provider: Provider,
  prompt: string,
  systemPrompt?: string,
  model?: string
): Promise<{ response: string; exitCode: number }> {
  if (provider === 'kiro') {
    return executeKiroCli(prompt, systemPrompt, model);
  }
  return executeClaudeCli(prompt, systemPrompt, model);
}

// Streaming execution for Claude CLI
async function* executeClaudeCliStream(
  prompt: string,
  systemPrompt?: string,
  model?: string
): AsyncGenerator<string, void, unknown> {
  const args: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--no-session-persistence',
    '--dangerously-skip-permissions',
  ];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  // Pass model to CLI - accepts both aliases (sonnet, opus) and full names
  if (model) {
    args.push('--model', model);
  }

  args.push(prompt);

  log('debug', 'Executing Claude CLI (streaming)', { model });

  const child: ChildProcess = spawn(CLAUDE_CLI_PATH, args, {
    env: { ...process.env },
  });

  let buffer = '';

  const processBuffer = function* (): Generator<string, void, unknown> {
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'assistant' && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block.type === 'text' && block.text) {
                yield block.text;
              }
            }
          } else if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
  };

  if (child.stdout) {
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();
      yield* processBuffer();
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer);
      if (parsed.type === 'assistant' && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === 'text' && block.text) {
            yield block.text;
          }
        }
      }
    } catch {
      // If not JSON, yield as text if not empty
      const clean = buffer.trim();
      if (clean && !clean.startsWith('{')) {
        yield clean;
      }
    }
  }

  await new Promise<void>((resolve) => {
    child.on('close', () => resolve());
  });
}

// Streaming for Kiro (falls back to non-streaming since Kiro doesn't have stream-json)
async function* executeKiroCliStream(
  prompt: string,
  systemPrompt?: string,
  model?: string
): AsyncGenerator<string, void, unknown> {
  // Kiro doesn't support streaming output format, so we execute and yield result
  const { response } = await executeKiroCli(prompt, systemPrompt, model);
  yield response;
}

// Stream based on provider
async function* executeCliStream(
  provider: Provider,
  prompt: string,
  systemPrompt?: string,
  model?: string
): AsyncGenerator<string, void, unknown> {
  if (provider === 'kiro') {
    yield* executeKiroCliStream(prompt, systemPrompt, model);
  } else {
    yield* executeClaudeCliStream(prompt, systemPrompt, model);
  }
}

// Estimate tokens
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    providers: {
      claude: CLAUDE_CLI_PATH,
      kiro: KIRO_CLI_PATH,
    },
    defaultProvider: DEFAULT_PROVIDER,
    authRequired: REQUIRE_AUTH,
  });
});

// Info endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Claude & Kiro CLI Proxy',
    version: '2.0.0',
    description: 'Anthropic and OpenAI compatible API proxy for Claude CLI and Kiro CLI',
    endpoints: {
      anthropic: '/v1/messages',
      openai: '/v1/chat/completions',
      models: '/v1/models',
      health: '/health',
    },
    providers: ['claude', 'kiro'],
    defaultProvider: DEFAULT_PROVIDER,
    authentication: REQUIRE_AUTH ? 'Required (Bearer token or x-api-key)' : 'Disabled',
    modelFormat: 'Use "kiro/model" or "claude/model" to select provider, or just "model" for default',
  });
});

// Models endpoint
app.get('/v1/models', authenticate, (_req: Request, res: Response) => {
  const models = [
    // === Claude CLI Models ===
    // Latest (Claude 4)
    { id: 'claude/opus', name: 'Claude Opus (latest)', provider: 'claude' },
    { id: 'claude/sonnet', name: 'Claude Sonnet (latest)', provider: 'claude' },
    { id: 'claude/haiku', name: 'Claude Haiku (latest)', provider: 'claude' },
    { id: 'claude/fable', name: 'Claude Fable', provider: 'claude' },
    // With version numbers
    { id: 'claude/opus-4', name: 'Claude Opus 4', provider: 'claude' },
    { id: 'claude/sonnet-4', name: 'Claude Sonnet 4', provider: 'claude' },
    { id: 'claude/sonnet-3.7', name: 'Claude Sonnet 3.7', provider: 'claude' },
    { id: 'claude/sonnet-3.5', name: 'Claude Sonnet 3.5', provider: 'claude' },
    { id: 'claude/haiku-3.5', name: 'Claude Haiku 3.5', provider: 'claude' },
    { id: 'claude/opus-3', name: 'Claude Opus 3', provider: 'claude' },
    // Full API names
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4 (2025-05-14)', provider: 'claude' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (2025-05-14)', provider: 'claude' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (2025-02-19)', provider: 'claude' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (2024-10-22)', provider: 'claude' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (2024-10-22)', provider: 'claude' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (2024-02-29)', provider: 'claude' },
    
    // === Kiro CLI Models ===
    { id: 'kiro/sonnet', name: 'Claude Sonnet (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/opus', name: 'Claude Opus (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/haiku', name: 'Claude Haiku (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/auto', name: 'Auto (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/sonnet-4.6', name: 'Claude Sonnet 4.6 (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/opus-4.5', name: 'Claude Opus 4.5 (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/minimax', name: 'MiniMax M2.5 (via Kiro CLI)', provider: 'kiro' },
    { id: 'kiro/qwen', name: 'Qwen3 Coder (via Kiro CLI)', provider: 'kiro' },
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

// Messages API endpoint
app.post('/v1/messages', authenticate, async (req: Request, res: Response) => {
  const requestId = uuidv4();
  const { provider, model } = parseModel(req.body.model || 'sonnet');
  
  log('info', 'Received messages request', { 
    requestId, 
    stream: req.body.stream,
    requestedModel: req.body.model,
    provider,
    model,
  });

  try {
    const body: MessagesRequest = req.body;
    const prompt = messagesToPrompt(body.messages);

    if (body.stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const messageId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
      let fullText = '';
      let chunkCount = 0;

      const messageStart = {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: req.body.model || model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: estimateTokens(prompt), output_tokens: 0 },
        },
      };
      res.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);

      const blockStart = {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };
      res.write(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`);

      try {
        for await (const chunk of executeCliStream(provider, prompt, body.system, model)) {
          fullText += chunk;
          const delta = {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: chunk },
          };
          res.write(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
          chunkCount++;
        }
      } catch (error) {
        log('error', 'Streaming error', { requestId, error: (error as Error).message });
      }

      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);

      const messageDelta = {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: estimateTokens(fullText) },
      };
      res.write(`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`);

      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);

      res.end();
      log('info', 'Streaming response completed', { requestId, provider, chunks: chunkCount });

    } else {
      // Non-streaming response
      const { response } = await executeCli(provider, prompt, body.system, model);

      const result: MessagesResponse = {
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
      };

      log('info', 'Response completed', { requestId, provider, outputLength: response.length });
      res.json(result);
    }
  } catch (error) {
    log('error', 'Request failed', { requestId, provider, error: (error as Error).message });
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: (error as Error).message,
      },
    });
  }
});

// OpenAI Chat Completions API endpoint (for OpenAI-compatible clients like n8n)
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
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
  });

  try {
    const body: OpenAIChatRequest = req.body;
    
    // Extract system message and convert to prompt
    let systemPrompt: string | undefined;
    const chatMessages: Message[] = [];
    
    for (const msg of body.messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else {
        chatMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }
    
    const prompt = messagesToPrompt(chatMessages);

    if (body.stream) {
      // Streaming response (OpenAI format)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const completionId = `chatcmpl-${uuidv4().replace(/-/g, '').slice(0, 24)}`;
      let fullText = '';

      try {
        for await (const chunk of executeCliStream(provider, prompt, systemPrompt, model)) {
          fullText += chunk;
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
      } catch (error) {
        log('error', 'Streaming error', { requestId, error: (error as Error).message });
      }

      // Send final chunk
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
      log('info', 'OpenAI streaming response completed', { requestId, provider });

    } else {
      // Non-streaming response (OpenAI format)
      const { response } = await executeCli(provider, prompt, systemPrompt, model);

      const result = {
        id: `chatcmpl-${uuidv4().replace(/-/g, '').slice(0, 24)}`,
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
      };

      log('info', 'OpenAI response completed', { requestId, provider, outputLength: response.length });
      res.json(result);
    }
  } catch (error) {
    log('error', 'OpenAI request failed', { requestId, provider, error: (error as Error).message });
    res.status(500).json({
      error: {
        message: (error as Error).message,
        type: 'api_error',
        code: 'internal_error',
      },
    });
  }
});

// Start server
app.listen(Number(PORT), HOST, () => {
  log('info', 'CLI Proxy started', { 
    port: PORT, 
    host: HOST,
    claudeCli: CLAUDE_CLI_PATH,
    kiroCli: KIRO_CLI_PATH,
    defaultProvider: DEFAULT_PROVIDER,
    timeout: TIMEOUT_MS,
    authRequired: REQUIRE_AUTH,
  });
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                   Claude & Kiro CLI Proxy v2.0                       ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  API Endpoint: http://${HOST}:${PORT}/v1/messages                          ║
║  Health Check: http://${HOST}:${PORT}/health                               ║
║                                                                      ║
║  Authentication: ${REQUIRE_AUTH ? 'ENABLED' : 'DISABLED'}                                            ║
${REQUIRE_AUTH ? `║  API Key: ${API_KEY}                                      ║` : '║                                                                      ║'}
║                                                                      ║
║  Providers:                                                          ║
║    • claude - Claude CLI (${CLAUDE_CLI_PATH})                                    ║
║    • kiro   - Kiro CLI (${KIRO_CLI_PATH})                                      ║
║                                                                      ║
║  Default Provider: ${DEFAULT_PROVIDER}                                           ║
║                                                                      ║
║  Model Selection:                                                    ║
║    • "kiro/sonnet"   → Uses Kiro CLI with Sonnet                     ║
║    • "claude/sonnet" → Uses Claude CLI with Sonnet                   ║
║    • "sonnet"        → Uses ${DEFAULT_PROVIDER} CLI (default)                    ║
║                                                                      ║
║  Use in any Anthropic-compatible app:                                ║
║    Base URL: http://127.0.0.1:${PORT}                                     ║
║    API Key:  ${API_KEY}                                      ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
});

export default app;
