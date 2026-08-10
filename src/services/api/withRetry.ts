export function getRetryDelay(attempt: number): number {
  const cappedAttempt = Math.max(0, Math.min(attempt, 6))
  return 500 * 2 ** cappedAttempt
}

export function getDefaultMaxRetries(): number {
  return 2
}
