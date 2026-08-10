// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { type Tool, type Tools } from './Tool.js'
import { AgentTool } from '@sophia-agent/builtin-tools/tools/AgentTool/AgentTool.js'
import { AutoMcpTool } from '@sophia-agent/builtin-tools/tools/AutoMcpTool/AutoMcpTool.js'
import { AutoPluginTool } from '@sophia-agent/builtin-tools/tools/AutoPluginTool/AutoPluginTool.js'
import { SkillTool } from '@sophia-agent/builtin-tools/tools/SkillTool/SkillTool.js'
import { BashTool } from '@sophia-agent/builtin-tools/tools/BashTool/BashTool.js'
import { FileEditTool } from '@sophia-agent/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@sophia-agent/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@sophia-agent/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '@sophia-agent/builtin-tools/tools/GlobTool/GlobTool.js'
import { WebFetchTool } from '@sophia-agent/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import { TaskStopTool } from '@sophia-agent/builtin-tools/tools/TaskStopTool/TaskStopTool.js'
import { TaskOutputTool } from '@sophia-agent/builtin-tools/tools/TaskOutputTool/TaskOutputTool.js'
import { WebBrowserTool } from '@sophia-agent/builtin-tools/tools/WebBrowserTool/WebBrowserTool.js'
import { TodoWriteTool } from '@sophia-agent/builtin-tools/tools/TodoWriteTool/TodoWriteTool.js'
import { ExitPlanModeV2Tool } from '@sophia-agent/builtin-tools/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { TestingPermissionTool } from '@sophia-agent/builtin-tools/tools/testing/TestingPermissionTool.js'
import { GrepTool } from '@sophia-agent/builtin-tools/tools/GrepTool/GrepTool.js'
import { AskUserQuestionTool } from '@sophia-agent/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { ListMcpResourcesTool } from '@sophia-agent/builtin-tools/tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from '@sophia-agent/builtin-tools/tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { EnterPlanModeTool } from '@sophia-agent/builtin-tools/tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { LocalMemoryRecallTool } from '@sophia-agent/builtin-tools/tools/LocalMemoryRecallTool/LocalMemoryRecallTool.js'
import { SSHRemoteTool } from './tools/SSHRemoteTool.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
export {
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
} from './constants/tools.js'
import { CronCreateTool } from '@sophia-agent/builtin-tools/tools/ScheduleCronTool/CronCreateTool.js'
import { CronDeleteTool } from '@sophia-agent/builtin-tools/tools/ScheduleCronTool/CronDeleteTool.js'
import { CronListTool } from '@sophia-agent/builtin-tools/tools/ScheduleCronTool/CronListTool.js'
import { createWorkflowToolCore } from './workflow/wiring.js'
import type { ToolSafetyContext } from './Tool.js'
import { getDenyRuleForTool } from './utils/safety/toolSafety.js'
import { hasEmbeddedSearchTools } from './utils/embeddedTools.js'
import { isEnvTruthy } from './utils/envUtils.js'

/**
 * Predefined tool presets that can be used with --tools flag
 */
export const TOOL_PRESETS = ['default'] as const

export type ToolPreset = (typeof TOOL_PRESETS)[number]

export function parseToolPreset(preset: string): ToolPreset | null {
  const presetString = preset.toLowerCase()
  if (!TOOL_PRESETS.includes(presetString as ToolPreset)) {
    return null
  }
  return presetString as ToolPreset
}

/**
 * Get the list of tool names for a given preset
 * Filters out tools that are disabled via isEnabled() check
 * @param preset The preset name
 * @returns Array of tool names
 */
export function getToolsForDefaultPreset(): string[] {
  const tools = getAllBaseTools()
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map(tool => tool.name)
}

/** Model-facing tools included in the reduced Core build. */
export function getCoreBaseTools(): Tools {
  return [
    AgentTool,
    TaskOutputTool,
    BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    WebFetchTool,
    TodoWriteTool,
    WebBrowserTool,
    TaskStopTool,
    AskUserQuestionTool,
    SkillTool,
    AutoMcpTool,
    AutoPluginTool,
    EnterPlanModeTool,
    LocalMemoryRecallTool,
    createWorkflowToolCore(),
    CronCreateTool,
    CronDeleteTool,
    CronListTool,
    SSHRemoteTool,
    ...(process.env.NODE_ENV === 'test' ? [TestingPermissionTool] : []),
    ListMcpResourcesTool,
    ReadMcpResourceTool,
  ]
}

