import { afterEach, describe, expect, test } from 'bun:test'
import {
  calculateTokenWarningState,
  getAutoCompactThreshold,
} from '../autoCompact.js'
import {
  MODEL_AUTO_COMPACT_THRESHOLD,
  MODEL_CONTEXT_WINDOW_DEFAULT,
} from '../../../utils/context.js'

afterEach(() => {
  delete process.env.OPENAI_CONTEXT_WINDOW
  delete process.env.SOPHIA_AUTO_COMPACT_WINDOW
  delete process.env.SOPHIA_AUTOCOMPACT_PCT_OVERRIDE
})

describe('Sophia context policy', () => {
  test('uses the 272k context window and 250k auto-compact threshold', () => {
    expect(MODEL_CONTEXT_WINDOW_DEFAULT).toBe(272_000)
    expect(getAutoCompactThreshold('gpt-5.6-sol')).toBe(
      MODEL_AUTO_COMPACT_THRESHOLD,
    )
  })

  test('does not compact immediately before the threshold', () => {
    const below = calculateTokenWarningState(249_999, 'gpt-5.6-sol')
    expect(below.isAboveAutoCompactThreshold).toBe(false)
  })

  test('starts compacting at exactly 250k', () => {
    const atThreshold = calculateTokenWarningState(250_000, 'gpt-5.6-sol')
    expect(atThreshold.isAboveAutoCompactThreshold).toBe(true)
  })

  test('respects a smaller explicit test window', () => {
    process.env.SOPHIA_AUTO_COMPACT_WINDOW = '100000'
    expect(getAutoCompactThreshold('gpt-5.6-sol')).toBe(90_000)
  })
})
