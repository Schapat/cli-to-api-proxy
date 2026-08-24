# CLI-to-API Proxy

Use Claude CLI or Kiro CLI as an OpenAI-compatible API.

No API key? Use your existing CLI subscription in Paperclip, Open WebUI, Continue.dev, or any OpenAI-compatible app.

## Setup

```bash
git clone https://github.com/Schapat/cli-to-api-proxy.git
cd cli-to-api-proxy
npm install
npm start
```

Runs at `http://localhost:8082`

## Configuration

```bash
export PROXY_API_KEY=your-secret      # Required
export DEFAULT_PROVIDER=kiro          # 'claude' or 'kiro'
```

## Connect Apps

| Setting | Value |
|---------|-------|
| Base URL | `http://localhost:8082/v1` |
| API Key | Your `PROXY_API_KEY` |
| Model | `kiro/sonnet`, `claude/sonnet`, etc. |

## Models

**Kiro CLI** (free via AWS Builder ID):
`kiro/sonnet` · `kiro/opus` · `kiro/haiku`

**Claude CLI** (requires Claude Max):
`claude/sonnet` · `claude/opus` · `claude/haiku`

With version: `claude/sonnet-4` · `claude/sonnet-3.7` · `claude/opus-4`

## Requirements

One of these CLIs installed and authenticated:

```bash
# Kiro (free)
npm install -g @anthropic-ai/kiro-cli
kiro-cli auth login

# Claude (paid)
npm install -g @anthropic-ai/claude-cli
claude login
```

## Docker

```bash
docker run -d -p 8082:8082 \
  -e PROXY_API_KEY=secret \
  -v ~/.kiro:/root/.kiro:ro \
  ghcr.io/schapat/cli-to-api-proxy
```

## MCP Support (Optional)

Connect to an MCP server to give the CLI access to external tools (n8n, databases, etc.):

```bash
export MCP_SERVER_URL=http://localhost:5678/mcp-server/http
export MCP_API_KEY=your-mcp-token
npm start
```

The proxy injects available tools into the system prompt. The CLI can then use them.

## License

MIT
