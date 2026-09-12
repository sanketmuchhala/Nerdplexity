#!/bin/bash
# Nerdplexity development entry point
set -euo pipefail

echo "Starting Nerdplexity..."
echo "Server will run on http://127.0.0.1:${PORT:-5174}"
echo "Web app will run on http://127.0.0.1:${WEB_PORT:-5173}"
echo ""
echo "Ollama is optional. Start it separately with pnpm dev:ollama when needed."
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Start both server and web in parallel
pnpm dev
