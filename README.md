# CLI-to-API Proxy

**OpenAI-compatible REST API for Claude CLI and Kiro CLI with MCP tool support.**

Use Claude or Kiro CLI through any OpenAI-compatible application (n8n, Continue.dev, Open WebUI, custom apps) while maintaining access to MCP tools.

## Features

- 🔄 **OpenAI-compatible API** - Works with any app that supports OpenAI's chat completions API
- 🤖 **Dual Provider** - Use Claude CLI or Kiro CLI interchangeably
- 🔧 **MCP Tool Support** - Connect to any MCP server (n8n, GitHub, filesystem, databases, etc.)
- 🐳 **Docker Ready** - Easy deployment with Docker Compose
- ⚡ **Streaming** - Real-time streaming responses
- 🔐 **Authentication** - API key protection

## Quick Start

### 1. Install Dependencies

```bash
git clone https://github.com/Schapat/cli-to-api-proxy.git
cd cli-to-api-proxy
npm install
```

### 2. Configure

```bash
# Copy example config
cp config.example.json config.json

# Edit config.json with your settings
```

### 3. Run

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

### 4. Test

```bash
curl http://localhost:8082/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude/sonnet",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROXY_PORT` | Server port | `8082` |
| `PROXY_HOST` | Server host | `0.0.0.0` |
| `PROXY_API_KEY` | API key for authentication | `sk-cli-proxy-key` |
| `REQUIRE_AUTH` | Enable authentication | `true` |
| `DEFAULT_PROVIDER` | Default CLI provider | `claude` |
| `CLAUDE_CLI_PATH` | Path to Claude CLI | `claude` |
| `KIRO_CLI_PATH` | Path to Kiro CLI | `kiro-cli` |
| `CONFIG_FILE` | Path to config file | `config.json` |

### Config File (config.json)

```json
{
  "proxy": {
    "port": 8082,
    "apiKey": "your-secret-key"
  },
  "providers": {
    "default": "claude",
    "claude": { "enabled": true },
    "kiro": { "enabled": true }
  },
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "n8n",
        "url": "http://localhost:5678/mcp-server/http",
        "transport": "http-sse",
        "auth": { "type": "bearer", "token": "${N8N_MCP_TOKEN}" }
      }
    ]
  }
}
```

## MCP Server Configuration

The proxy supports connecting to multiple MCP servers simultaneously. Each server can use either **HTTP-SSE** or **stdio** transport.

### HTTP-SSE Transport (Remote Servers)

For HTTP-based MCP servers like n8n:

```json
{
  "name": "n8n",
  "description": "n8n workflow automation",
  "url": "http://localhost:5678/mcp-server/http",
  "transport": "http-sse",
  "auth": {
    "type": "bearer",
    "token": "${N8N_MCP_TOKEN}"
  },
  "enabled": true
}
```

### Stdio Transport (Local Processes)

For MCP servers that run as local processes:

```json
{
  "name": "filesystem",
  "description": "Local filesystem access",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
  "transport": "stdio",
  "enabled": true
}
```

### Authentication Types

| Type | Description | Example |
|------|-------------|---------|
| `bearer` | Bearer token in Authorization header | `"token": "${ENV_VAR}"` or `"token": "literal"` |
| `api-key` | Custom header with API key | `"header": "X-API-Key", "token": "..."` |
| `env` | Pass env var to stdio process | `"variable": "GITHUB_TOKEN"` |
| `none` | No authentication | - |

### Token References

Tokens can reference environment variables using `${VAR_NAME}` syntax:

```json
{
  "auth": {
    "type": "bearer",
    "token": "${N8N_MCP_TOKEN}"
  }
}
```

Then set the environment variable:
```bash
export N8N_MCP_TOKEN="eyJhbGciOi..."
```

## Popular MCP Server Examples

### n8n (Workflow Automation)

```json
{
  "name": "n8n",
  "url": "http://localhost:5678/mcp-server/http",
  "transport": "http-sse",
  "auth": { "type": "bearer", "token": "${N8N_MCP_TOKEN}" }
}
```

Get your token: n8n → Settings → MCP Servers → Connect a client → API key

