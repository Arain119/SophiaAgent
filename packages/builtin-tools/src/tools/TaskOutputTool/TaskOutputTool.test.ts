import { describe, expect, test } from 'bun:test'
import {
  getTaskWaitPollDelay,
  resolveTaskOutputMaxChars,
  summarizeRunningTaskOutput,
  TaskOutputTool,
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
})
