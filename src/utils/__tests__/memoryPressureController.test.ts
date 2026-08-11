import { describe, expect, test } from 'bun:test'
import {
  classifyMemoryPressure,
  readEffectiveCpuQuota,
  readMemoryUsage,
  selectMemoryPressureAction,
} from '../memoryPressureController.js'

function fileReader(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const value = files[path]
    if (value === undefined) throw new Error(`Missing test file: ${path}`)
    return value
  }
}

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

describe('effective resource discovery', () => {
  test('reads cgroup v2 memory usage and CPU quota', async () => {
    const readFileText = fileReader({
      '/sys/fs/cgroup/memory.current': String(1.5 * 1024 ** 3),
      '/sys/fs/cgroup/memory.max': String(2 * 1024 ** 3),
      '/sys/fs/cgroup/cpu.max': '50000 100000',
    })

    expect(await readMemoryUsage({ readFileText })).toEqual({
      usedBytes: 1.5 * 1024 ** 3,
      limitBytes: 2 * 1024 ** 3,
    })
    expect(
      await readEffectiveCpuQuota({ readFileText, hostCpuCount: () => 64 }),
    ).toBe(0.5)
  })

  test('falls back to cgroup v1 and caps quota to available host CPUs', async () => {
    const readFileText = fileReader({
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '800000',
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
    })

    expect(
      await readEffectiveCpuQuota({ readFileText, hostCpuCount: () => 4 }),
    ).toBe(4)
  })

  test('uses host resources when no cgroup limit is available', async () => {
    const readFileText = fileReader({
      '/sys/fs/cgroup/memory.max': 'max',
      '/sys/fs/cgroup/cpu.max': 'max 100000',
    })

    expect(
      await readMemoryUsage({
        readFileText,
        totalMemory: () => 16 * 1024 ** 3,
        freeMemory: () => 10 * 1024 ** 3,
      }),
    ).toEqual({
      usedBytes: 6 * 1024 ** 3,
      limitBytes: 16 * 1024 ** 3,
    })
    expect(
      await readEffectiveCpuQuota({ readFileText, hostCpuCount: () => 6 }),
    ).toBe(6)
  })
})
