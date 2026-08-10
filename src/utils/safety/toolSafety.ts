import { feature } from 'bun:bundle'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  getToolNameForSafetyCheck,
  mcpInfoFromString,
} from '../../services/mcp/mcpStringUtils.js'
import type { Tool, ToolSafetyContext, ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import { extractOutputRedirections } from '../bash/commands.js'
import { logForDebugging } from '../debug.js'
import { AbortError } from '../errors.js'
import { logError } from '../log.js'
import {
  getSettingSourceDisplayNameLowercase,
  SETTING_SOURCES,
} from '../settings/constants.js'
import { plural } from '../stringUtils.js'
import { executionModeTitle } from './ExecutionMode.js'
import type {
  SafetyReviewDecision,
  SafetyDecision,
  SafetyDecisionReason,
  SafetyDenyDecision,
  SafetyResult,
} from './SafetyResult.js'
import type {
  SafetyRuleBehavior,
  SafetyRule,
  SafetyRuleSource,
  SafetyRuleValue,
} from './SafetyRule.js'
import {
  applySafetyRuleUpdate,
  applySafetyRuleUpdates,
} from './SafetyRuleUpdate.js'
import type {
  SafetyRuleUpdate,
  SafetyRuleUpdateDestination,
} from './SafetyRuleUpdateSchema.js'
import {
  safetyRuleValueFromString,
  safetyRuleValueToString,
} from './safetyRuleParser.js'
import {
  deleteSafetyRuleFromSettings,
  type SafetyRuleFromEditableSettings,
  shouldUseManagedSafetyRulesOnly,
} from './safetyRulesLoader.js'
import { applyFixedSafetyPolicy } from './fixedSafetyPolicy.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const classifierDecisionModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('./classifierDecision.js') as typeof import('./classifierDecision.js'))
  : null
import {
  addToTurnClassifierDuration,
  getTotalCacheCreationInputTokens,
  getTotalCacheReadInputTokens,
  getTotalInputTokens,
  getTotalOutputTokens,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import {
  clearClassifierChecking,
  setClassifierChecking,
} from '../classifierApprovals.js'
import { isInProtectedNamespace } from '../envUtils.js'
import {
  AUTO_REJECT_MESSAGE,
  buildClassifierUnavailableMessage,
  buildYoloRejectionMessage,
  DONT_ASK_REJECT_MESSAGE,
} from '../messages.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { jsonStringify } from '../slowOperations.js'
import {
  createDenialTrackingState,
  DENIAL_LIMITS,
  type DenialTrackingState,
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
} from './denialTracking.js'
import {
  classifyYoloAction,
  formatActionForClassifier,
} from './yoloClassifier.js'

const CLASSIFIER_FAIL_CLOSED_REFRESH_MS = 30 * 60 * 1000 // 30 minutes

const PERMISSION_RULE_SOURCES = [
  ...SETTING_SOURCES,
  'cliArg',
  'command',
  'session',
] as const satisfies readonly SafetyRuleSource[]

export function safetyRuleSourceDisplayString(
  source: SafetyRuleSource,
): string {
  return getSettingSourceDisplayNameLowercase(source)
}

export function getAllowRules(context: ToolSafetyContext): SafetyRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.allowRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'allow',
      ruleValue: safetyRuleValueFromString(ruleString),
    })),
  )
}

/**
 * Describes why an operation needs an internal safety review.
 */
