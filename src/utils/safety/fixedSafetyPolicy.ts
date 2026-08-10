import { getDestructiveCommandWarning as getBashDestructiveWarning } from '@sophia-agent/builtin-tools/tools/BashTool/destructiveCommandWarning.js'
import { BASH_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/BashTool/toolName.js'
import { getDestructiveCommandWarning as getPowerShellDestructiveWarning } from '@sophia-agent/builtin-tools/tools/PowerShellTool/destructiveCommandWarning.js'
import { POWERSHELL_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/PowerShellTool/toolName.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/AskUserQuestionTool/prompt.js'
import type {
  SafetyReviewDecision,
  SafetyDecision,
  SafetyDecisionReason,
  SafetyResult,
} from '../../types/safety.js'

export const FIXED_EXECUTION_MODE = 'auto' as const

const UNSAFE_SHELL_REASON_PATTERNS = [
  /cannot be parsed/i,
  /cannot be verified/i,
  /could not be parsed/i,
  /failed to parse/i,
  /malformed syntax/i,
  /too (?:complex|many) to (?:parse|safety-check|verify)/i,
  /unverifiable/i,
  /bare[- ]repository/i,
  /could (?:plant|execute) (?:a )?malicious/i,
  /may load external code/i,
  /may trigger module loading/i,
  /could trigger network requests/i,
  /non-filesystem provider/i,
  /critical system directory/i,
  /protected system path/i,
  /UNC (?:network )?path/i,
  /suspicious Windows/i,
  /network resources/i,
  /sensitive file/i,
  /manual verification/i,
]

function hasUnsafeShellReason(text: string | undefined): boolean {
  return (
    text !== undefined &&
    UNSAFE_SHELL_REASON_PATTERNS.some(pattern => pattern.test(text))
  )
}

function resultCrossesHardBoundary(result: SafetyResult): boolean {
  if (result.behavior === 'deny') {
    return result.decisionReason.type !== 'rule'
  }
  if (result.behavior === 'allow') return false
  if ('blockedPath' in result && result.blockedPath !== undefined) return true

  const reason = result.decisionReason
  if (reason === undefined) {
    return hasUnsafeShellReason(result.message)
  }
  return reasonCrossesHardBoundary(reason, result.message)
}

function reasonCrossesHardBoundary(
  reason: SafetyDecisionReason,
  message?: string,
): boolean {
  switch (reason.type) {
    case 'safetyCheck':
    case 'workingDir':
    case 'sandboxOverride':
      return true
    case 'rule':
      return false
    case 'subcommandResults':
      return [...reason.reasons.values()].some(resultCrossesHardBoundary)
    case 'other':
      return (
        hasUnsafeShellReason(reason.reason) || hasUnsafeShellReason(message)
      )
    default:
      return false
  }
}

function shellCommandFromInput(input: Record<string, unknown>): string | null {
  return typeof input.command === 'string' && input.command.trim() !== ''
    ? input.command
    : null
}

function shellRequestCrossesHardBoundary(
  toolName: string,
  input: Record<string, unknown>,
  decision: SafetyReviewDecision,
): boolean {
  const isBash = toolName === BASH_TOOL_NAME
  const isPowerShell = toolName === POWERSHELL_TOOL_NAME
  if (!isBash && !isPowerShell) return false

  const command = shellCommandFromInput(input)
  if (command === null) return true
  if (isBash && decision.isBashSecurityCheckForMisparsing === true) {
    return true
  }

  const destructiveWarning = isBash
    ? getBashDestructiveWarning(command)
    : getPowerShellDestructiveWarning(command)
  return destructiveWarning !== null
}

/**
 * Converts the legacy three-way permission result into Sophia Agent's fixed
 * auto policy. Safety approvals never prompt: safe requests run immediately,
 * while deterministic boundaries fail closed. AskUserQuestion remains
 * interactive because collecting an answer is the tool's operation.
 */
export function applyFixedSafetyPolicy<
  Input extends Record<string, unknown> = Record<string, unknown>,
>(
  toolName: string,
  input: Input,
  decision: SafetyDecision<Input>,
): SafetyDecision<Input> {
  if (
    decision.behavior === 'deny' &&
    (decision.decisionReason.type === 'rule' ||
      (decision.decisionReason.type === 'subcommandResults' &&
        !reasonCrossesHardBoundary(decision.decisionReason, decision.message)))
  ) {
    return {
      behavior: 'allow',
      updatedInput: input,
      userModified: false,
      decisionReason: { type: 'mode', mode: FIXED_EXECUTION_MODE },
    }
  }
  if (decision.behavior !== 'ask') return decision
  if (toolName === ASK_USER_QUESTION_TOOL_NAME) return decision

  if (
    ('blockedPath' in decision && decision.blockedPath !== undefined) ||
    (decision.decisionReason !== undefined &&
      reasonCrossesHardBoundary(decision.decisionReason, decision.message)) ||
    shellRequestCrossesHardBoundary(toolName, input, decision)
  ) {
    return {
      behavior: 'deny',
      message: decision.message,
      decisionReason:
        decision.decisionReason ??
        ({
          type: 'other',
          reason: 'Fixed auto policy rejected an unsafe request',
        } as const),
    }
  }

  return {
    behavior: 'allow',
    updatedInput: decision.updatedInput ?? input,
    userModified: false,
    decisionReason: {
      type: 'mode',
      mode: FIXED_EXECUTION_MODE,
    },
  }
}
