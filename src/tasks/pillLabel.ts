import type { BackgroundTaskState } from './types.js'

/**
 * Produces the compact footer-pill label for a set of background tasks.
 * Used by both the footer pill and the turn-duration transcript line so the
 * two surfaces agree on terminology.
 */
export function getPillLabel(tasks: BackgroundTaskState[]): string {
  const n = tasks.length
  const allSameType = tasks.every(t => t.type === tasks[0]!.type)

  if (allSameType) {
    switch (tasks[0]!.type) {
      case 'local_bash':
        return n === 1 ? '1 shell' : `${n} shells`
      case 'in_process_teammate': {
        return n === 1 ? '1 agent' : `${n} agents`
      }
      case 'local_agent':
        return n === 1 ? '1 agent' : `${n} agents`
      case 'local_workflow':
        return n === 1 ? '1 workflow' : `${n} workflows`
    }
  }

  return `${n} ${n === 1 ? 'activity' : 'activities'}`
}

/**
 * True when the pill should show the dimmed " · ↓ to view" call-to-action.
 * Per the state diagram: only the two attention states (needs_input,
 * plan_ready) surface the CTA; plain running shows just the diamond + label.
 */
export function pillNeedsCta(_tasks: BackgroundTaskState[]): boolean {
  return false
}
