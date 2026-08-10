import { describe, expect, test } from 'bun:test'
import { CROSS_PLATFORM_CODE_EXEC } from '../dangerousPatterns'

describe('CROSS_PLATFORM_CODE_EXEC', () => {
  test('contains common interpreters and package runners', () => {
    expect(CROSS_PLATFORM_CODE_EXEC).toContain('python')
    expect(CROSS_PLATFORM_CODE_EXEC).toContain('node')
    expect(CROSS_PLATFORM_CODE_EXEC).toContain('npx')
    expect(CROSS_PLATFORM_CODE_EXEC).toContain('bunx')
  })

  test('contains no duplicates or empty entries', () => {
    expect(new Set(CROSS_PLATFORM_CODE_EXEC).size).toBe(
      CROSS_PLATFORM_CODE_EXEC.length,
    )
    for (const entry of CROSS_PLATFORM_CODE_EXEC) {
      expect(entry.length).toBeGreaterThan(0)
    }
  })
})
