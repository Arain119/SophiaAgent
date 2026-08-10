// builtin-tools — All tool implementations for Claude Code
// This barrel file re-exports the main tool constants and utilities.
// For specific submodules, use deep imports: 'builtin-tools/tools/XTool/XTool.js'

// =============================================================================
// Main tool exports (used by src/tools.ts)
// =============================================================================

// Core tools
export { AgentTool } from './tools/AgentTool/AgentTool.js'
export { AutoMcpTool } from './tools/AutoMcpTool/AutoMcpTool.js'
export { AutoPluginTool } from './tools/AutoPluginTool/AutoPluginTool.js'
export { AskUserQuestionTool } from './tools/AskUserQuestionTool/AskUserQuestionTool.js'
export { BashTool } from './tools/BashTool/BashTool.js'
export { EnterPlanModeTool } from './tools/EnterPlanModeTool/EnterPlanModeTool.js'
export { EnterWorktreeTool } from './tools/EnterWorktreeTool/EnterWorktreeTool.js'
export { ExitPlanModeV2Tool } from './tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
export { ExitWorktreeTool } from './tools/ExitWorktreeTool/ExitWorktreeTool.js'
export { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
export { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
export { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
export { GlobTool } from './tools/GlobTool/GlobTool.js'
export { GrepTool } from './tools/GrepTool/GrepTool.js'
export { LSPTool } from './tools/LSPTool/LSPTool.js'
export { ListMcpResourcesTool } from './tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
export { LocalMemoryRecallTool } from './tools/LocalMemoryRecallTool/LocalMemoryRecallTool.js'
export { ReadMcpResourceTool } from './tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
export { NotebookEditTool } from './tools/NotebookEditTool/NotebookEditTool.js'
export { SkillTool } from './tools/SkillTool/SkillTool.js'
export { TaskOutputTool } from './tools/TaskOutputTool/TaskOutputTool.js'
export { TaskStopTool } from './tools/TaskStopTool/TaskStopTool.js'
export { TodoWriteTool } from './tools/TodoWriteTool/TodoWriteTool.js'
export { WebFetchTool } from './tools/WebFetchTool/WebFetchTool.js'
export { TestingPermissionTool } from './tools/testing/TestingPermissionTool.js'

// Feature-gated tools
export { OVERFLOW_TEST_TOOL_NAME } from './tools/OverflowTestTool/OverflowTestTool.js'
export { ListPeersTool } from './tools/ListPeersTool/ListPeersTool.js'
export { PowerShellTool } from './tools/PowerShellTool/PowerShellTool.js'
export { REPLTool } from './tools/REPLTool/REPLTool.js'
export { CronCreateTool } from './tools/ScheduleCronTool/CronCreateTool.js'
export { CronDeleteTool } from './tools/ScheduleCronTool/CronDeleteTool.js'
export { CronListTool } from './tools/ScheduleCronTool/CronListTool.js'
export { SendMessageTool } from './tools/SendMessageTool/SendMessageTool.js'
export { SnipTool } from './tools/SnipTool/SnipTool.js'
export { TeamCreateTool } from './tools/TeamCreateTool/TeamCreateTool.js'
export { TeamDeleteTool } from './tools/TeamDeleteTool/TeamDeleteTool.js'
export { TerminalCaptureTool } from './tools/TerminalCaptureTool/TerminalCaptureTool.js'
export { VerifyPlanExecutionTool } from './tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.js'
export { WebBrowserTool } from './tools/WebBrowserTool/WebBrowserTool.js'
// WorkflowTool 实现已迁移到 @sophia-agent/workflow-engine（独立包，端口适配）。
// 注意：本 commit 移除了 builtin-tools 的 WorkflowTool 值导出和 getWorkflowCommands。
// - WorkflowTool 工厂：改由 @sophia-agent/workflow-engine 的 createWorkflowTool 提供
// - Named Workflow Slash commands were removed; the Workflow tool resolves names directly.
// 第三方若从本包 import 这两个符号，需切换到新路径。
export {
  createWorkflowTool,
  WORKFLOW_TOOL_NAME,
  type WorkflowToolDescriptor,
} from '@sophia-agent/workflow-engine'

// Constants
export {
  SYNTHETIC_OUTPUT_TOOL_NAME,
  createSyntheticOutputTool,
} from './tools/SyntheticOutputTool/SyntheticOutputTool.js'

// Shared utilities
export {
  tagMessagesWithToolUseID,
  getToolUseIDFromParentMessage,
} from './tools/utils.js'
