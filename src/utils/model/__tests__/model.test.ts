import { describe, expect, test } from 'bun:test'
import { firstPartyNameToCanonical } from '../model'

describe('firstPartyNameToCanonical', () => {
  test.each([
    'gpt-5.6-sol',
    'gpt-5.6-luna',
    'claude-opus-4-6-20250514',
    'us.anthropic.claude-opus-4-6-v1:0',
    'Claude-Opus-4-6-20250514',
    'unknown-model',
  ])('preserves the exact provider model ID %s', model => {
    expect(firstPartyNameToCanonical(model)).toBe(model)
  })
})