export function createSafetyReviewMessage(
  toolName: string,
  decisionReason?: SafetyDecisionReason,
): string {
  // Handle different decision reason types
  if (decisionReason) {
    if (
      (feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) &&
      decisionReason.type === 'classifier'
    ) {
      return `Classifier '${decisionReason.classifier}' flagged this ${toolName} command for safety review: ${decisionReason.reason}`
    }
    switch (decisionReason.type) {
      case 'hook': {
        const hookMessage = decisionReason.reason
          ? `Hook '${decisionReason.hookName}' blocked this action: ${decisionReason.reason}`
          : `Hook '${decisionReason.hookName}' flagged this ${toolName} command for safety review`
        return hookMessage
      }
      case 'rule': {
        const ruleString = safetyRuleValueToString(
          decisionReason.rule.ruleValue,
        )
        const sourceString = safetyRuleSourceDisplayString(
          decisionReason.rule.source,
        )
        return `Safety rule '${ruleString}' from ${sourceString} matched this ${toolName} command`
      }
      case 'subcommandResults': {
        const needsApproval: string[] = []
        for (const [cmd, result] of decisionReason.reasons) {
          if (result.behavior === 'ask' || result.behavior === 'passthrough') {
            // Strip output redirections for display to avoid showing filenames as commands
            // Only do this for Bash tool to avoid affecting other tools
            if (toolName === 'Bash') {
              const { commandWithoutRedirections, redirections } =
                extractOutputRedirections(cmd)
              // Only use stripped version if there were actual redirections
              const displayCmd =
                redirections.length > 0 ? commandWithoutRedirections : cmd
              needsApproval.push(displayCmd)
            } else {
              needsApproval.push(cmd)
            }
          }
        }
        if (needsApproval.length > 0) {
          const n = needsApproval.length
          return `This ${toolName} command contains multiple operations. The following ${plural(n, 'part')} ${plural(n, 'requires', 'require')} safety review: ${needsApproval.join(', ')}`
        }
        return `This ${toolName} command contains multiple operations that require safety review`
      }
      case 'sandboxOverride':
        return 'Run outside of the sandbox'
      case 'workingDir':
        return decisionReason.reason
      case 'safetyCheck':
      case 'other':
        return decisionReason.reason
      case 'mode': {
        const modeTitle = executionModeTitle(decisionReason.mode)
        return `Current execution mode (${modeTitle}) requires a safety decision for this ${toolName} command`
      }
      case 'asyncAgent':
        return decisionReason.reason
    }
  }

  return `${toolName} requires an internal safety decision.`
}

export function getDenyRules(context: ToolSafetyContext): SafetyRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.denyRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'deny',
      ruleValue: safetyRuleValueFromString(ruleString),
    })),
  )
}

/**
 * Check if the entire tool matches a rule
 * For example, this matches "Bash" but not "Bash(prefix:*)" for BashTool
 * This also matches MCP tools with a server name, e.g. the rule "mcp__server1"
 */
function toolMatchesRule(
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
  rule: SafetyRule,
): boolean {
  // Rule must not have content to match the entire tool
  if (rule.ruleValue.ruleContent !== undefined) {
    return false
  }

  // MCP tools are matched by their fully qualified mcp__server__tool name. In
  // skip-prefix mode (CLAUDE_AGENT_SDK_MCP_NO_PREFIX), MCP tools have unprefixed
  // display names (e.g., "Write") that collide with builtin names; rules targeting
  // builtins should not match their MCP replacements.
  const nameForRuleMatch = getToolNameForSafetyCheck(tool)

  // Direct tool name match
  if (rule.ruleValue.toolName === nameForRuleMatch) {
    return true
  }

  // MCP server-level permission: rule "mcp__server1" matches tool "mcp__server1__tool1"
  // Also supports wildcard: rule "mcp__server1__*" matches all tools from server1
  const ruleInfo = mcpInfoFromString(rule.ruleValue.toolName)
  const toolInfo = mcpInfoFromString(nameForRuleMatch)

  return (
    ruleInfo !== null &&
    toolInfo !== null &&
    (ruleInfo.toolName === undefined || ruleInfo.toolName === '*') &&
    ruleInfo.serverName === toolInfo.serverName
  )
}

/**
 * Check if the entire tool is listed in the always allow rules
 * For example, this finds "Bash" but not "Bash(prefix:*)" for BashTool
 */
