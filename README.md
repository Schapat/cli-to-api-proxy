# CLI-to-API Proxy

**Use Claude CLI or Kiro CLI as an OpenAI-compatible API.**

No API key? No problem. Use your existing CLI subscriptions (Claude Max, Kiro/AWS Builder ID) in any app that supports OpenAI's API.

## Why?

You have **Claude CLI** or **Kiro CLI** working locally, but apps like Paperclip, Open WebUI, TypingMind, or Continue.dev need an API endpoint. This proxy bridges that gap.

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Paperclip  │         │             │         │ Claude CLI  │
│  Open WebUI │ ──────▶ │   Proxy     │ ──────▶ │    or       │
│  Any App    │ ◀────── │             │ ◀────── │  Kiro CLI   │
└─────────────┘         └─────────────┘         └─────────────┘
     HTTP API              localhost              Your CLI
```

## Quick Start

```bash
# Clone
git clone https://github.com/Schapat/cli-to-api-proxy.git
cd cli-to-api-proxy

# Install
npm install

# Run
npm start
```

The proxy runs at `http://localhost:8082/v1`

## Configuration

Set via environment variables or `.env` file:

```bash
# Required
PROXY_API_KEY=your-secret-key      # Protect your proxy

# Optional
PROXY_PORT=8082                     # Default: 8082
DEFAULT_PROVIDER=kiro               # 'claude' or 'kiro'
CLAUDE_CLI_PATH=claude              # Path to Claude CLI
KIRO_CLI_PATH=kiro-cli              # Path to Kiro CLI
```

## Connect Your Apps

### Paperclip
- API Base: `http://localhost:8082/v1`
- API Key: Your `PROXY_API_KEY`
- Model: `kiro/sonnet` or `claude/sonnet`

### Open WebUI
Settings → Connections → OpenAI API:
- Base URL: `http://localhost:8082/v1`
- API Key: Your `PROXY_API_KEY`

### Continue.dev
```json
// ~/.continue/config.json
{
  "models": [{
    "title": "Claude via CLI",
    "provider": "openai",
    "model": "claude/sonnet",
    "apiBase": "http://localhost:8082/v1",
    "apiKey": "your-proxy-key"
  }]
}
```

### TypingMind / ChatBox / LibreChat
Same pattern: Base URL + API Key + Model name.

### Python / curl
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8082/v1",
    api_key="your-proxy-key"
)

response = client.chat.completions.create(
    model="kiro/sonnet",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

```bash
curl http://localhost:8082/v1/chat/completions \
  -H "Authorization: Bearer your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "kiro/sonnet", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## Available Models

### Claude CLI
| Model | Description |
|-------|-------------|
| `claude/sonnet` | Latest Sonnet (default) |
| `claude/opus` | Latest Opus |
| `claude/haiku` | Latest Haiku |
| `claude/opus-4` | Claude Opus 4 |
| `claude/sonnet-4` | Claude Sonnet 4 |
| `claude/sonnet-3.7` | Claude Sonnet 3.7 |
| `claude/sonnet-3.5` | Claude Sonnet 3.5 |

### Kiro CLI
| Model | Description |
|-------|-------------|
| `kiro/sonnet` | Claude Sonnet 4.6 |
| `kiro/opus` | Claude Opus 4.5 |
| `kiro/haiku` | Claude Haiku 4.5 |
| `kiro/auto` | Auto-select |

## Docker

```bash
docker run -d \
  -p 8082:8082 \
  -e PROXY_API_KEY=your-secret \
  -v ~/.claude:/root/.claude:ro \
  -v ~/.kiro:/root/.kiro:ro \
  ghcr.io/schapat/cli-to-api-proxy:latest
```

Or with Docker Compose:

```yaml
services:
  cli-proxy:
    build: .
    ports:
      - "8082:8082"
    environment:
      - PROXY_API_KEY=your-secret
      - DEFAULT_PROVIDER=kiro
    volumes:
      - ~/.claude:/root/.claude:ro
      - ~/.kiro:/root/.kiro:ro
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat (streaming supported) |
| `GET /v1/models` | List available models |
| `GET /health` | Health check |

## Prerequisites

You need at least one CLI installed and authenticated:

### Claude CLI
```bash
# Install
npm install -g @anthropic-ai/claude-cli

# Login (requires Claude Max subscription)
claude login
```

### Kiro CLI
```bash
# Install
npm install -g @anthropic-ai/kiro-cli

# Login (free with AWS Builder ID)
kiro-cli auth login
```

## How It Works

1. App sends OpenAI-format request to proxy
2. Proxy converts to CLI command
3. CLI processes with your subscription
4. Proxy converts response back to OpenAI format
5. App receives response

No API costs - uses your existing CLI subscription.

## Limitations

- **Speed**: CLI is slower than native API (~3-10s per response)
- **No native tool/function calling**: Apps can't control tools (but CLI works fine for chat)
- **Rate limits**: Subject to your CLI subscription limits

## License

MIT

## Credits

Built for the community who want to use their CLI subscriptions everywhere.
