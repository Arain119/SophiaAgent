/** Tracks in-flight local API and tool work for diagnostics. */
export type SessionActivityReason = 'api_call' | 'tool_exec'

let refcount = 0
const activeReasons = new Map<SessionActivityReason, number>()

export function registerSessionActivityCallback(_callback: () => void): void {}

export function unregisterSessionActivityCallback(): void {}

export function sendSessionActivitySignal(): void {}

export function isSessionActivityTrackingActive(): boolean {
  return false
}

export function startSessionActivity(reason: SessionActivityReason): void {
  refcount += 1
  activeReasons.set(reason, (activeReasons.get(reason) ?? 0) + 1)
}

export function stopSessionActivity(reason: SessionActivityReason): void {
  refcount = Math.max(0, refcount - 1)
  const next = (activeReasons.get(reason) ?? 0) - 1
  if (next > 0) activeReasons.set(reason, next)
  else activeReasons.delete(reason)
}
