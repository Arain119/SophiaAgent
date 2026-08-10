/** Stable built-in command surface for the reduced Sophia Agent profile. */
export const CORE_COMMAND_NAMES = [
  'new',
  'resume',
  'effort',
  'usage',
  'model',
  'exit',
] as const

/** Stable model-facing tools retained by the reduced profile. */
export const CORE_TOOL_NAMES = [
  'Agent',
  'TaskOutput',
  'Bash',
  'Glob',
  'Grep',
  'ExitPlanMode',
  'Read',
  'Edit',
  'Write',
  'WebFetch',
  'TodoWrite',
  'WebBrowser',
  'TaskStop',
  'AskUserQuestion',
  'Skill',
  'MCP',
  'Plugin',
  'EnterPlanMode',
  'LocalMemoryRecall',
  'Workflow',
  'CronCreate',
  'CronDelete',
  'CronList',
  'SSHRemote',
] as const
