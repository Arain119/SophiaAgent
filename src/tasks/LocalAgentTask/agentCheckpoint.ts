import { mkdir, readFile, readdir, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { getCwd } from '../../utils/cwd.js'
import type { LocalAgentTaskState } from './LocalAgentTask.js'

const checkpointWrites = new Map<string, Promise<void>>()

export type AgentCheckpoint = {
  schemaVersion: 1
  sessionId: string
  agentId: string
  agentType: string
  description: string
  prompt: string
  cwd: string
  model?: string
  provider?: string
  effort?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  startTime: number
  updatedAt: number
  lastActivity?: string
  summary?: string
  toolUseCount: number
  tokenCount: number
  remainingWork?: string[]
  lastError?: string
}

function checkpointPath(agentId: string): string {
  return join(
    getCwd(),
    '.sophia',
    'checkpoints',
    getSessionId(),
    'agents',
    `${agentId}.json`,
  )
}

function checkpointDirectory(): string {
  return dirname(checkpointPath('checkpoint'))
}

function isAgentCheckpoint(value: unknown): value is AgentCheckpoint {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.agentId === 'string' &&
    typeof candidate.agentType === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.cwd === 'string' &&
    typeof candidate.startTime === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    ['pending', 'running', 'completed', 'failed', 'killed'].includes(
      String(candidate.status),
    )
  )
}

export async function loadAgentCheckpoints(): Promise<AgentCheckpoint[]> {
  try {
    const files = await readdir(checkpointDirectory())
    const checkpoints = await Promise.all(
      files
        .filter(file => file.endsWith('.json'))
        .map(async file => {
          try {
            const value: unknown = JSON.parse(
              await readFile(join(checkpointDirectory(), file), 'utf8'),
            )
            return isAgentCheckpoint(value) ? value : undefined
          } catch {
            return undefined
          }
        }),
    )
    return checkpoints.filter(
      (checkpoint): checkpoint is AgentCheckpoint => checkpoint !== undefined,
    )
  } catch {
    return []
  }
}

function safePrompt(prompt: string): string {
  if (
    /(?:password|passwd|密码|api[_ -]?key|secret|token|sk-[a-z0-9])/i.test(
      prompt,
    )
  ) {
    return '[redacted: credentials detected]'
  }
  return prompt
}

export function buildAgentCheckpoint(
  task: LocalAgentTaskState,
): AgentCheckpoint {
  const activity = task.progress?.lastActivity
  return {
    schemaVersion: 1,
    sessionId: getSessionId(),
    agentId: task.agentId,
    agentType: task.agentType,
    description: task.description,
    prompt: safePrompt(task.prompt),
    cwd: getCwd(),
    model: task.model,
    provider: task.provider,
    effort: task.effort,
    status: task.status,
    startTime: task.startTime,
    updatedAt: Date.now(),
    lastActivity: activity?.activityDescription ?? activity?.toolName,
    summary: task.progress?.summary ?? task.terminalMemory?.outcome,
    toolUseCount: task.progress?.toolUseCount ?? 0,
    tokenCount: task.progress?.tokenCount ?? 0,
    remainingWork: task.terminalMemory?.remainingWork,
    lastError: task.error,
  }
}

export function writeAgentCheckpoint(task: LocalAgentTaskState): void {
  const checkpoint = buildAgentCheckpoint(task)
  const path = checkpointPath(task.agentId)
  const temporary = `${path}.${process.pid}.tmp`
  const previous = checkpointWrites.get(task.agentId) ?? Promise.resolve()
  const write = previous
    .catch(() => {})
    .then(() => mkdir(dirname(path), { recursive: true }))
    .then(() =>
      writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      }),
    )
    .then(() => rename(temporary, path))
    .catch(() => {})
  checkpointWrites.set(task.agentId, write)
  void write.finally(() => {
    if (checkpointWrites.get(task.agentId) === write)
      checkpointWrites.delete(task.agentId)
  })
}
