import { feature } from 'bun:bundle'
import { writeFile } from 'fs/promises'
import { z } from 'zod/v4'
import {
  hasExitedPlanModeInSession,
  setHasExitedPlanMode,
  setNeedsPlanModeExitAttachment,
} from 'src/bootstrap/state.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import {
  buildTool,
  type Tool,
  type ToolDef,
  toolMatchesName,
} from 'src/Tool.js'
import { isAgentSwarmsEnabled } from 'src/utils/agentSwarmsEnabled.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import {
  getPlan,
  getPlanFilePath,
  persistFileSnapshotIfRemote,
} from 'src/utils/plans.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '../TeamCreateTool/constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from './constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() => z.object({}).passthrough())
type InputSchema = ReturnType<typeof inputSchema>

/**
 * SDK-facing input schema - includes fields injected by normalizeToolInput.
 * The internal inputSchema doesn't have these fields because plan is read from disk,
 * but the SDK/hooks see the normalized version with plan and file path included.
 */
export const _sdkInputSchema = lazySchema(() =>
  inputSchema().extend({
    plan: z
      .string()
      .optional()
      .describe('The plan content (injected by normalizeToolInput from disk)'),
    planFilePath: z
      .string()
      .optional()
      .describe('The plan file path (injected by normalizeToolInput)'),
  }),
)

export const outputSchema = lazySchema(() =>
  z.object({
    plan: z
      .string()
      .nullable()
      .describe('The plan that was presented to the user'),
    isAgent: z.boolean(),
    filePath: z
      .string()
      .optional()
      .describe('The file path where the plan was saved'),
    hasTaskTool: z
      .boolean()
      .optional()
      .describe('Whether the Agent tool is available in the current context'),
    planWasEdited: z
      .boolean()
      .optional()
      .describe(
        'True when the user edited the plan (CCR web UI or Ctrl+G); determines whether the plan is echoed back in tool_result',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const ExitPlanModeV2Tool: Tool<InputSchema, Output> = buildTool({
  name: EXIT_PLAN_MODE_V2_TOOL_NAME,
  maxResultSizeChars: 100_000,
  async description() {
    return 'Finishes plan mode and resumes implementation'
  },
  async prompt() {
    return EXIT_PLAN_MODE_V2_TOOL_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return ''
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false // Now writes to disk
  },
  requiresUserInteraction() {
    return false
  },
  async validateInput(_input, { getAppState, options }) {
    // The deferred-tool list announces this tool regardless of mode.
    const mode = getAppState().toolSafetyContext.mode
    if (mode !== 'plan') {
      logEvent('tengu_exit_plan_mode_called_outside_plan', {
        model:
          options.mainLoopModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        hasExitedPlanModeInSession: hasExitedPlanModeInSession(),
      })
      return {
        result: false,
        message:
          'You are not in plan mode. This tool is only for finishing plan mode after writing a plan. Continue with implementation.',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async checkSafety(input, _context) {
    return {
      behavior: 'allow' as const,
      updatedInput: input,
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input, context) {
    const isAgent = !!context.agentId

    const filePath = getPlanFilePath(context.agentId)
    // Remote clients may send an edited plan through the normalized input.
    const inputPlan =
      'plan' in input && typeof input.plan === 'string' ? input.plan : undefined
    const plan = inputPlan ?? getPlan(context.agentId)

    // Sync disk so VerifyPlanExecution / Read see the edit. Re-snapshot
    // after: the only other persistFileSnapshotIfRemote call (api.ts) runs
    // in normalizeToolInput, pre-permission — it captured the old plan.
    if (inputPlan !== undefined && filePath) {
      await writeFile(filePath, inputPlan, 'utf-8').catch(e => logError(e))
      void persistFileSnapshotIfRemote()
    }

    // Note: Background verification hook is registered in REPL.tsx AFTER context clear
    // via registerPlanVerificationHook(). Registering here would be cleared during context clear.

    context.setAppState(prev => {
      if (prev.toolSafetyContext.mode !== 'plan') return prev
      setHasExitedPlanMode(true)
      setNeedsPlanModeExitAttachment(true)
      return {
        ...prev,
        toolSafetyContext: {
          ...prev.toolSafetyContext,
          mode: 'auto',
        },
      }
    })

    const hasTaskTool =
      isAgentSwarmsEnabled() &&
      context.options.tools.some(t => toolMatchesName(t, AGENT_TOOL_NAME))

    return {
      data: {
        plan,
        isAgent,
        filePath,
        hasTaskTool: hasTaskTool || undefined,
        planWasEdited: inputPlan !== undefined || undefined,
      },
    }
  },
  mapToolResultToToolResultBlockParam(
    { isAgent, plan, filePath, hasTaskTool, planWasEdited },
    toolUseID,
  ) {
    if (isAgent) {
      return {
        type: 'tool_result',
        content:
          'Plan mode finished. Return the completed plan to the parent agent.',
        tool_use_id: toolUseID,
      }
    }

    // Handle empty plan
    if (!plan || plan.trim() === '') {
      return {
        type: 'tool_result',
        content: 'Plan mode finished. Continue with implementation.',
        tool_use_id: toolUseID,
      }
    }

    const teamHint = hasTaskTool
      ? `\n\nIf this plan can be broken down into multiple independent tasks, consider using the ${TEAM_CREATE_TOOL_NAME} tool to create a team and parallelize the work.`
      : ''

    // Always include the plan so the next local turn has the complete text.
    // Label plans edited through the optional input field.
    const planLabel = planWasEdited
      ? 'Implementation Plan (edited)'
      : 'Implementation Plan'

    return {
      type: 'tool_result',
      content: `Plan mode finished. Continue with implementation. Start with updating your todo list if applicable

Your plan has been saved to: ${filePath}
You can refer back to it if needed during implementation.${teamHint}

## ${planLabel}:
${plan}`,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
