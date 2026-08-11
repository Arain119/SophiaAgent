import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getSophiaConfigHomeDir } from '../../../utils/envUtils.js'

type PersistedRetryState = {
  version: 1
  routes: Array<{ key: string; retryAt: number }>
}

export type ProviderRetryState = {
  key: string
  retryAt: number
}

const listeners = new Set<() => void>()
const retryAtByRoute = new Map<string, number>()
let loadedPath: string | undefined
let snapshot: ProviderRetryState[] = []

function statePath(): string {
  return join(getSophiaConfigHomeDir(), 'runtime', 'provider-retries.json')
}

function refreshSnapshot(now = Date.now()): void {
  let changed = false
  for (const [key, retryAt] of retryAtByRoute) {
    if (retryAt <= now) {
      retryAtByRoute.delete(key)
      changed = true
    }
  }
  const next = [...retryAtByRoute]
    .map(([key, retryAt]) => ({ key, retryAt }))
    .sort((left, right) => left.retryAt - right.retryAt)
  if (
    changed ||
    next.length !== snapshot.length ||
    next.some(
      (entry, index) =>
        entry.key !== snapshot[index]?.key ||
        entry.retryAt !== snapshot[index]?.retryAt,
    )
  ) {
    snapshot = next
    for (const listener of listeners) listener()
  }
}

function ensureLoaded(): void {
  const path = statePath()
  if (loadedPath === path) return
  loadedPath = path
  retryAtByRoute.clear()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedRetryState
    if (parsed.version === 1 && Array.isArray(parsed.routes)) {
      for (const route of parsed.routes) {
        if (
          route &&
          typeof route.key === 'string' &&
          Number.isFinite(route.retryAt) &&
          route.retryAt > Date.now()
        ) {
          retryAtByRoute.set(route.key, route.retryAt)
        }
      }
    }
  } catch {
    // Missing or interrupted state writes are equivalent to no active cooldown.
  }
  refreshSnapshot()
}

function persist(): void {
  const path = statePath()
  const temporary = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    const data: PersistedRetryState = {
      version: 1,
      routes: [...retryAtByRoute].map(([key, retryAt]) => ({ key, retryAt })),
    }
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } catch {
    // Retry remains active in memory when persistence is unavailable.
  }
}

export function getProviderRetryAt(key: string): number | undefined {
  ensureLoaded()
  refreshSnapshot()
  return retryAtByRoute.get(key)
}

export function setProviderRetryAt(key: string, retryAt: number): void {
  ensureLoaded()
  retryAtByRoute.set(key, retryAt)
  refreshSnapshot()
  persist()
}

export function clearProviderRetryAt(key: string): void {
  ensureLoaded()
  if (!retryAtByRoute.delete(key)) return
  refreshSnapshot()
  persist()
}

export function subscribeProviderRetryState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getProviderRetryStateSnapshot(): ProviderRetryState[] {
  ensureLoaded()
  refreshSnapshot()
  return snapshot
}

export function resetProviderRetryStateForTests(): void {
  loadedPath = undefined
  retryAtByRoute.clear()
  snapshot = []
}
