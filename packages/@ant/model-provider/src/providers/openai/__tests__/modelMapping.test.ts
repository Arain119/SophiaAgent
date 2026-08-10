import { describe, expect, test } from 'bun:test'
import { resolveOpenAIModel } from '../modelMapping.js'

describe('resolveOpenAIModel', () => {
  test('preserves exact configured model IDs', () => {
    expect(resolveOpenAIModel('gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(resolveOpenAIModel('gpt-5.6-luna')).toBe('gpt-5.6-luna')
    expect(resolveOpenAIModel('claude-opus-4-6')).toBe('claude-opus-4-6')
  })

  test('does not interpret model ID suffixes', () => {
    expect(resolveOpenAIModel('custom-model[1m]')).toBe('custom-model[1m]')
  })
})
