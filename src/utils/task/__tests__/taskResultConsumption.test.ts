import { beforeEach, describe, expect, test } from 'bun:test'
import {
  getCommandQueue,
  resetCommandQueue,
  enqueuePendingNotification,
} from '../../messageQueueManager.js'
import {
  markTaskOutputPathConsumed,
  markTaskResultConsumed,
} from '../taskResultConsumption.js'

function createContext() {
  let state = {
    tasks: {
      'task-1': {
        id: 'task-1',
        type: 'local_agent' as const,
        status: 'completed' as const,
        outputFile: 'C:/tmp/task-1.output',
        resultFile: 'C:/tmp/task-1.result.txt',
        resultIndexFile: 'C:/tmp/task-1.index.json',
        retrieved: false,
        notified: true,
      },
    },
  }
  return {
    context: {
      getAppState: () => state,
      setAppState: (updater: (value: typeof state) => typeof state) => {
        state = updater(state)
      },
      setAppStateForTasks: undefined,
    },
    getState: () => state,
  }
}

beforeEach(resetCommandQueue)

describe('taskResultConsumption', () => {
  test('marks terminal output consumed and removes its pending notification', () => {
    const { context, getState } = createContext()
    enqueuePendingNotification({
      mode: 'task-notification',
      value: '<task-notification><task-id>task-1</task-id></task-notification>',
    } as any)

    markTaskResultConsumed('task-1', context as any)
    expect(getState().tasks['task-1'].retrieved).toBe(true)
    expect(
      (getState().tasks['task-1'] as { consumedAt?: number }).consumedAt,
    ).toBeNumber()
    expect(getCommandQueue()).toHaveLength(0)
  })

  test('recognizes result and index paths', () => {
    const { context, getState } = createContext()
    expect(
      markTaskOutputPathConsumed('C:/tmp/task-1.index.json', context as any),
    ).toBe('task-1')
    expect(getState().tasks['task-1'].retrieved).toBe(true)
  })
})
