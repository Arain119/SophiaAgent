import { describe, expect, test } from 'bun:test'
import { BUILD_FEATURES, getBuildFeatures } from '../defines.ts'

describe('build features', () => {
  test('ships one Core product without optional features', () => {
    expect(BUILD_FEATURES).toEqual([])
    expect(getBuildFeatures()).toEqual([])
  })

  test('returns a fresh feature list', () => {
    expect(getBuildFeatures()).not.toBe(getBuildFeatures())
  })
})
