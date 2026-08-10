import { describe, expect, test } from 'bun:test'
import {
  planPressureToolResultClearing,
  PRESSURE_KEEP_RECENT_RESULTS,
} from '../pressureToolResultPolicy.js'

describe('planPressureToolResultClearing', () => {
  test('does nothing below context pressure', () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      id: `tool-${index}`,
      tokens: 3000,
    }))
    expect(planPressureToolResultClearing(79_999, results)).toEqual([])
  })

  test('clears oldest results until the target is reached', () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      id: `tool-${index}`,
      tokens: 4000,
    }))
    expect(planPressureToolResultClearing(84_000, results)).toEqual([
      'tool-0',
      'tool-1',
      'tool-2',
      'tool-3',
      'tool-4',
    ])
  })

  test('always preserves the recent result window', () => {
    const results = Array.from({ length: 20 }, (_, index) => ({
      id: `tool-${index}`,
      tokens: 5000,
    }))
    const cleared = planPressureToolResultClearing(150_000, results)
    for (const result of results.slice(-PRESSURE_KEEP_RECENT_RESULTS)) {
      expect(cleared).not.toContain(result.id)
    }
  })
})
