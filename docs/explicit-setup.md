# Explicit Optional Setup

`bun install` and `npm install` have no Sophia Agent setup lifecycle hook.
They do not download a ripgrep binary, install Git hooks, change executable
permissions, or modify browser configuration.

Core works with a system `rg` available on `PATH`. Optional actions are:

```bash
# Download the pinned ripgrep helper and verify its SHA-256 digest.
bun run setup:ripgrep
```

Sophia has one Bun-only Core build:

```bash
bun run build
```