### GitHub

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "transport": "stdio",
  "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
}
```

### PostgreSQL

```json
{
  "name": "postgres",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "${POSTGRES_URL}"],
  "transport": "stdio"
}
```

### Filesystem

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/documents"],
  "transport": "stdio"
}
```

### Slack

```json
{
  "name": "slack",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-slack"],
  "transport": "stdio",
  "env": { "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}" }
}
```

### Brave Search

```json
{
  "name": "brave-search",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "transport": "stdio",
  "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" }
}
```

## Model Selection

Use provider prefixes to select which CLI to use:

| Model | Provider | Description |
|-------|----------|-------------|
| `claude/sonnet` | Claude CLI | Latest Sonnet |
| `claude/opus` | Claude CLI | Latest Opus |
| `claude/opus-4` | Claude CLI | Claude Opus 4 |
| `claude/sonnet-3.7` | Claude CLI | Claude Sonnet 3.7 |
| `kiro/sonnet` | Kiro CLI | Sonnet via Kiro |
| `kiro/opus` | Kiro CLI | Opus via Kiro |
| `sonnet` | Default | Uses default provider |

## Docker Deployment

### Docker Compose

```yaml
version: '3.8'

services:
  cli-proxy:
    build: .
    ports:
      - "8082:8082"
    environment:
      - PROXY_API_KEY=your-secret-key
      - N8N_MCP_TOKEN=${N8N_MCP_TOKEN}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
    volumes:
      - ./config.json:/app/config.json:ro
      # Mount CLI configs for authentication
      - ~/.claude:/root/.claude:ro
      - ~/.kiro:/root/.kiro:ro
```

### Build & Run

```bash
docker compose up -d
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/messages` | POST | Anthropic-compatible messages |
| `/v1/models` | GET | List available models |
| `/v1/tools` | GET | List available MCP tools |
| `/health` | GET | Health check |

## Integration Examples

### n8n AI Assistant

1. In n8n: Settings → AI Assistants → Custom Model
2. Base URL: `http://localhost:8082/v1`
3. API Key: Your proxy API key
4. Model: `claude/sonnet` or `kiro/sonnet`

### Continue.dev

```json
// ~/.continue/config.json
{
  "models": [{
    "title": "Claude via Proxy",
    "provider": "openai",
    "model": "claude/sonnet",
    "apiBase": "http://localhost:8082/v1",
    "apiKey": "your-proxy-key"
  }]
}
```

### Open WebUI

1. Settings → Connections → OpenAI API
2. API Base URL: `http://localhost:8082/v1`
3. API Key: Your proxy API key

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8082/v1",
    api_key="your-proxy-key"
)

response = client.chat.completions.create(
    model="claude/sonnet",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### curl

```bash
curl http://localhost:8082/v1/chat/completions \
  -H "Authorization: Bearer your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude/sonnet",
    "messages": [{"role": "user", "content": "List my n8n workflows"}],
    "stream": false
  }'
```

## How MCP Tools Work

1. **Proxy connects** to configured MCP servers on startup
2. **Tools are discovered** and their descriptions loaded
3. **Tool descriptions** are injected into the system prompt
4. **CLI responds** with tool calls in a specific JSON format
5. **Proxy executes** the tool via MCP
6. **Result is fed back** to the CLI for final response

### Tool Call Format

The CLI is instructed to respond with:
```json
{"tool_call": {"name": "tool_name", "arguments": {"param": "value"}}}
```

The proxy intercepts this, executes the tool, and continues the conversation.

## Troubleshooting

### MCP Connection Failed

```bash
# Check MCP server is running
curl http://localhost:5678/mcp-server/http \
  -H "Authorization: Bearer $N8N_MCP_TOKEN" \
  -H "Accept: application/json, text/event-stream"

# Check proxy health
curl http://localhost:8082/health
```

### CLI Not Found

```bash
# Verify Claude CLI
which claude
claude --version

# Verify Kiro CLI  
which kiro-cli
kiro-cli --version
```

### Authentication Issues

- Ensure `PROXY_API_KEY` matches what you're sending
- Check MCP tokens are valid and not expired
- Verify environment variables are set: `echo $N8N_MCP_TOKEN`

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT License - see [LICENSE](LICENSE)

## Related Projects

- [Claude CLI](https://github.com/anthropics/claude-cli)
- [Kiro CLI](https://kiro.dev)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [n8n](https://n8n.io)
