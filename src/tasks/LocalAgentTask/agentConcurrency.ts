const DEFAULT_CONCURRENCY = 3
const MAX_CONCURRENCY = 16

function configuredConcurrency(): number {
  const value = Number(process.env.SOPHIA_AGENT_MAX_CONCURRENCY)
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENCY
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.trunc(value)))
}

type Waiter = {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
}
const limit = configuredConcurrency()
let available = limit
const waiters: Waiter[] = []

export async function acquireAgentPermit(
  signal: AbortSignal,
): Promise<() => void> {
  if (signal.aborted) throw new Error('Agent permit acquisition aborted')
  if (available > 0) {
    available -= 1
    return releasePermit
  }
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal }
    const onAbort = () => {
      const index = waiters.indexOf(waiter)
      if (index >= 0) waiters.splice(index, 1)
      reject(new Error('Agent permit acquisition aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    waiters.push(waiter)
  })
}

function releasePermit(): void {
  while (waiters.length > 0) {
    const next = waiters.shift()!
    if (next.signal?.aborted) continue
    next.resolve(releasePermit)
    return
  }
  available += 1
}

export function resetAgentConcurrencyForTest(): void {
  while (waiters.length > 0)
    waiters.shift()?.reject(new Error('Agent concurrency reset'))
  available = limit
}

export function getAgentConcurrencySnapshot(): {
  active: number
  queued: number
  limit: number
} {
  return { active: limit - available, queued: waiters.length, limit }
}
