import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { availableParallelism, freemem, totalmem } from 'node:os'
import { promisify } from 'node:util'
import type { AgentId } from '../types/ids.js'
import { enqueuePendingNotification } from './messageQueueManager.js'
import type { ShellCommand } from './ShellCommand.js'
import { escapeXml } from './xml.js'

export type MemoryPressureLevel =
  | 'normal'
  | 'warning'
  | 'critical'
  | 'emergency'

export type MemoryPressureSnapshot = {
  level: MemoryPressureLevel
  usedBytes: number
  limitBytes: number
  ratio: number
  pausedTaskIds: string[]
}

export type MemoryPressureAction = 'none' | 'pause' | 'resume' | 'terminate'

type ManagedTask = {
  taskId: string
  description: string
  agentId?: AgentId
  shellCommand: ShellCommand
  paused: boolean
  terminating: boolean
  rssBytes: number
  onPausedChange?: (paused: boolean) => void
}

const execFileAsync = promisify(execFile)
const SAMPLE_INTERVAL_MS = 2_000
const WARNING_RATIO = 0.75
const CRITICAL_RATIO = 0.88
const EMERGENCY_RATIO = 0.94
const RECOVERY_RATIO = 0.7
const RESUME_RATIO = 0.8
const PROTECTIVE_ACTION_COOLDOWN_MS = 10_000
const tasks = new Map<string, ManagedTask>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let sampling = false
let lastProtectiveActionAt = 0
let snapshot: MemoryPressureSnapshot = {
  level: 'normal',
  usedBytes: 0,
  limitBytes: 0,
  ratio: 0,
  pausedTaskIds: [],
}

export function classifyMemoryPressure(
  ratio: number,
  previous: MemoryPressureLevel = 'normal',
): MemoryPressureLevel {
  if (ratio >= EMERGENCY_RATIO) return 'emergency'
  if (ratio >= CRITICAL_RATIO) return 'critical'
  if (ratio >= WARNING_RATIO) return 'warning'
  if (ratio <= RECOVERY_RATIO) return 'normal'
  return previous === 'normal' ? 'normal' : 'warning'
}

export function selectMemoryPressureAction(options: {
  level: MemoryPressureLevel
  ratio: number
  hasRunnableTask: boolean
  hasPausedTask: boolean
  hasTerminableTask: boolean
  protectiveActionCooldownElapsed: boolean
}): MemoryPressureAction {
  if (options.level === 'emergency' && options.hasTerminableTask)
    return 'terminate'
  if (
    options.level === 'critical' &&
    options.hasRunnableTask &&
    options.protectiveActionCooldownElapsed
  )
    return 'pause'
  if (options.ratio <= RESUME_RATIO && options.hasPausedTask) return 'resume'
  return 'none'
}

type ResourceReadOptions = {
  readFileText?: (path: string) => Promise<string>
  freeMemory?: () => number
  totalMemory?: () => number
  hostCpuCount?: () => number
}

