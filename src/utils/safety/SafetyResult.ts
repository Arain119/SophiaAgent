// Types extracted to src/types/safety.ts to break import cycles
import type {
  SafetyAllowDecision,
  SafetyReviewDecision,
  SafetyDecision,
  SafetyDecisionReason,
  SafetyDenyDecision,
  SafetyMetadata,
  SafetyResult,
} from '../../types/safety.js'

// Re-export for backwards compatibility
export type {
  SafetyAllowDecision,
  SafetyReviewDecision,
  SafetyDecision,
  SafetyDecisionReason,
  SafetyDenyDecision,
  SafetyMetadata,
  SafetyResult,
}

// Helper function to get the appropriate prose description for rule behavior
export function getRuleBehaviorDescription(
  permissionResult: SafetyResult['behavior'],
): string {
  switch (permissionResult) {
    case 'allow':
      return 'allowed'
    case 'deny':
      return 'denied'
    default:
      return 'asked for confirmation for'
  }
}