export function getAllowRuleForTool(
  context: ToolSafetyContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): SafetyRule | null {
  return (
    getAllowRules(context).find(rule => toolMatchesRule(tool, rule)) || null
  )
}

/**
 * Check if the tool is listed in the always deny rules
 */
export function getDenyRuleForTool(
  context: ToolSafetyContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): SafetyRule | null {
  return getDenyRules(context).find(rule => toolMatchesRule(tool, rule)) || null
}

/**
 * Check if a specific agent is denied via Agent(agentType) syntax.
 * For example, Agent(Explore) would deny the Explore agent.
 */
export function getDenyRuleForAgent(
  context: ToolSafetyContext,
  agentToolName: string,
  agentType: string,
): SafetyRule | null {
  return (
    getDenyRules(context).find(
      rule =>
        rule.ruleValue.toolName === agentToolName &&
        rule.ruleValue.ruleContent === agentType,
    ) || null
  )
}

/**
 * Filter agents to exclude those that are denied via Agent(agentType) syntax.
 */
export function filterDeniedAgents<T extends { agentType: string }>(
  agents: T[],
  context: ToolSafetyContext,
  agentToolName: string,
): T[] {
  // Parse deny rules once and collect Agent(x) contents into a Set.
  // Previously this called getDenyRuleForAgent per agent, which re-parsed
  // every deny rule for every agent (O(agents×rules) parse calls).
  const deniedAgentTypes = new Set<string>()
  for (const rule of getDenyRules(context)) {
    if (
      rule.ruleValue.toolName === agentToolName &&
      rule.ruleValue.ruleContent !== undefined
    ) {
      deniedAgentTypes.add(rule.ruleValue.ruleContent)
    }
  }
  return agents.filter(agent => !deniedAgentTypes.has(agent.agentType))
}

/**
 * Map of rule contents to the associated rule for a given tool.
 * e.g. the string key is "prefix:*" from "Bash(prefix:*)" for BashTool
 */
export function getRuleByContentsForTool(
  context: ToolSafetyContext,
  tool: Tool,
  behavior: SafetyRuleBehavior,
): Map<string, SafetyRule> {
  return getRuleByContentsForToolName(
    context,
    getToolNameForSafetyCheck(tool),
    behavior,
  )
}

// Used to break circular dependency where a Tool calls this function
export function getRuleByContentsForToolName(
  context: ToolSafetyContext,
  toolName: string,
  behavior: SafetyRuleBehavior,
): Map<string, SafetyRule> {
  const ruleByContents = new Map<string, SafetyRule>()
  let rules: SafetyRule[] = []
  switch (behavior) {
    case 'allow':
      rules = getAllowRules(context)
      break
    case 'deny':
      rules = getDenyRules(context)
      break
  }
  for (const rule of rules) {
    if (
      rule.ruleValue.toolName === toolName &&
      rule.ruleValue.ruleContent !== undefined &&
      rule.ruleBehavior === behavior
    ) {
      ruleByContents.set(rule.ruleValue.ruleContent, rule)
    }
  }
  return ruleByContents
}

export const evaluateToolSafety: CanUseToolFn = async (
  tool,
  input,
  context,
): Promise<SafetyDecision> =>
  applyFixedSafetyPolicy(
    tool.name,
    input,
    await evaluateToolSafetyInternal(tool, input, context),
  )

export async function evaluateToolSafetyRules(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): Promise<SafetyReviewDecision | SafetyDenyDecision | null> {
  let toolSafetyResult: SafetyResult = {
    behavior: 'passthrough',
    message: createSafetyReviewMessage(tool.name),
  }
  try {
    const parsedInput = tool.inputSchema.parse(input)
    toolSafetyResult = await tool.checkSafety(parsedInput, context)
  } catch (error) {
    if (error instanceof AbortError || error instanceof APIUserAbortError) {
      throw error
    }
    logError(error)
  }

  if (toolSafetyResult.behavior === 'deny') {
    return toolSafetyResult
  }
  if (
    toolSafetyResult.behavior === 'ask' &&
    toolSafetyResult.decisionReason?.type === 'safetyCheck'
  ) {
    return toolSafetyResult
  }
  return null
}