async function readNumber(
  path: string,
  readFileText: (path: string) => Promise<string>,
): Promise<number | undefined> {
  try {
    const value = (await readFileText(path)).trim()
    if (value === 'max') return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function readMemoryUsage(
  options: ResourceReadOptions = {},
): Promise<{
  usedBytes: number
  limitBytes: number
}> {
  const readFileText =
    options.readFileText ?? ((path: string) => readFile(path, 'utf8'))
  const candidates = [
    {
      used: '/sys/fs/cgroup/memory.current',
      limit: '/sys/fs/cgroup/memory.max',
    },
    {
      used: '/sys/fs/cgroup/memory/memory.usage_in_bytes',
      limit: '/sys/fs/cgroup/memory/memory.limit_in_bytes',
    },
  ]
  for (const candidate of candidates) {
    const [usedBytes, limitBytes] = await Promise.all([
      readNumber(candidate.used, readFileText),
      readNumber(candidate.limit, readFileText),
    ])
    if (usedBytes && limitBytes && limitBytes < Number.MAX_SAFE_INTEGER) {
      return { usedBytes, limitBytes }
    }
  }
  const limitBytes = (options.totalMemory ?? totalmem)()
  const freeBytes = (options.freeMemory ?? freemem)()
  return { usedBytes: limitBytes - freeBytes, limitBytes }
}

export async function readEffectiveCpuQuota(
  options: ResourceReadOptions = {},
): Promise<number> {
  const readFileText =
    options.readFileText ?? ((path: string) => readFile(path, 'utf8'))
  const hostCpuCount = Math.max(
    1,
    (options.hostCpuCount ?? availableParallelism)(),
  )

  try {
    const [quotaText, periodText] = (
      await readFileText('/sys/fs/cgroup/cpu.max')
    )
      .trim()
      .split(/\s+/)
    if (quotaText !== 'max') {
      const quota = Number(quotaText)
      const period = Number(periodText)
      if (quota > 0 && period > 0) return Math.min(hostCpuCount, quota / period)
    }
  } catch {
    // Fall through to cgroup v1 or the host CPU count.
  }

  const [quota, period] = await Promise.all([
    readNumber('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', readFileText),
    readNumber('/sys/fs/cgroup/cpu/cpu.cfs_period_us', readFileText),
  ])
  if (quota && period) return Math.min(hostCpuCount, quota / period)
  return hostCpuCount
}

async function updateTaskRss(): Promise<void> {
  if (process.platform === 'win32' || tasks.size === 0) return
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pgid=,rss='], {
      maxBuffer: 8 * 1024 * 1024,
    })
    const rssByGroup = new Map<number, number>()
    for (const line of stdout.split(/\r?\n/)) {
      const [groupText, rssText] = line.trim().split(/\s+/)
      const group = Number(groupText)
      const rssKiB = Number(rssText)
      if (!Number.isInteger(group) || !Number.isFinite(rssKiB)) continue
      rssByGroup.set(group, (rssByGroup.get(group) ?? 0) + rssKiB * 1024)
    }
    for (const task of tasks.values()) {
      task.rssBytes = rssByGroup.get(task.shellCommand.pid ?? -1) ?? 0
    }
  } catch {
    // RSS is optional; pressure protection still works from cgroup totals.
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

function emitSnapshot(next: MemoryPressureSnapshot): void {
  if (
    next.level === snapshot.level &&
    next.usedBytes === snapshot.usedBytes &&
    next.limitBytes === snapshot.limitBytes &&
    next.pausedTaskIds.join('\0') === snapshot.pausedTaskIds.join('\0')
  )
    return
  snapshot = next
  for (const listener of listeners) listener()
}

function enqueuePressureNotification(
  current: MemoryPressureSnapshot,
  action: string,
): void {
  const managed = [...tasks.values()]
    .sort((left, right) => right.rssBytes - left.rssBytes)
    .map(
      task =>
        `<task id="${escapeXml(task.taskId)}" rss="${formatBytes(task.rssBytes)}" state="${task.paused ? 'paused' : task.terminating ? 'terminating' : 'running'}">${escapeXml(task.description)}</task>`,
    )
    .join('\n')
  const message = `<memory-pressure level="${current.level}">
<task-id>memory-pressure</task-id>
<usage>${formatBytes(current.usedBytes)} / ${formatBytes(current.limitBytes)} (${Math.round(current.ratio * 100)}%)</usage>
<action-taken>${escapeXml(action)}</action-taken>
<managed-tasks>
${managed}
</managed-tasks>
Review the running work and cancel, split, or defer low-value tasks when needed. Tasks paused by memory protection resume one at a time after usage falls below ${Math.round(RESUME_RATIO * 100)}%.
</memory-pressure>`
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    priority: current.level === 'emergency' ? 'now' : 'next',
  })
}

function largestTask(
  predicate: (task: ManagedTask) => boolean,
): ManagedTask | undefined {
  return [...tasks.values()]
    .filter(predicate)
    .sort((left, right) => right.rssBytes - left.rssBytes)[0]
}

