import { readFileSync, existsSync } from 'fs';
import { spawn, ChildProcess } from 'child_process';

// ============================================================================
// TYPES
// ============================================================================

export interface ProxyConfig {
  port: number;
  host: string;
  apiKey: string;
  requireAuth: boolean;
  timeoutMs: number;
}

export interface ProviderConfig {
  enabled: boolean;
  cliPath: string;
  description?: string;
}

export interface MCPServerAuth {
  type: 'bearer' | 'api-key' | 'env' | 'none';
  token?: string;
  header?: string;
  variable?: string;
}

export interface MCPServerConfig {
  name: string;
  description?: string;
  enabled: boolean;
  transport: 'http-sse' | 'stdio';
  // HTTP-SSE transport
  url?: string;
  headers?: Record<string, string>;
  // Stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // Auth
  auth?: MCPServerAuth;
}

export interface MCPConfig {
  enabled: boolean;
  servers: MCPServerConfig[];
}

export interface ToolFilters {
  allowList: string[];
  denyList: string[];
  prefixWithServer: boolean;
}

export interface Config {
  proxy: ProxyConfig;
  providers: {
    default: 'claude' | 'kiro';
    claude: ProviderConfig;
    kiro: ProviderConfig;
  };
  mcp: MCPConfig;
  toolFilters: ToolFilters;
}

// ============================================================================
// CONFIG LOADING
// ============================================================================

function resolveEnvVars(value: string): string {
  // Replace ${VAR_NAME} with environment variable value
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

function resolveConfigEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveConfigEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveConfigEnvVars(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath?: string): Config {
  const defaultConfig: Config = {
    proxy: {
      port: parseInt(process.env.PROXY_PORT || '8082', 10),
      host: process.env.PROXY_HOST || '0.0.0.0',
      apiKey: process.env.PROXY_API_KEY || 'sk-cli-proxy-key',
      requireAuth: process.env.REQUIRE_AUTH !== 'false',
      timeoutMs: parseInt(process.env.TIMEOUT_MS || '300000', 10),
    },
    providers: {
      default: (process.env.DEFAULT_PROVIDER as 'claude' | 'kiro') || 'claude',
      claude: {
        enabled: true,
        cliPath: process.env.CLAUDE_CLI_PATH || 'claude',
      },
      kiro: {
        enabled: true,
        cliPath: process.env.KIRO_CLI_PATH || 'kiro-cli',
      },
    },
    mcp: {
      enabled: !!process.env.MCP_SERVER_URL,
      servers: process.env.MCP_SERVER_URL ? [{
        name: 'default',
        enabled: true,
        transport: 'http-sse',
        url: process.env.MCP_SERVER_URL,
        auth: {
          type: 'bearer',
          token: process.env.MCP_API_KEY || '',
        },
      }] : [],
    },
    toolFilters: {
      allowList: [],
      denyList: [],
      prefixWithServer: true,
    },
  };

  // Try to load config file
  const paths = [
    configPath,
    process.env.CONFIG_FILE,
    './config.json',
    './config.local.json',
  ].filter(Boolean) as string[];

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const fileContent = readFileSync(path, 'utf-8');
        const fileConfig = JSON.parse(fileContent);
        const resolvedConfig = resolveConfigEnvVars(fileConfig) as Partial<Config>;
        
        // Deep merge with defaults
        return deepMerge(defaultConfig, resolvedConfig);
      } catch (error) {
        console.error(`Failed to load config from ${path}:`, error);
      }
    }
  }

  return defaultConfig;
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = result[key];
    
    if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      if (targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
        result[key] = deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>
        ) as T[keyof T];
      } else {
        result[key] = sourceVal as T[keyof T];
      }
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  
  return result;
}

// ============================================================================
// MCP TOOL TYPES
// ============================================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  serverName?: string; // Added by proxy
}

export interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// ============================================================================
// MCP CLIENT - HTTP-SSE Transport
// ============================================================================

export class MCPHttpClient {
  private serverUrl: string;
  private headers: Record<string, string>;
  private tools: MCPTool[] = [];
  private initialized = false;
  private serverName: string;

  constructor(config: MCPServerConfig) {
    this.serverName = config.name;
    this.serverUrl = config.url || '';
    this.headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...config.headers,
    };

