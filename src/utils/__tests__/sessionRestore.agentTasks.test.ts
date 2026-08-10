import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import type { AgentRunLedger } from '../../tasks/LocalAgentTask/agentTerminalArtifacts.js'
import { clearCommandQueue, dequeue } from '../messageQueueManager.js'
import { restoreAgentTasksFromLedgers } from '../sessionRestore.js'
import {
  getBlackboardFacts,
  getWorkNode,
  resetWorkNodesForTest,
} from '../../tasks/workNodes.js'

afterEach(() => {
  clearCommandQueue()
  resetWorkNodesForTest()
})

function ledger(taskId: string, consumedAt?: number): AgentRunLedger {
  return {
    taskId,
    agentType: 'Explore',
    description: `restore ${taskId}`,
    prompt: `inspect ${taskId}`,
    toolUseId: `tool-${taskId}`,
    model: 'sub-model',
    provider: 'sub-provider',
    effort: 'medium',
    isExactContext: false,
    status: 'completed',
    startTime: 1,
    endTime: 2,
    consumedAt,
    terminalMemory: {
      outcome: `${taskId} completed`,
      decisions: [],
      evidence: [],
      verification: ['tests passed'],
      remainingWork: [],
    },
  }
}

describe('restoreAgentTasksFromLedgers', () => {
  test('rehydrates terminal tasks and queues only unconsumed results', () => {
    let state = { tasks: {} } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }

    expect(
      restoreAgentTasksFromLedgers(
        [ledger('task-pending'), ledger('task-consumed', 3)],
        setAppState,
      ),
    ).toBe(2)

    expect(state.tasks['task-pending']).toMatchObject({
      status: 'completed',
      notificationQueued: true,
      notified: false,
      retrieved: false,
    })
    expect(state.tasks['task-consumed']).toMatchObject({
      status: 'completed',
      notificationQueued: false,
      notified: true,
      retrieved: true,
      consumedAt: 3,
    })
    expect(getWorkNode('task-pending')).toMatchObject({
      status: 'completed',
      toolUseId: 'tool-task-pending',
    })
    expect(getBlackboardFacts().map(fact => fact.value)).toContain(
      'tests passed',
    )
    const notification = dequeue()
    expect(notification?.value).toContain('<task-id>task-pending</task-id>')
    expect(dequeue()).toBeUndefined()
  })

  test('does not restore interrupted running records as terminal tasks', () => {
    let state = { tasks: {} } as unknown as AppState
    const running = { ...ledger('task-running'), status: 'running' as const }
    expect(
      restoreAgentTasksFromLedgers([running], updater => {
        state = updater(state)
      }),
    ).toBe(0)
    expect(state.tasks).toEqual({})
    expect(dequeue()).toBeUndefined()
  })
})
