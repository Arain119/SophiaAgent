import { afterEach, describe, expect, test } from 'bun:test'
import {
  hasMetExtractionCooldown,
  markExtractionCompleted,
  resetSessionMemoryState,
  setSessionMemoryConfig,
} from '../sessionMemoryUtils.js'

describe('session memory extraction cooldown', () => {
  afterEach(resetSessionMemoryState)

  test('allows the first extraction', () => {
    expect(hasMetExtractionCooldown(1000)).toBe(true)
  })

  test('prevents repeated automatic extraction until the cooldown elapses', () => {
    const completedAt = Date.now()
    setSessionMemoryConfig({ minimumMsBetweenUpdates: 600_000 })
    markExtractionCompleted()
    expect(hasMetExtractionCooldown(completedAt + 599_999)).toBe(false)
    expect(hasMetExtractionCooldown(completedAt + 600_001)).toBe(true)
  })
})
