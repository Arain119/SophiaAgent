# Repository Organization

Sophia Agent ships one Core product. Repository boundaries should make that
single runtime easy to understand, test, and remove code from without
reintroducing compatibility layers.

## Sources of truth

- `docs/core-profile.md` defines the supported product surface.
- `SOPHIA.md` defines the concise development rules and architecture.
- `SOPHIA.md` is the repository's development and architecture guide.
- `package.json`, `scripts/defines.ts`, and `build.ts` define the executable
  build surface.

When documentation and implementation disagree, update both in the same
change. Do not preserve a removed feature only because an older architecture
document still mentions it.

## Ownership boundaries

| Area | Responsibility |
| --- | --- |
| `src/entrypoints`, `src/main.tsx` | Process bootstrap and public CLI routing |
| `src/query.ts`, `src/QueryEngine.ts` | Conversation and model/tool turn loop |
| `src/screens`, `src/components`, `src/state` | Ink UI and application state |
| `src/services` | Provider, MCP, plugin, compaction, and other service boundaries |
| `src/utils` | Shared infrastructure and pure helpers; do not add new feature domains here |
| `packages/builtin-tools` | Model-facing Core tool implementations |
| `packages/agent-tools` | Shared Agent tool contracts |
| `packages/mcp-client` | MCP client protocol implementation |
| `packages/workflow-engine` | Reusable workflow execution engine |
| `packages/@ant/ink` | Internal Ink runtime and design system |
| `packages/@ant/model-provider` | Internal message and provider conversion primitives |
| `packages/*-napi` | Native capability adapters with TypeScript fallbacks |

A package is justified only when it has a real reuse, runtime, or dependency
boundary. Product-specific orchestration belongs in `src/services`, not in a
new package or a generic utility module.

## Change boundaries

Large Core reductions should be reviewed in this order:

1. Remove unsupported features and their tests without changing retained
   behavior.
2. Align workspaces, dependencies, build inputs, and TypeScript paths.
3. Change provider and model behavior with focused adapter tests.
4. Update the CLI and Ink surface with integration coverage.
5. Remove stale documentation and physical directory remnants.

Keep mechanical deletion separate from behavioral fixes whenever practical.
Every retained import must resolve without relying on deleted compatibility
modules.

## Generated and runtime state

The following are not source and must remain ignored:

- `node_modules/` and interrupted installation directories
- `dist/`
- `.sophia/` and user session transcripts
- debug logs, coverage output, and temporary tool results

Interrupted installation directories may be deleted after verifying that the
active `node_modules/` tree and lockfile are intact.

## Verification gates

Run focused tests while changing a boundary, then finish with:

```bash
bun run typecheck
bun run lint
bun test
bun run build
bun run health
bun run check:bundle
```

TypeScript errors are release blockers. Lint configuration warnings should be
resolved before upgrading the formatter or linter in CI.
