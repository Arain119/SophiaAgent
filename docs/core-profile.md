# Sophia Agent Core Profile

Core is the only Sophia Agent product. It contains no optional compile-time
features. `build` and `dev` both use this single product surface.

## Core commands

Core exposes six built-in commands:

`/new`, `/resume`, `/effort`, `/usage`, `/exit`, and `/model`.

Built-in commands do not expose compatibility aliases. Skills, plugin prompt
commands, workflows, and MCP capabilities are model-facing only.

## Core model tools

The fixed model-facing contract contains 25 tools:

`Agent`, `TaskOutput`, `TaskStop`, `Bash`, `Glob`, `Grep`, `Read`, `Edit`,
`Write`, `WebFetch`, `WebSearch`, `WebBrowser`, `AskUserQuestion`, `TodoWrite`, `Skill`, `MCP`, `Plugin`,
`EnterPlanMode`, `ExitPlanMode`, `LocalMemoryRecall`, `Workflow`,
`CronCreate`, `CronDelete`, `CronList`, and `SSHRemote`.

Planning, Skills, and MCP discovery are model capabilities, not Slash commands. Sophia enters
and exits plan mode automatically for complex implementation work. The `Skill`
tool chooses a local Skill from the task description and may fetch an audited,
commit-pinned public Skill when no strong local match exists. `/plan`,
`/skills`, and direct `/skill-name` invocation do not exist.

The `MCP` tool is used only when a task needs an unavailable external-system
capability. It searches the official MCP Registry, validates transport and
package provenance, reports missing credentials, and connects only for the
current session. Plugin and MCP discovery are model-managed capabilities.

Memory maintenance and background-task monitoring are automatic. Running
agents, shells, workflows, and monitors remain visible in the live UI without
requiring `/memory` or `/tasks`.

## Configuration and providers

`/model` manages named OpenAI Responses providers. Each profile stores only
a Base URL and an API key. `/model` independently selects the exact model ID
and preferred provider for the main agent and for subagents.

New configurations default the main agent to `gpt-5.6-sol` and subagents to
`gpt-5.6-luna`, but both model IDs are editable.
/effort controls only the main-agent effort and accepts low, medium, high,
xhigh, or max. The default is medium. `--model` and `--fallback-model` do not
exist.
/usage reports the current session's token totals and calculates cost from the
fixed per-million-token rates for each model and cache category.
Provider profiles are not globally active. Removing a provider used by a model
route is blocked until `/model` points that route elsewhere. Removing the last
profile clears both model routes and leaves Sophia unconfigured.

There is no Anthropic Messages provider, Chat Completions provider,
model-account login, logout, model OAuth, provider registry, protocol alias,
model-family alias, or configuration migration. MCP servers may still use their
own OAuth flow because that belongs to MCP rather than model access.

WebBrowser and SSHRemote are always available to the model as Core tools and
are invoked only when the task requires them.

Core does not connect to, install, or manage external browser or IDE
extensions. Browser automation runs through Sophia's integrated Chromium
runtime, and remote host access runs through the built-in SSH tool. The
remaining Plugin capability is model-facing and is separate from external
extension bridges.

## Removed in v0.1

Full compatibility, Voice, Coordinator, Goal, Buddy, Artifacts, Vault,
Weixin, public Autonomy management, internal diagnostics, and arbitrary
`FEATURE_*` restoration are not products or supported extension points.

The breaking external contract is `~/.sophia`, `.sophia`, `SOPHIA.md`,
`.sophia-plugin`, `SOPHIA_*`, and the `sophia` executable.
Provider protocol names remain unchanged.
