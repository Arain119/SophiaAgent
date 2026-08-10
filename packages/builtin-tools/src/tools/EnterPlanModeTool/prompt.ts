import { isPlanModeInterviewPhaseEnabled } from 'src/utils/planModeV2.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../AskUserQuestionTool/prompt.js'

const WHAT_HAPPENS_SECTION = `## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Use ${ASK_USER_QUESTION_TOOL_NAME} only if a genuine product decision is unresolved
5. Write a concrete plan to the plan file
6. Exit plan mode with ExitPlanMode and continue implementation

`

function getEnterPlanModeToolPromptExternal(): string {
  // When interview phase is enabled, omit the "What Happens" section —
  // detailed workflow instructions arrive via the plan_mode attachment (messages.ts).
  const whatHappens = isPlanModeInterviewPhaseEnabled()
    ? ''
    : WHAT_HAPPENS_SECTION

  return `Use this tool proactively before a non-trivial implementation task when structured exploration will improve the result. This tool starts an internal planning workflow; it does not request user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation** — Adding meaningful new functionality where the implementation path isn't obvious
2. **Multiple Valid Approaches** — The task can be solved in several different ways
3. **Code Modifications** — Changes that affect existing behavior or structure and benefit from deliberate sequencing
4. **Architectural Decisions** — The task requires choosing between patterns or technologies
5. **Multi-File Changes** — The task will likely touch more than 2-3 files
6. **Unclear Requirements** — You need to explore before understanding the full scope
7. **User Preferences Matter** — Explore first, then use ${ASK_USER_QUESTION_TOOL_NAME} only for a concrete unresolved choice

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks (use the Agent tool with explore agent instead)

${whatHappens}## Important Notes

- Plan mode is internal and automatically returns to auto execution through ExitPlanMode
- Do not stop after planning; implement the plan after ExitPlanMode succeeds
`
}

function getEnterPlanModeToolPromptAnt(): string {
  // When interview phase is enabled, omit the "What Happens" section —
  // detailed workflow instructions arrive via the plan_mode attachment (messages.ts).
  const whatHappens = isPlanModeInterviewPhaseEnabled()
    ? ''
    : WHAT_HAPPENS_SECTION

  return `Use this tool when a task has genuine ambiguity about the right implementation approach. It starts an internal exploration and planning workflow without requesting user approval.

## When to Use This Tool

Plan mode is valuable when the implementation approach is genuinely unclear. Use it when:

1. **Significant Architectural Ambiguity** — Multiple reasonable approaches exist and the choice meaningfully affects the codebase
2. **Unclear Requirements** — You need to explore and clarify before you can make progress
3. **High-Impact Restructuring** — The task will significantly restructure existing code and benefits from an explicit plan

## When NOT to Use This Tool

Skip plan mode when you can reasonably infer the right approach:
- The task is straightforward even if it touches multiple files
- The user's request is specific enough that the implementation path is clear
- You're adding a feature with an obvious implementation pattern
- Bug fixes where the fix is clear once you understand the bug
- Research/exploration tasks (use the Agent tool instead)
- The user says something like "can we work on X" or "let's do X" — just get started

When in doubt, prefer starting work and using ${ASK_USER_QUESTION_TOOL_NAME} for specific questions over entering a full planning phase.

${whatHappens}## Important Notes

- Plan mode is internal; call ExitPlanMode when ready and continue implementation
`
}

export function getEnterPlanModeToolPrompt(): string {
  return process.env.USER_TYPE === 'ant'
    ? getEnterPlanModeToolPromptAnt()
    : getEnterPlanModeToolPromptExternal()
}