async function evaluateToolSafetyInternal(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): Promise<SafetyDecision> {
  if (context.abortController.signal.aborted) {
    throw new AbortError()
  }

  let appState = context.getAppState()

  // 1. Check if the tool is denied
  // 1a. Entire tool is denied
  const denyRule = getDenyRuleForTool(appState.toolSafetyContext, tool)
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
  }

  // 1b. Ask the tool implementation for a safety result.
  // Overridden unless tool input schema is not valid
  let toolSafetyResult: SafetyResult = {
    behavior: 'passthrough',
    message: createSafetyReviewMessage(tool.name),
  }
  try {
    const parsedInput = tool.inputSchema.parse(input)
    toolSafetyResult = await tool.checkSafety(parsedInput, context)
  } catch (e) {
    // Rethrow abort errors so they propagate properly
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e
    }
    logError(e)
  }

  // 1c. Tool implementation denied the operation.
  if (toolSafetyResult?.behavior === 'deny') {
    return toolSafetyResult
  }

  // 1d. Some tools require direct user interaction for their own semantics.
  if (
    tool.requiresUserInteraction?.() &&
    toolSafetyResult?.behavior === 'ask'
  ) {
    return toolSafetyResult
  }

  // 1e. Safety checks (e.g. .git/, .sophia/, .vscode/, shell configs) are
  // hard boundaries; the fixed policy denies them instead of prompting.
  // checkPathSafetyForAutoEdit returns {type:'safetyCheck'} for these paths.
  if (
    toolSafetyResult?.behavior === 'ask' &&
    toolSafetyResult.decisionReason?.type === 'safetyCheck'
  ) {
    return toolSafetyResult
  }

  // 2a. Read the latest state before checking rules.
  appState = context.getAppState()

  // 2b. Entire tool is allowed
  const alwaysAllowedRule = getAllowRuleForTool(
    appState.toolSafetyContext,
    tool,
  )
  if (alwaysAllowedRule) {
    return {
      behavior: 'allow',
      updatedInput: getUpdatedInputOrFallback(toolSafetyResult, input),
      decisionReason: {
        type: 'rule',
        rule: alwaysAllowedRule,
      },
    }
  }

  // 3. Convert "passthrough" to "ask"
  const result: SafetyDecision =
    toolSafetyResult.behavior === 'passthrough'
      ? {
          ...toolSafetyResult,
          behavior: 'ask' as const,
          message: createSafetyReviewMessage(
            tool.name,
            toolSafetyResult.decisionReason,
          ),
        }
      : toolSafetyResult

  if (result.behavior === 'ask' && result.suggestions) {
    logForDebugging(
      `Permission suggestions for ${tool.name}: ${jsonStringify(result.suggestions, null, 2)}`,
    )
  }

  return result
}

type EditSafetyRuleArgs = {
  initialContext: ToolSafetyContext
  setToolSafetyContext: (updatedContext: ToolSafetyContext) => void
}

/**
 * Delete a permission rule from the appropriate destination
 */
export async function deleteSafetyRule({
  rule,
  initialContext,
  setToolSafetyContext,
}: EditSafetyRuleArgs & { rule: SafetyRule }): Promise<void> {
  if (
    rule.source === 'policySettings' ||
    rule.source === 'flagSettings' ||
    rule.source === 'command'
  ) {
    throw new Error('Cannot delete permission rules from read-only settings')
  }

  const updatedContext = applySafetyRuleUpdate(initialContext, {
    type: 'removeRules',
    rules: [rule.ruleValue],
    behavior: rule.ruleBehavior,
    destination: rule.source as SafetyRuleUpdateDestination,
  })

  // Per-destination logic to delete the rule from settings
  const destination = rule.source
  switch (destination) {
    case 'localSettings':
    case 'userSettings':
    case 'projectSettings': {
      // Note: Typescript doesn't know that rule conforms to `SafetyRuleFromEditableSettings` even when we switch on `rule.source`
      deleteSafetyRuleFromSettings(rule as SafetyRuleFromEditableSettings)
      break
    }
    case 'cliArg':
    case 'session': {
      // No action needed for in-memory sources - not persisted to disk
      break
    }
  }

  // Update React state with updated context
  setToolSafetyContext(updatedContext)
}