/**
 * Get the complete exhaustive list of all tools that could be available
 * in the current environment (respecting process.env flags).
 * This is the source of truth for ALL tools.
 */
/**
 * NOTE: This MUST stay in sync with https://console.statsig.com/4aF3Ewatb6xPVpCwxb5nA3/dynamic_configs/claude_code_global_system_caching, in order to cache the system prompt across users.
 */
export function getAllBaseTools(): Tools {
  return getCoreBaseTools()
}

/**
 * Filters out tools that are blanket-denied by the permission context.
 * A tool is filtered out if there's a deny rule matching its name with no
 * ruleContent (i.e., a blanket deny for that tool).
 *
 * Uses the same matcher as the runtime permission check (step 1a), so MCP
 * server-prefix rules like `mcp__server` strip all tools from that server
 * before the model sees them — not just at call time.
 */
export function filterToolsByDenyRules<
  T extends {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  },
>(tools: readonly T[], permissionContext: ToolSafetyContext): T[] {
  return tools.filter(tool => !getDenyRuleForTool(permissionContext, tool))
}

export const getTools = (permissionContext: ToolSafetyContext): Tools => {
  // Simple mode: only Bash, Read, and Edit tools
  if (isEnvTruthy(process.env.SOPHIA_SIMPLE)) {
    return filterToolsByDenyRules(
      [BashTool, FileReadTool, FileEditTool],
      permissionContext,
    )
  }

  // Get all base tools and filter out special tools that get added conditionally
  const specialTools = new Set([
    ListMcpResourcesTool.name,
    ReadMcpResourceTool.name,
    SYNTHETIC_OUTPUT_TOOL_NAME,
  ])

  const tools = getAllBaseTools().filter(tool => !specialTools.has(tool.name))

  // Filter out tools that are denied by the deny rules
  const allowedTools = filterToolsByDenyRules(tools, permissionContext)

  const isEnabled = allowedTools.map(_ => _.isEnabled())
  return allowedTools.filter((_, i) => isEnabled[i])
}

/**
 * Assemble the full tool pool for a given permission context and MCP tools.
 *
 * This is the single source of truth for combining built-in tools with MCP tools.
 * Both REPL.tsx (via useMergedTools hook) and runAgent.ts (for coordinator workers)
 * use this function to ensure consistent tool pool assembly.
 *
 * The function:
 * 1. Gets built-in tools via getTools() (respects mode filtering)
 * 2. Filters MCP tools by deny rules
 * 3. Deduplicates by tool name (built-in tools take precedence)
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined, deduplicated array of built-in and MCP tools
 */
export function assembleToolPool(
  permissionContext: ToolSafetyContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)

  // Filter out MCP tools that are in the deny list
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)

  // Sort each partition for prompt-cache stability, keeping built-ins as a
  // contiguous prefix. The server's claude_code_system_cache_policy places a
  // global cache breakpoint after the last prefix-matched built-in tool; a flat
  // sort would interleave MCP tools into built-ins and invalidate all downstream
  // cache keys whenever an MCP tool sorts between existing built-ins. uniqBy
  // preserves insertion order, so built-ins win on name conflict.
  // Avoid Array.toSorted (Node 20+) — we support Node 18. builtInTools is
  // readonly so copy-then-sort; allowedMcpTools is a fresh .filter() result.
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}

/**
 * Get all tools including both built-in tools and MCP tools.
 *
 * This is the preferred function when you need the complete tools list for:
 * - Token counting that includes MCP tools
 * - Any context where MCP tools should be considered
 *
 * Use getTools() only when you specifically need just built-in tools.
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined array of built-in and MCP tools
 */
export function getMergedTools(
  permissionContext: ToolSafetyContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)
  return [...builtInTools, ...mcpTools]
}
