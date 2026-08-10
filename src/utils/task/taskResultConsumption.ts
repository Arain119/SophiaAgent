import { resolve } from 'path'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../../tasks/types.js'
import { removePendingTaskNotification } from '../messageQueueManager.js'
import { appendAgentRunLedger } from '../../tasks/LocalAgentTask/agentTerminalArtifacts.js'

function isLocalAgentTask(
  task: TaskState | undefined,
): task is LocalAgentTaskState {
  return task?.type === 'local_agent'
}

export function markTaskResultConsumed(
  taskId: string,
  context: Pick<ToolUseContext, 'setAppState' | 'setAppStateForTasks'>,
): void {
  const setAppState = context.setAppStateForTasks ?? context.setAppState
  let changed = false
  let consumedLedger: LocalAgentTaskState['runLedger'] | undefined
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (
      !isLocalAgentTask(task) ||
      task.status === 'running' ||
      task.status === 'pending' ||
      task.consumedAt !== undefined
    ) {
      return prev
    }
    changed = true
    const consumedAt = Date.now()
    consumedLedger = task.runLedger
      ? { ...task.runLedger, consumedAt }
      : undefined
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...task,
          retrieved: true,
          notified: true,
          notificationQueued: false,
          consumedAt,
          ...(consumedLedger ? { runLedger: consumedLedger } : {}),
        },
      },
    }
  })
  if (changed) {
    removePendingTaskNotification(taskId)
    if (consumedLedger)
      void appendAgentRunLedger(consumedLedger).catch(() => {})
  }
}

export function markTaskOutputPathConsumed(
  filePath: string,
  context: Pick<
    ToolUseContext,
    'getAppState' | 'setAppState' | 'setAppStateForTasks'
  >,
): string | undefined {
  const normalized = resolve(filePath)
  const task = Object.values(context.getAppState().tasks).find(
    candidate =>
      isLocalAgentTask(candidate) &&
      [candidate.outputFile, candidate.resultFile, candidate.resultIndexFile]
        .filter((path): path is string => path !== undefined)
        .some(path => resolve(path) === normalized),
  )
  if (!task) return undefined
  markTaskResultConsumed(task.id, context)
  return task.id
}