/**
 * Helper to convert SafetyRule array to SafetyRuleUpdate array
 */
function convertRulesToUpdates(
  rules: SafetyRule[],
  updateType: 'addRules' | 'replaceRules',
): SafetyRuleUpdate[] {
  // Group rules by source and behavior
  const grouped = new Map<string, SafetyRuleValue[]>()

  for (const rule of rules) {
    const key = `${rule.source}:${rule.ruleBehavior}`
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)!.push(rule.ruleValue)
  }

  // Convert to SafetyRuleUpdate array
  const updates: SafetyRuleUpdate[] = []
  for (const [key, ruleValues] of grouped) {
    const [source, behavior] = key.split(':')
    updates.push({
      type: updateType,
      rules: ruleValues,
      behavior: behavior as SafetyRuleBehavior,
      destination: source as SafetyRuleUpdateDestination,
    })
  }

  return updates
}

/**
 * Apply permission rules to context (additive - for initial setup)
 */
export function applySafetyRulesToContext(
  toolSafetyContext: ToolSafetyContext,
  rules: SafetyRule[],
): ToolSafetyContext {
  const updates = convertRulesToUpdates(rules, 'addRules')
  return applySafetyRuleUpdates(toolSafetyContext, updates)
}

/**
 * Sync permission rules from disk (replacement - for settings changes)
 */
export function syncSafetyRulesFromDisk(
  toolSafetyContext: ToolSafetyContext,
  rules: SafetyRule[],
): ToolSafetyContext {
  let context = toolSafetyContext

  // When allowManagedSafetyRulesOnly is enabled, clear all non-policy sources
  if (shouldUseManagedSafetyRulesOnly()) {
    const sourcesToClear: SafetyRuleUpdateDestination[] = [
      'userSettings',
      'projectSettings',
      'localSettings',
      'cliArg',
      'session',
    ]
    const behaviors: SafetyRuleBehavior[] = ['allow', 'deny']

    for (const source of sourcesToClear) {
      for (const behavior of behaviors) {
        context = applySafetyRuleUpdate(context, {
          type: 'replaceRules',
          rules: [],
          behavior,
          destination: source,
        })
      }
    }
  }

  // Clear all disk-based source:behavior combos before applying new rules.
  // Without this, removing a rule from settings (e.g. deleting a deny entry)
  // would leave the old rule in the context because convertRulesToUpdates
  // only generates replaceRules for source:behavior pairs that have rules —
  // an empty group produces no update, so stale rules persist.
  const diskSources: SafetyRuleUpdateDestination[] = [
    'userSettings',
    'projectSettings',
    'localSettings',
  ]
  for (const diskSource of diskSources) {
    for (const behavior of ['allow', 'deny'] as SafetyRuleBehavior[]) {
      context = applySafetyRuleUpdate(context, {
        type: 'replaceRules',
        rules: [],
        behavior,
        destination: diskSource,
      })
    }
  }

  const updates = convertRulesToUpdates(rules, 'replaceRules')
  return applySafetyRuleUpdates(context, updates)
}

/**
 * Extract updatedInput from a permission result, falling back to the original input.
 * Handles the case where some SafetyResult variants don't have updatedInput.
 */
function getUpdatedInputOrFallback(
  permissionResult: SafetyResult,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  return (
    ('updatedInput' in permissionResult
      ? permissionResult.updatedInput
      : undefined) ?? fallback
  )
}
