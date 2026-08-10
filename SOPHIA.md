# Sophia Agent Development Guide

This repository contains Sophia Agent v0.1, a Bun-based terminal coding agent.
The product has one Core runtime and one automatic execution policy. TypeScript
strict mode is enabled and `bun run typecheck` must pass without errors.

## Runtime and build

- Runtime: Bun 1.3.11 or newer
- Module system: ESM with TypeScript/TSX
- Entrypoint: `src/entrypoints/cli.tsx`
- Build: `bun run build.ts`, producing `dist/cli.js` and `dist/cli-bun.js`
- Formatting and linting: Biome
- Tests: `bun:test`

The build has no optional product feature flags. `scripts/defines.ts` is the
single source for version and build constants.

## Core architecture

- `src/main.tsx` defines the CLI and interactive command surface.
- `src/query.ts` and `src/QueryEngine.ts` run the model/tool turn loop.
- `src/screens/REPL.tsx` renders the terminal interface.
- `src/tools.ts` assembles the model-facing tools from
  `packages/builtin-tools`.
- `src/state/` and `src/bootstrap/` hold session and application state.
- `src/services/api/` contains the OpenAI Responses transport and adapters.

The model-facing Core tools cover files, search, shell execution, web access,
the integrated browser, SSH, subagents, tasks, Skills, MCP, workflows, cron,
and local memory. Planning, Skills, MCP discovery, and background-task
coordination are automatic model decisions.

## Public contracts

- Executable: `sophia`
- Global state: `~/.sophia/`
- Project state: `.sophia/`
- Project instructions: `SOPHIA.md`
- Plugin manifests: `.sophia-plugin/`
- Environment variables: `SOPHIA_*`
- `/model` manages named OpenAI Responses profiles and configures the main and
  subagent models and their preferred providers.
- `/effort` changes the main-agent effort (`low`, `medium`, `high`, `xhigh`,
  or `max`).
- `/usage` shows session token usage, cache efficiency, and model cost.

Memory maintenance and background-task monitoring are automatic model and UI
capabilities; they are not user Slash commands.

There are no legacy command aliases, alternate model API formats, external
browser extensions, computer-control bridge, remote-control service, or OAuth
model login flow in v0.1.

## Verification

Run the complete local checks after changes:

```bash
bun run typecheck
bun run lint
bun test
bun run build
bun run health
```

Keep changes focused, preserve strict typing, and add tests for behavior that
crosses module boundaries or changes the public CLI contract.
