import { describe, expect, test } from 'bun:test'
import { buildInheritedCliFlags } from '../spawnUtils'

describe('buildInheritedCliFlags', () => {
  test('does not propagate permission flags to process-based teammates', () => {
    const flags = buildInheritedCliFlags()

    expect(flags).not.toContain('--permission-mode')
  })
})
