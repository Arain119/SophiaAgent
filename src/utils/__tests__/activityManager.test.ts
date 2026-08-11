import { describe, expect, test } from 'bun:test'
import { shouldRecordUserActivity } from '../activityManager.js'

describe('shouldRecordUserActivity', () => {
  test('ignores slash command typing and the clear after submission', () => {
    expect(shouldRecordUserActivity('/plan', false)).toBe(false)
    expect(shouldRecordUserActivity('  /model', false)).toBe(false)
    expect(shouldRecordUserActivity('', true)).toBe(false)
  })

  test('records ordinary prompts and ordinary input clearing', () => {
    expect(shouldRecordUserActivity('continue', false)).toBe(true)
    expect(shouldRecordUserActivity('', false)).toBe(true)
    expect(shouldRecordUserActivity('continue', true)).toBe(true)
  })
})
