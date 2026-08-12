import type { AppState } from '../state/AppState.js'
import type { TaskState } from '../tasks/types.js'
import type { RunProgress } from '../workflow/progress/store.js'
import { getWorkNode } from '../tasks/workNodes.js'

const MAX_VISIBLE_TASKS = 48
const MAX_TEXT_LENGTH = 240

export type ExecutionSnapshotAgent = {
  id: string
  label?: string
  phase?: string
  status: 'running' | 'done'
  result?: string
  toolCount?: number
  tokenCount?: number
  workNodeId?: string
  workNodeParentId?: string
  workNodeContextTokens?: number
  workNodeFiles?: string[]
}

export type ExecutionSnapshotTask = {
  id: string
  type: TaskState['type']
  status: 'pending' | 'running'
  description: string
  outputFile: string
  detail?: string
  summary?: string
  activity?: string
  toolCount?: number
  tokenCount?: number
  workflowRunId?: string
  workflowPhase?: string
  workflowAgents?: ExecutionSnapshotAgent[]
  elapsedMs: number
}

export type ExecutionSnapshot = {
  type: 'execution_snapshot'
  activeCount: number
  tasks: ExecutionSnapshotTask[]
  omittedCount: number
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}

export function formatExecutionStatus(
  snapshot: ExecutionSnapshot | null,
  maxLength = 100,
): string | undefined {
  if (!snapshot || snapshot.tasks.length === 0) return undefined
  const task = snapshot.tasks.reduce((selected, candidate) =>
    candidate.elapsedMs > selected.elapsedMs ? candidate : selected,
  )
  const phase = task.workflowPhase ?? task.status
  const activity = task.activity ?? task.summary ?? task.description
  const count =
    snapshot.activeCount > 1 ? ` · ${snapshot.activeCount} active` : ''
  const full = `${phase} · ${activity} · ${formatElapsed(task.elapsedMs)}${count}`
  if (full.length <= maxLength) return full
  const fixed = `${phase} ·  · ${formatElapsed(task.elapsedMs)}${count}`
  const available = Math.max(8, maxLength - fixed.length)
  return `${phase} · ${activity.slice(0, available - 3)}... · ${formatElapsed(task.elapsedMs)}${count}`
}

function compactText(value: string | undefined): string | undefined {
  if (!value) return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length <= MAX_TEXT_LENGTH
    ? compact
    : `${compact.slice(0, MAX_TEXT_LENGTH - 3)}...`
}

function matchingWorkflowRun(
  task: Extract<TaskState, { type: 'local_workflow' }>,
  workflowRuns: readonly RunProgress[],
): RunProgress | undefined {
  if (task.runId) {
    const exact = workflowRuns.find(run => run.runId === task.runId)
    if (exact) return exact
  }
  return workflowRuns.find(
    run => run.status === 'running' && run.workflowName === task.workflowName,
  )
}

function taskDetail(task: TaskState): string | undefined {
  switch (task.type) {
    case 'local_agent':
      return compactText(
        `agent=${task.agentType}${task.model ? ` model=${task.model}` : ''}${task.provider ? ` provider=${task.provider}` : ''}${task.effort ? ` effort=${task.effort}` : ''}${task.isExactContext ? ' route=main-cache' : ''}`,
      )
    case 'in_process_teammate':
      return compactText(
        `teammate=${task.identity.agentName} team=${task.identity.teamName} ${task.isIdle ? 'idle' : 'working'}`,
      )
    case 'local_bash':
      return compactText(`command: ${task.command}`)
    case 'local_workflow':
      return compactText(`workflow=${task.workflowName}`)
  }
}

function progressFields(
  task: TaskState,
): Pick<
  ExecutionSnapshotTask,
  'summary' | 'activity' | 'toolCount' | 'tokenCount'
> {
  if (task.type !== 'local_agent' && task.type !== 'in_process_teammate') {
    return {}
  }
  const progress = task.progress
  return {
    ...(compactText(progress?.summary)
      ? { summary: compactText(progress?.summary) }
      : {}),
    ...(compactText(
      progress?.lastActivity?.activityDescription ??
        progress?.lastActivity?.toolName,
    )
      ? {
          activity: compactText(
            progress?.lastActivity?.activityDescription ??
              progress?.lastActivity?.toolName,
          ),
        }
      : {}),
    ...(progress?.toolUseCount !== undefined
      ? { toolCount: progress.toolUseCount }
      : {}),
    ...(progress?.tokenCount !== undefined
      ? { tokenCount: progress.tokenCount }
      : {}),
  }
}

function workflowFields(
  task: Extract<TaskState, { type: 'local_workflow' }>,
  workflowRuns: readonly RunProgress[],
): Pick<
  ExecutionSnapshotTask,
  'workflowRunId' | 'workflowPhase' | 'workflowAgents'
> {
  const run = matchingWorkflowRun(task, workflowRuns)
  if (!run) {
    return task.runId ? { workflowRunId: task.runId } : {}
  }
  return {
    workflowRunId: run.runId,
    ...(run.currentPhase ? { workflowPhase: run.currentPhase } : {}),
    workflowAgents: run.agents.map(agent => ({
      id: String(agent.id),
      ...(compactText(agent.label) ? { label: compactText(agent.label) } : {}),
      ...(compactText(agent.phase) ? { phase: compactText(agent.phase) } : {}),
      status: agent.status,
      ...(agent.resultKind ? { result: agent.resultKind } : {}),
      ...(agent.toolCount !== undefined ? { toolCount: agent.toolCount } : {}),
      ...(agent.tokenCount !== undefined
        ? { tokenCount: agent.tokenCount }
        : {}),
    })),
  }
}

export function createExecutionSnapshot(
  state: AppState,
  workflowRuns: readonly RunProgress[],
  now = Date.now(),
): ExecutionSnapshot | null {
  const active = Object.values(state.tasks)
    .filter(
      (task): task is TaskState & { status: 'pending' | 'running' } =>
        task.status === 'pending' || task.status === 'running',
    )
    .sort((a, b) => a.startTime - b.startTime)

  if (active.length === 0) return null

  const visible = active.slice(0, MAX_VISIBLE_TASKS)
  const tasks = visible.map(task => {
    const workNode =
      task.type === 'local_agent' ? getWorkNode(task.id) : undefined
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      description: compactText(task.description) ?? task.type,
      outputFile: task.outputFile,
      elapsedMs: Math.max(0, now - task.startTime),
      ...(taskDetail(task) ? { detail: taskDetail(task) } : {}),
      ...progressFields(task),
      ...(workNode ? { workNodeId: workNode.id } : {}),
      ...(workNode?.parentId ? { workNodeParentId: workNode.parentId } : {}),
      ...(workNode?.contextTokens !== undefined
        ? { workNodeContextTokens: workNode.contextTokens }
        : {}),
      ...(workNode?.fileClaims.length
        ? {
            workNodeFiles: workNode.fileClaims.map(
              claim => `${claim.access}:${claim.path}`,
            ),
          }
        : {}),
      ...(task.type === 'local_workflow'
        ? workflowFields(task, workflowRuns)
        : {}),
    }
  })

  return {
    type: 'execution_snapshot',
    activeCount: active.length,
    tasks,
    omittedCount: Math.max(0, active.length - visible.length),
  }
}
