# Claude & Kiro CLI Proxy

A local API proxy server that exposes **Claude CLI** and **Kiro CLI** through standard Anthropic and OpenAI-compatible REST APIs. This allows you to use your existing CLI subscriptions with any application that supports the Anthropic or OpenAI API format.

## Why Use This?

If you have a **Claude CLI** or **Kiro CLI** subscription, you can use this proxy to:

- ✅ Use your CLI subscription in **n8n**, **Paperclip**, **LangChain**, or any OpenAI/Anthropic-compatible app
- ✅ Avoid paying for separate API keys
- ✅ Switch between Claude CLI and Kiro CLI backends dynamically
- ✅ Run everything locally with your existing subscription

## Features

- 🔄 **Dual Provider Support** - Switch between Claude CLI and Kiro CLI on-the-fly
- 🌐 **Two API Formats**:
  - Anthropic Messages API (`/v1/messages`)
  - OpenAI Chat Completions API (`/v1/chat/completions`)
- 🔐 **API Key Authentication** - Secure your proxy with a configurable API key
- 📡 **Streaming Support** - Real-time streaming responses for both API formats
- 🎯 **Flexible Model Selection** - Use provider prefixes or standard model names
- ⚙️ **Fully Configurable** - Environment variables for all settings

---

## Quick Start

### Prerequisites

- **Node.js** 18+ 
- **Claude CLI** installed and authenticated (`claude --version`)
- **Kiro CLI** installed and authenticated (`kiro-cli --version`) *(optional)*

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/claude-cli-proxy.git
cd claude-cli-proxy

# Install dependencies
npm install

# Build the project
npm run build

# Start the proxy
npm start
```

The proxy will start on `http://127.0.0.1:8082` by default.

### Quick Test

```bash
curl -X POST http://127.0.0.1:8082/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cli-proxy-12345" \
  -d '{
    "model": "claude/sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## User Handbook

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info and documentation |
| `/health` | GET | Health check (no auth required) |
| `/v1/models` | GET | List available models |
| `/v1/messages` | POST | **Anthropic Messages API** |
| `/v1/chat/completions` | POST | **OpenAI Chat Completions API** |

### Authentication

All API endpoints (except `/health` and `/`) require authentication via:

- **Bearer Token**: `Authorization: Bearer YOUR_API_KEY`
- **API Key Header**: `x-api-key: YOUR_API_KEY`

Default API key: `sk-cli-proxy-12345` (configurable via `PROXY_API_KEY`)

### Model Selection

The proxy supports flexible model selection with provider prefixes:

#### Format: `provider/model`

| Model String | CLI Used | Backend Model |
|-------------|----------|---------------|
| `claude/sonnet` | Claude CLI | sonnet |
| `claude/opus` | Claude CLI | opus |
| `claude/haiku` | Claude CLI | haiku |
| `kiro/sonnet` | Kiro CLI | claude-sonnet-4.6 |
| `kiro/opus` | Kiro CLI | claude-opus-4.5 |
| `kiro/haiku` | Kiro CLI | claude-haiku-4.5 |

#### Simple Aliases (use default provider)

| Model String | Description |
|-------------|-------------|
| `sonnet` | Uses default provider with Sonnet |
| `opus` | Uses default provider with Opus |
| `haiku` | Uses default provider with Haiku |

#### Standard Anthropic Names (use default provider)

| Model String | Description |
|-------------|-------------|
| `claude-sonnet-4-20250514` | Latest Sonnet |
| `claude-opus-4-20250514` | Latest Opus |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet |

### API Examples

#### Anthropic Messages API

```bash
curl -X POST http://127.0.0.1:8082/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cli-proxy-12345" \
  -d '{
    "model": "kiro/sonnet",
    "max_tokens": 1024,
    "system": "You are a helpful assistant.",
    "messages": [
      {"role": "user", "content": "Explain quantum computing in simple terms."}
    ]
  }'
```

#### OpenAI Chat Completions API

```bash
curl -X POST http://127.0.0.1:8082/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cli-proxy-12345" \
  -d '{
    "model": "claude/sonnet",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Write a haiku about programming."}
    ]
  }'
