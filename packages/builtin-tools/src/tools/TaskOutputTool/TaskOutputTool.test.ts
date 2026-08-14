import { describe, expect, test } from 'bun:test'
import type { TaskState } from 'src/tasks/types.js'
import {
  getTaskWaitPollDelay,
  resolveInteractiveWaitTimeout,
  resolveTaskOutputMaxChars,
  summarizeRunningTaskOutput,
  TaskOutputTool,
  waitForTaskCompletion,
} from './TaskOutputTool.js'

describe('TaskOutputTool compact polling UI', () => {
  test('uses action-oriented labels without implementation jargon', () => {
    expect(TaskOutputTool.userFacingName({ block: false } as never)).toBe(
      'Check task',
    )
    expect(TaskOutputTool.userFacingName({ block: true } as never)).toBe(
      'Wait for task',
    )
    expect(
      TaskOutputTool.renderToolUseMessage(
        { block: false } as never,
        {} as never,
      ),
    ).toBe('')
  })

  test('shows only the latest non-empty progress line', () => {
    const summary = summarizeRunningTaskOutput(
      'first\n\n[028/120] all assertions passed\n',
    )
    expect(summary).toContain('[028/120] all assertions passed')
    expect(summary).toContain('2 lines')
    expect(summary).not.toContain('first')
  })

  test('truncates unbounded progress lines', () => {
    const summary = summarizeRunningTaskOutput('x'.repeat(200))
    expect(summary?.length).toBe(120)
    expect(summary?.endsWith('…')).toBe(true)
  })

  test('omits progress detail when no output exists', () => {
    expect(summarizeRunningTaskOutput(' \n\r\n')).toBeNull()
  })

  test('bounds running output while preserving explicit retrieval limits', () => {
    expect(resolveTaskOutputMaxChars('running')).toBe(4_000)
    expect(resolveTaskOutputMaxChars('pending')).toBe(4_000)
    expect(resolveTaskOutputMaxChars('completed')).toBe(20_000)
    expect(resolveTaskOutputMaxChars('running', 50_000)).toBe(50_000)
  })

  test('reduces wakeups as a blocking wait gets longer', () => {
    expect(getTaskWaitPollDelay(0)).toBe(250)
    expect(getTaskWaitPollDelay(1_000)).toBe(500)
    expect(getTaskWaitPollDelay(5_000)).toBe(1_000)
  })

  test('supports an event-driven completion subscription', async () => {
    let task = { id: 'job-1', status: 'running' } as unknown as TaskState
    const listeners = new Set<() => void>()
    const resultPromise = waitForTaskCompletion(
      'job-1',
      () => ({ tasks: { 'job-1': task } }),
      1_000,
      undefined,
      listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    )
    task = { id: 'job-1', status: 'completed' } as unknown as TaskState
    for (const listener of listeners) listener()
    await expect(resultPromise).resolves.toMatchObject({ status: 'completed' })
  })

  test('caps interactive waits at 30 seconds', () => {
    expect(resolveInteractiveWaitTimeout(600_000)).toBe(30_000)
    expect(resolveInteractiveWaitTimeout(5_000)).toBe(5_000)
  })

  test('deduplicates concurrent subscriptions for the same task', async () => {
    let task = { id: 'job-shared', status: 'running' } as unknown as TaskState
    const listeners = new Set<() => void>()
    let subscriptions = 0
    const subscribe = (listener: () => void) => {
      subscriptions++
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const getState = () => ({ tasks: { 'job-shared': task } })
    const first = waitForTaskCompletion(
      'job-shared',
      getState,
      1_000,
      undefined,
      subscribe,
    )
    const second = waitForTaskCompletion(
      'job-shared',
      getState,
      1_000,
      undefined,
      subscribe,
    )
    expect(subscriptions).toBe(1)
    task = { id: 'job-shared', status: 'completed' } as unknown as TaskState
    for (const listener of listeners) listener()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(listeners.size).toBe(0)
  })

  test('aborting one waiter does not cancel the shared task wait', async () => {
    let task = { id: 'job-abort', status: 'running' } as unknown as TaskState
    const listeners = new Set<() => void>()
    const subscribe = (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const getState = () => ({ tasks: { 'job-abort': task } })
    const abort = new AbortController()
    const cancelled = waitForTaskCompletion(
      'job-abort',
      getState,
      1_000,
      abort,
      subscribe,
    )
    const remaining = waitForTaskCompletion(
      'job-abort',
      getState,
      1_000,
      undefined,
      subscribe,
    )
    abort.abort()
    await expect(cancelled).rejects.toBeInstanceOf(Error)
    task = { id: 'job-abort', status: 'completed' } as unknown as TaskState
    for (const listener of listeners) listener()
    await expect(remaining).resolves.toMatchObject({ status: 'completed' })
  })
})
