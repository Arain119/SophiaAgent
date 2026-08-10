#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

bun add --global sophiaagent@latest
echo "Sophia Agent installed. Run: sophia"