```

#### Streaming Response

Add `"stream": true` to get real-time streaming:

```bash
curl -X POST http://127.0.0.1:8082/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cli-proxy-12345" \
  -d '{
    "model": "claude/sonnet",
    "stream": true,
    "messages": [{"role": "user", "content": "Count from 1 to 10 slowly."}]
  }'
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_PORT` | `8082` | Port to run the proxy on |
| `PROXY_HOST` | `0.0.0.0` | Host to bind to |
| `PROXY_API_KEY` | `sk-cli-proxy-12345` | API key for authentication |
| `REQUIRE_AUTH` | `true` | Enable/disable authentication |
| `DEFAULT_PROVIDER` | `claude` | Default CLI provider (`claude` or `kiro`) |
| `CLAUDE_CLI_PATH` | `claude` | Path to Claude CLI executable |
| `KIRO_CLI_PATH` | `kiro-cli` | Path to Kiro CLI executable |
| `TIMEOUT_MS` | `300000` | Request timeout in milliseconds |

### Example: Custom Configuration

```bash
PROXY_PORT=9000 \
PROXY_API_KEY="my-secret-key" \
DEFAULT_PROVIDER="kiro" \
npm start
```

---

## Integration Examples

### n8n (Self-Hosted)

1. Go to **Settings** → **AI Assistant** (or your AI node credentials)
2. Select **"Self-hosted or OpenAI-compatible endpoint"**
3. Configure:
   - **Base URL**: `http://127.0.0.1:8082/v1`
   - **API Key**: `sk-cli-proxy-12345`
   - **Model**: `claude/sonnet` or `kiro/sonnet`

### LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://127.0.0.1:8082/v1",
    api_key="sk-cli-proxy-12345",
    model="claude/sonnet"
)

response = llm.invoke("Hello, how are you?")
print(response.content)
```

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8082/v1",
    api_key="sk-cli-proxy-12345"
)

response = client.chat.completions.create(
    model="kiro/sonnet",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### cURL with Streaming

```bash
curl -N -X POST http://127.0.0.1:8082/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cli-proxy-12345" \
  -d '{"model": "claude/sonnet", "stream": true, "messages": [{"role": "user", "content": "Tell me a story"}]}'
```

---

## Running as a Service

### macOS (launchd)

Create `~/Library/LaunchAgents/com.claude-cli-proxy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-cli-proxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/claude-cli-proxy/dist/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PROXY_API_KEY</key>
        <string>your-secret-key</string>
    </dict>
</dict>
</plist>
```

Load with: `launchctl load ~/Library/LaunchAgents/com.claude-cli-proxy.plist`

### Linux (systemd)

Create `/etc/systemd/system/claude-cli-proxy.service`:

```ini
[Unit]
Description=Claude CLI Proxy
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/claude-cli-proxy
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=PROXY_API_KEY=your-secret-key

[Install]
WantedBy=multi-user.target
```

Enable with: `sudo systemctl enable --now claude-cli-proxy`

---

## Troubleshooting

### "Claude CLI not found"

Make sure Claude CLI is installed and in your PATH:
```bash
which claude
claude --version
```

### "Authentication failed"

Check that you're using the correct API key:
```bash
curl -H "Authorization: Bearer sk-cli-proxy-12345" http://127.0.0.1:8082/v1/models
```

### "Timeout" errors

The CLI can take 10-30 seconds for responses. Increase the timeout:
```bash
TIMEOUT_MS=600000 npm start
```

### Kiro CLI output is messy

The proxy automatically cleans ANSI codes and status messages from Kiro output. If issues persist, check your Kiro CLI version.

---

## Architecture

```
┌─────────────────────┐
│   Your App (n8n,    │
│   LangChain, etc.)  │
└──────────┬──────────┘
           │ HTTP Request
           ▼
┌─────────────────────┐
│   CLI Proxy Server  │
│   (This Project)    │
│                     │
│  /v1/messages       │ ◄── Anthropic API format
│  /v1/chat/completions│ ◄── OpenAI API format
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐
│ Claude  │ │  Kiro   │
│   CLI   │ │   CLI   │
└─────────┘ └─────────┘
     │           │
     ▼           ▼
┌─────────────────────┐
│   Claude Models     │
│   (via your sub)    │
└─────────────────────┘
```

---

## License

MIT License - feel free to use, modify, and distribute.

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

---

## Disclaimer

This project is not affiliated with Anthropic or AWS. It simply provides a bridge between CLI tools and standard API interfaces. Usage is subject to the terms of service of Claude CLI and Kiro CLI.
