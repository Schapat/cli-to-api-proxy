# CLI-to-API Proxy
# Exposes Claude CLI and Kiro CLI through REST APIs
#
# IMPORTANT: This container needs access to the CLI binaries.
# Option 1: Mount host CLIs (recommended for local use)
# Option 2: Install CLIs in container (requires auth setup)

FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built files
COPY dist/ ./dist/

# Default environment variables
ENV PROXY_PORT=8082
ENV PROXY_HOST=0.0.0.0
ENV TIMEOUT_MS=300000
ENV DEFAULT_PROVIDER=claude

# CLI paths (override if mounted elsewhere)
ENV CLAUDE_CLI_PATH=/usr/local/bin/claude
ENV KIRO_CLI_PATH=/usr/local/bin/kiro-cli

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8082/health').then(r => process.exit(r.ok ? 0 : 1))" || exit 1

CMD ["node", "dist/index.js"]
