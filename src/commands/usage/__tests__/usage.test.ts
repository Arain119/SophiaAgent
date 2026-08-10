import { describe, expect, test } from 'bun:test'
import type { ModelUsage } from '../../../entrypoints/agentSdkTypes.js'
import { calculateCostBreakdown } from '../../../utils/modelCost.js'
import { formatUsageReport } from '../index.js'

function usage(values: Partial<ModelUsage>): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    ...values,
  }
}

describe('formatUsageReport', () => {
  test('shows an empty session without fabricating cost', () => {
    expect(formatUsageReport({})).toBe(
      'No model usage recorded in this session.',
    )
  })

  test('calculates per-category cost and cache hit rate', () => {
    const report = formatUsageReport({
      'gpt-5.6-sol': usage({
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheCreationInputTokens: 200_000,
        cacheReadInputTokens: 800_000,
      }),
    })

    expect(report).toContain('Total cost     $9.650000')
    expect(report).toContain('Cache hit      40.0%')
    expect(report).toContain('gpt-5.6-sol  $9.650000')
    expect(report).toContain('x $5/M = $5.000000')
    expect(report).toContain('x $30/M = $3.000000')
    expect(report).toContain('x $6.25/M = $1.250000')
    expect(report).toContain('x $0.5/M = $0.400000')
  })

  test('uses the fixed rates for every Sophia model', () => {
    const oneMillionEach = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    }

    expect(calculateCostBreakdown('gpt-5.6-sol', oneMillionEach).total).toBe(
      41.75,
    )
    expect(calculateCostBreakdown('gpt-5.6-luna', oneMillionEach).total).toBe(
      1.67,
    )
  })

  test('marks missing cache-write usage as unreported', () => {
    const report = formatUsageReport({
      'gpt-5.6-sol': usage({
        inputTokens: 10_000,
        outputTokens: 100,
        cacheReadInputTokens: 5_000,
      }),
    })

    expect(report).toContain('Estimated cost')
    expect(report).toContain('Cache write    N/A (not reported)')
    expect(report).toContain('Cache write  N/A (not reported)')
    expect(report).not.toContain('x $6.25/M = $0.000000')
  })
})
