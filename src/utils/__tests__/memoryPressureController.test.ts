import { describe, expect, test } from 'bun:test'
import {
  classifyMemoryPressure,
  selectMemoryPressureAction,
} from '../memoryPressureController.js'

describe('memory pressure classification', () => {
  test('keeps normal concurrency below the warning threshold', () => {
    expect(classifyMemoryPressure(0.74)).toBe('normal')
  })

  test('classifies warning, critical, and emergency pressure', () => {
    expect(classifyMemoryPressure(0.75)).toBe('warning')
    expect(classifyMemoryPressure(0.88)).toBe('critical')
    expect(classifyMemoryPressure(0.94)).toBe('emergency')
  })

  test('uses hysteresis before returning to normal', () => {
    expect(classifyMemoryPressure(0.72, 'critical')).toBe('warning')
    expect(classifyMemoryPressure(0.7, 'warning')).toBe('normal')
  })

  test('does not change tasks under ordinary memory usage', () => {
    expect(
      selectMemoryPressureAction({
        level: 'normal',
        ratio: 0.7,
        hasRunnableTask: true,
        hasPausedTask: false,
        hasTerminableTask: true,
        protectiveActionCooldownElapsed: true,
      }),
    ).toBe('none')
  })

  test('pauses gradually, resumes with headroom, and terminates at emergency', () => {
    const common = {
      hasRunnableTask: true,
      hasPausedTask: true,
      hasTerminableTask: true,
      protectiveActionCooldownElapsed: true,
    }
    expect(
      selectMemoryPressureAction({
        ...common,
        level: 'critical',
        ratio: 0.9,
      }),
    ).toBe('pause')
    expect(
      selectMemoryPressureAction({
        ...common,
        level: 'critical',
        ratio: 0.9,
        protectiveActionCooldownElapsed: false,
      }),
    ).toBe('none')
    expect(
      selectMemoryPressureAction({
        ...common,
        level: 'warning',
        ratio: 0.79,
      }),
    ).toBe('resume')
    expect(
      selectMemoryPressureAction({
        ...common,
        level: 'emergency',
        ratio: 0.95,
      }),
    ).toBe('terminate')
  })
})