async function sample(): Promise<void> {
  if (sampling || tasks.size === 0) return
  sampling = true
  try {
    const { usedBytes, limitBytes } = await readMemoryUsage()
    if (tasks.size === 0) return
    const ratio = limitBytes > 0 ? usedBytes / limitBytes : 0
    const previousLevel = snapshot.level
    const level = classifyMemoryPressure(ratio, previousLevel)
    let action = 'observing memory pressure; no task changed'
    if (level !== 'normal') await updateTaskRss()
    if (tasks.size === 0) return

    const pressureAction = selectMemoryPressureAction({
      level,
      ratio,
      hasRunnableTask: [...tasks.values()].some(
        task => !task.paused && !task.terminating,
      ),
      hasPausedTask: [...tasks.values()].some(task => task.paused),
      hasTerminableTask: [...tasks.values()].some(task => !task.terminating),
      protectiveActionCooldownElapsed:
        Date.now() - lastProtectiveActionAt >= PROTECTIVE_ACTION_COOLDOWN_MS,
    })

    if (pressureAction === 'terminate') {
      const target = largestTask(task => !task.terminating)
      if (target) {
        target.terminating = true
        target.shellCommand.terminateForMemoryPressure()
        action = `terminated task ${target.taskId} before the cgroup OOM limit`
      }
    } else if (pressureAction === 'pause') {
      const target = largestTask(task => !task.paused && !task.terminating)
      if (target?.shellCommand.pause()) {
        target.paused = true
        target.onPausedChange?.(true)
        lastProtectiveActionAt = Date.now()
        action = `paused task ${target.taskId} to stop further allocation`
      }
    } else if (pressureAction === 'resume') {
      const target = [...tasks.values()].find(task => task.paused)
      if (target?.shellCommand.resume()) {
        target.paused = false
        target.onPausedChange?.(false)
        action = `resumed task ${target.taskId} after memory recovered`
      }
    }

    const next: MemoryPressureSnapshot = {
      level,
      usedBytes,
      limitBytes,
      ratio,
      pausedTaskIds: [...tasks.values()]
        .filter(task => task.paused)
        .map(task => task.taskId),
    }
    emitSnapshot(next)
    if (
      level !== previousLevel ||
      action !== 'observing memory pressure; no task changed'
    ) {
      enqueuePressureNotification(next, action)
    }
  } finally {
    sampling = false
  }
}

function ensureMonitoring(): void {
  if (timer || tasks.size === 0) return
  void sample()
  timer = setInterval(() => void sample(), SAMPLE_INTERVAL_MS)
  timer.unref?.()
}

function stopMonitoringIfIdle(): void {
  if (tasks.size > 0 || !timer) return
  clearInterval(timer)
  timer = undefined
  emitSnapshot({
    level: 'normal',
    usedBytes: 0,
    limitBytes: 0,
    ratio: 0,
    pausedTaskIds: [],
  })
}

export function registerMemoryManagedShellTask(options: {
  taskId: string
  description: string
  shellCommand: ShellCommand
  agentId?: AgentId
  onPausedChange?: (paused: boolean) => void
}): () => void {
  const task: ManagedTask = {
    ...options,
    paused: false,
    terminating: false,
    rssBytes: 0,
  }
  tasks.set(options.taskId, task)
  if (snapshot.level === 'emergency') {
    task.terminating = true
    task.shellCommand.terminateForMemoryPressure()
  } else if (snapshot.level === 'critical' && task.shellCommand.pause()) {
    task.paused = true
    task.onPausedChange?.(true)
  }
  ensureMonitoring()
  return () => {
    const current = tasks.get(options.taskId)
    if (current !== task) return
    if (current.paused) current.shellCommand.resume()
    tasks.delete(options.taskId)
    stopMonitoringIfIdle()
  }
}

export function subscribeMemoryPressure(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getMemoryPressureSnapshot(): MemoryPressureSnapshot {
  return snapshot
}

export function resetMemoryPressureControllerForTests(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  tasks.clear()
  sampling = false
  lastProtectiveActionAt = 0
  snapshot = {
    level: 'normal',
    usedBytes: 0,
    limitBytes: 0,
    ratio: 0,
    pausedTaskIds: [],
  }
}
