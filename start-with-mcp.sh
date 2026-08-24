#!/bin/bash

# CLI-to-API Proxy with MCP Support
# This script starts the proxy with n8n MCP server integration

# === Configuration ===
export PROXY_PORT=8082
export PROXY_API_KEY="sk-cli-proxy-12345"
export DEFAULT_PROVIDER="claude"

# === MCP Configuration ===
# Get these from n8n: Settings → MCP Servers → Connect a client → API key
export MCP_SERVER_URL="http://localhost:5678/mcp-server/http"
export MCP_API_KEY="${N8N_MCP_TOKEN:-your-n8n-mcp-token-here}"

# Check if MCP_API_KEY is set
if [ "$MCP_API_KEY" = "your-n8n-mcp-token-here" ]; then
    echo "⚠️  MCP_API_KEY not set!"
    echo ""
    echo "To enable MCP tools from n8n:"
    echo "1. In n8n, go to Settings → MCP Servers"
    echo "2. Click 'Connect a client' → 'API key' tab"
    echo "3. Copy the Access Token"
    echo "4. Run: export N8N_MCP_TOKEN='your-token-here'"
    echo "5. Then run this script again"
    echo ""
    echo "Starting proxy WITHOUT MCP support..."
    export MCP_SERVER_URL=""
fi

# Build if needed
if [ ! -f "dist/index-with-mcp.js" ]; then
    echo "Building..."
    npx tsc src/index-with-mcp.ts --outDir dist --esModuleInterop --resolveJsonModule --target ES2020 --module commonjs --skipLibCheck
fi

# Start the proxy
echo "Starting CLI-to-API Proxy with MCP..."
node dist/index-with-mcp.js