    // Setup auth
    if (config.auth) {
      switch (config.auth.type) {
        case 'bearer':
          if (config.auth.token) {
            this.headers['Authorization'] = `Bearer ${config.auth.token}`;
          }
          break;
        case 'api-key':
          if (config.auth.token && config.auth.header) {
            this.headers[config.auth.header] = config.auth.token;
          }
          break;
      }
    }
  }

  async initialize(): Promise<void> {
    if (!this.serverUrl) return;

    try {
      // Initialize MCP session
      const initResponse = await fetch(this.serverUrl, {
        method: 'POST',
        headers: this.headers,
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
        throw new Error(`Initialize returned ${initResponse.status}`);
      }

      // Fetch tools
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
      });

      if (!response.ok) {
        throw new Error(`tools/list returned ${response.status}`);
      }

      const text = await response.text();
      const result = this.parseSSEResponse(text);

      if (result?.result?.tools) {
        this.tools = result.result.tools.map((t: MCPTool) => ({
          ...t,
          serverName: this.serverName,
        }));
        this.initialized = true;
      }
    } catch (error) {
      console.error(`[${this.serverName}] MCP init failed:`, (error as Error).message);
    }
  }

  private parseSSEResponse(text: string): { result?: { tools?: MCPTool[] } } | null {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const response = await fetch(this.serverUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });

    const text = await response.text();
    const result = this.parseSSEResponse(text) as { result?: MCPToolResult; error?: { message: string } } | null;

    if (result?.error) {
      return { content: [{ type: 'text', text: `Error: ${result.error.message}` }], isError: true };
    }

    return result?.result || { content: [{ type: 'text', text: 'No result' }] };
  }
}

// ============================================================================
// MCP CLIENT - Stdio Transport
// ============================================================================

export class MCPStdioClient {
  private process: ChildProcess | null = null;
  private tools: MCPTool[] = [];
  private initialized = false;
  private serverName: string;
  private config: MCPServerConfig;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private buffer = '';

  constructor(config: MCPServerConfig) {
    this.serverName = config.name;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config.command) return;

    try {
      // Build environment
      const env = { ...process.env };
      if (this.config.env) {
        Object.assign(env, this.config.env);
      }
      if (this.config.auth?.type === 'env' && this.config.auth.variable) {
        const value = process.env[this.config.auth.variable];
        if (value) {
          env[this.config.auth.variable] = value;
        }
      }

      // Spawn process
      this.process = spawn(this.config.command, this.config.args || [], { env });

      // Handle stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        console.error(`[${this.serverName}] stderr:`, data.toString());
      });

      // Initialize
      await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'cli-to-api-proxy', version: '3.0' },
      });

      // Get tools
      const result = await this.sendRequest('tools/list', {}) as { tools?: MCPTool[] };
      if (result?.tools) {
        this.tools = result.tools.map(t => ({ ...t, serverName: this.serverName }));
        this.initialized = true;
      }
    } catch (error) {
      console.error(`[${this.serverName}] MCP init failed:`, (error as Error).message);
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.process?.stdin?.write(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      const result = await this.sendRequest('tools/call', { name, arguments: args }) as MCPToolResult;
      return result;
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
    }
  }

  shutdown(): void {
    this.process?.kill();
  }
}

// ============================================================================
// MCP MANAGER - Manages multiple MCP clients
// ============================================================================

export class MCPManager {
  private clients: Map<string, MCPHttpClient | MCPStdioClient> = new Map();
  private config: MCPConfig;
  private toolFilters: ToolFilters;

  constructor(mcpConfig: MCPConfig, toolFilters: ToolFilters) {
    this.config = mcpConfig;
    this.toolFilters = toolFilters;
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    const initPromises = this.config.servers
      .filter(server => server.enabled)
      .map(async (serverConfig) => {
        const client = serverConfig.transport === 'stdio'
          ? new MCPStdioClient(serverConfig)
          : new MCPHttpClient(serverConfig);

        await client.initialize();

        if (client.isReady()) {
          this.clients.set(serverConfig.name, client);
          console.log(`[MCP] Connected to ${serverConfig.name} (${client.getTools().length} tools)`);
        }
      });

    await Promise.all(initPromises);
  }

  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];

    for (const [serverName, client] of this.clients) {
      for (const tool of client.getTools()) {
        const toolName = this.toolFilters.prefixWithServer
          ? `${serverName}.${tool.name}`
          : tool.name;

        // Apply filters
        if (this.toolFilters.allowList.length > 0 && !this.toolFilters.allowList.includes(toolName)) {
          continue;
        }
        if (this.toolFilters.denyList.includes(toolName)) {
          continue;
        }

        tools.push({
          ...tool,
          name: toolName,
          serverName,
        });
      }
    }

    return tools;
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    // Parse server.tool format
    const [serverName, ...toolParts] = fullName.split('.');
    const toolName = this.toolFilters.prefixWithServer ? toolParts.join('.') : fullName;

    const client = this.clients.get(serverName);
    if (!client) {
      return { content: [{ type: 'text', text: `Unknown MCP server: ${serverName}` }], isError: true };
    }

    return client.callTool(toolName, args);
  }

  isEnabled(): boolean {
    return this.clients.size > 0;
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }

  shutdown(): void {
    for (const client of this.clients.values()) {
      if (client instanceof MCPStdioClient) {
        client.shutdown();
      }
    }
  }
}

export default { loadConfig, MCPManager };
