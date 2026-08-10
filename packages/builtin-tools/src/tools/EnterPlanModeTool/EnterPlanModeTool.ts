import { z } from 'zod/v4'
import { handlePlanModeTransition } from 'src/bootstrap/state.js'
import type { Tool } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { isPlanModeInterviewPhaseEnabled } from 'src/utils/planModeV2.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from './constants.js'
import { getEnterPlanModeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    // No parameters needed
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Confirmation that plan mode was entered'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const EnterPlanModeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_PLAN_MODE_TOOL_NAME,
  maxResultSizeChars: 100_000,
  async description() {
    return 'Starts an internal planning workflow for complex tasks'
  },
  async prompt() {
    return getEnterPlanModeToolPrompt()
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
    return true
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(_input, context) {
    if (context.agentId) {
      throw new Error('EnterPlanMode tool cannot be used in agent contexts')
    }

    const appState = context.getAppState()
    handlePlanModeTransition(appState.toolSafetyContext.mode, 'plan')

    // Plan is an internal workflow state; it is not a user permission mode.
    context.setAppState(prev => ({
      ...prev,
      toolSafetyContext: {
        ...prev.toolSafetyContext,
        mode: 'plan',
      },
    }))

    return {
      data: {
        message:
          'Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.',
      },
    }
  },
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    const instructions = isPlanModeInterviewPhaseEnabled()
      ? `${message}

DO NOT write or edit any files except the plan file. Detailed workflow instructions will follow.`
      : `${message}

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to finish planning and continue implementation

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`

    return {
      type: 'tool_result',
      content: instructions,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
