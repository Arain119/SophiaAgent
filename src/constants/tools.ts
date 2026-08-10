// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { TASK_OUTPUT_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskOutputTool/constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/ExitPlanModeTool/constants.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/EnterPlanModeTool/constants.js'
import { AGENT_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/AgentTool/constants.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/AskUserQuestionTool/prompt.js'
import { TASK_STOP_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskStopTool/prompt.js'
import { FILE_READ_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/FileReadTool/prompt.js'
import { TODO_WRITE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TodoWriteTool/constants.js'
import { GREP_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/GrepTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/WebFetchTool/prompt.js'
import { GLOB_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/GlobTool/prompt.js'
import { SHELL_TOOL_NAMES } from '../utils/shell/shellToolUtils.js'
import { FILE_EDIT_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/NotebookEditTool/constants.js'
import { SKILL_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/SkillTool/constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/SendMessageTool/constants.js'
import { TASK_CREATE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskCreateTool/constants.js'
import { TASK_GET_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskGetTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskUpdateTool/constants.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { TEAM_CREATE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TeamDeleteTool/constants.js'
import { ENTER_WORKTREE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/EnterWorktreeTool/constants.js'
import { EXIT_WORKTREE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/ExitWorktreeTool/constants.js'
import { WORKFLOW_TOOL_NAME } from '@sophia-agent/workflow-engine'
import {
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  CRON_LIST_TOOL_NAME,
} from '@sophia-agent/builtin-tools/tools/ScheduleCronTool/prompt.js'
import { LOCAL_MEMORY_RECALL_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/LocalMemoryRecallTool/constants.js'

export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME,
  EXIT_PLAN_MODE_V2_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  // Allow Agent tool for agents when user is ant (enables nested agents)
  ...(process.env.USER_TYPE === 'ant' ? [] : [AGENT_TOOL_NAME]),
  ASK_USER_QUESTION_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  // Prevent recursive workflow execution inside subagents.
  WORKFLOW_TOOL_NAME,
  // LOCAL-WIRING PR-1: keep local-memory recall on the main thread only.
  // Cross-session user notes shouldn't be siphoned by spawned subagents.
  // Layer 2 of the gate (fork path useExactTools) is enforced separately
  // by filterParentToolsForFork in src/utils/agentToolFilter.ts.
  LOCAL_MEMORY_RECALL_TOOL_NAME,
  // LOCAL-WIRING PR-2: vault HTTP fetch is even more sensitive (touches
  // user secrets). Same two-layer gate applies — keep main thread only.
])

export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
])

/*
 * Async Agent Tool Availability Status (Source of Truth)
 */
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  GREP_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  GLOB_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
  SKILL_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_NAME,
])
/**
 * Tools allowed only for in-process teammates (not general async agents).
 * These are injected by inProcessRunner.ts and allowed through filterToolsForAgent
 * via isInProcessTeammate() check.
 */
export const IN_PROCESS_TEAMMATE_ALLOWED_TOOLS = new Set([
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  // Teammate-created crons are tagged with the creating agentId and routed to
  // that teammate's pendingUserMessages queue (see useScheduledTasks.ts).
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  CRON_LIST_TOOL_NAME,
])

/*
 * BLOCKED FOR ASYNC AGENTS:
 * - AgentTool: Blocked to prevent recursion
 * - TaskOutputTool: Blocked to prevent recursion
 * - ExitPlanModeTool: Plan mode is a main thread abstraction.
 * - TaskStopTool: Requires access to main thread task state.
 *
 * ENABLE LATER (NEED WORK):
 * - MCPTool: TBD
 * - ListMcpResourcesTool: TBD
 * - ReadMcpResourceTool: TBD
 */
