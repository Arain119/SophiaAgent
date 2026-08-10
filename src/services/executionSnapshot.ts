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
}

export type ExecutionSnapshot = {
  type: 'execution_snapshot'
  activeCount: number
  tasks: ExecutionSnapshotTask[]
  omittedCount: number
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
