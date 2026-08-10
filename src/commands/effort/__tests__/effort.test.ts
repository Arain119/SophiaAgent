import { describe, expect, test } from 'bun:test'

const { executeEffort } = await import('../effort.js')

describe('executeEffort', () => {
  test('rejects removed auto and unset values', () => {
    for (const value of ['auto', 'unset']) {
      expect(executeEffort(value).message).toBe(
        `Invalid argument: ${value}. Valid options are: low, medium, high, xhigh, max`,
      )
    }
  })
})
