# CLI-to-API Proxy

Use Claude CLI or Kiro CLI as an OpenAI-compatible API.

No API key? Use your existing CLI subscription in Paperclip, Open WebUI, Continue.dev, or any OpenAI-compatible app.

## Setup

```bash
git clone https://github.com/Schapat/cli-to-api-proxy.git
cd cli-to-api-proxy
npm install
npm run setup
```

The setup wizard will:
- Check which CLIs are installed (and show install commands if missing)
- Let you pick a default provider (Kiro or Claude)
- Generate a random API key for your proxy
- Create the `.env` config file
- Show you the connection details for your apps

Then start:

```bash
npm start
```

## Connect Your Apps

Use these settings in Paperclip, Open WebUI, Continue.dev, etc:

| Setting | Value |
|---------|-------|
| Base URL | `http://localhost:8082/v1` |
| API Key | The key from setup (in `.env`) |
| Model | `kiro/sonnet`, `claude/sonnet`, etc. |

## Models

**Kiro CLI** (free via AWS Builder ID):
`kiro/sonnet` · `kiro/opus` · `kiro/haiku`

**Claude CLI** (requires Claude Max):
`claude/sonnet` · `claude/opus` · `claude/haiku`

With version: `claude/sonnet-4` · `claude/sonnet-3.7` · `claude/opus-4`

## Requirements

At least one CLI installed and authenticated:

```bash
# Kiro (free with AWS Builder ID)
npm install -g @anthropic-ai/kiro-cli
kiro-cli auth login

# Claude (requires Claude Max subscription)
npm install -g @anthropic-ai/claude-cli
claude login
```

## License

MIT
