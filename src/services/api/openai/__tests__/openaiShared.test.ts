import { describe, expect, test } from 'bun:test'
import {
  formatOpenAIPromptCacheKey,
  updateOpenAIUsage,
} from '../openaiShared.js'

describe('formatOpenAIPromptCacheKey', () => {
  test('returns a stable session routing key', () => {
    const first = formatOpenAIPromptCacheKey(
      '7b0d6234-2cbf-4c7e-8663-1552985cbca6',
      'gpt-5.6-sol',
      'https://example.test/v1',
    )
    const second = formatOpenAIPromptCacheKey(
      '7b0d6234-2cbf-4c7e-8663-1552985cbca6',
      'gpt-5.6-sol',
      'https://example.test/v1',
    )

    expect(first).toBe(second)
    expect(first).toStartWith('sophia:v1:gpt-5.6-sol:')
    expect(first.length).toBeLessThanOrEqual(64)
  })

  test('isolates sessions, models, and providers', () => {
    const baseline = formatOpenAIPromptCacheKey(
      'session-1',
      'gpt-5.6-sol',
      'https://one.test/v1',
    )

    expect(
      formatOpenAIPromptCacheKey(
        'session-2',
        'gpt-5.6-sol',
        'https://one.test/v1',
      ),
    ).not.toBe(baseline)
    expect(
      formatOpenAIPromptCacheKey(
        'session-1',
        'gpt-5.6-luna',
        'https://one.test/v1',
      ),
    ).not.toBe(baseline)
    expect(
      formatOpenAIPromptCacheKey(
        'session-1',
        'gpt-5.6-sol',
        'https://two.test/v1',
      ),
    ).not.toBe(baseline)
  })

  test('caps keys for unusually long model and session identifiers', () => {
    const key = formatOpenAIPromptCacheKey(
      'session-'.repeat(20),
      'provider/model-with-an-unusually-long-version-name',
      'https://example.test/v1',
    )

    expect(key.length).toBeLessThanOrEqual(64)
    expect(key).toStartWith('sophia:v1:provider/model-')
  })
})

describe('updateOpenAIUsage', () => {
  test('preserves cache fields omitted by later deltas', () => {
    expect(
      updateOpenAIUsage(
        {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 4,
        },
        { output_tokens: 5 },
      ),
    ).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 4,
    })
  })
})
