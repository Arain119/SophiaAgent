import z from 'zod/v4'
// Types extracted to src/types/safety.ts to break import cycles
import type {
  SafetyBehavior,
  SafetyRuleBehavior,
  SafetyRule,
  SafetyRuleSource,
  SafetyRuleValue,
} from '../../types/safety.js'
import { lazySchema } from '../lazySchema.js'

// Re-export for backwards compatibility
export type {
  SafetyBehavior,
  SafetyRuleBehavior,
  SafetyRule,
  SafetyRuleSource,
  SafetyRuleValue,
}

/**
 * ToolSafetyBehavior is the behavior associated with a permission rule.
 * 'allow' means the rule allows the tool to run.
 * 'deny' means the rule denies the tool from running.
 * Rules either allow or deny a matching operation. Runtime safety evaluation
 * may still produce an internal `ask` result before the fixed policy resolves it.
 */
export const safetyRuleBehaviorSchema = lazySchema(() =>
  z.enum(['allow', 'deny']),
)

/**
 * SafetyRuleValue is the content of a permission rule.
 * @param toolName - The name of the tool this rule applies to
 * @param ruleContent - The optional content of the rule.
 *   Each tool may implement custom handling in `checkSafety()`
 */
export const safetyRuleValueSchema = lazySchema(() =>
  z.object({
    toolName: z.string(),
    ruleContent: z.string().optional(),
  }),
)
