import { describe, expect, test } from 'bun:test'
import type { BackgroundTaskState } from '../types.js'
import { getPillLabel } from '../pillLabel.js'

function task(type: BackgroundTaskState['type']): BackgroundTaskState {
  return { type } as BackgroundTaskState
}

describe('getPillLabel', () => {
  test('uses the unified agent label for in-process agents', () => {
    expect(getPillLabel([task('in_process_teammate')])).toBe('1 agent')
    expect(
      getPillLabel([task('in_process_teammate'), task('in_process_teammate')]),
    ).toBe('2 agents')
  })

  test('uses concise labels for each activity type', () => {
    expect(getPillLabel([task('local_agent')])).toBe('1 agent')
    expect(getPillLabel([task('local_bash')])).toBe('1 shell')
    expect(getPillLabel([task('local_workflow')])).toBe('1 workflow')
  })

  test('uses activity terminology for mixed work', () => {
    expect(getPillLabel([task('local_agent'), task('local_bash')])).toBe(
      '2 activities',
    )
  })
})
