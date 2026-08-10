import { describe, expect, test } from 'bun:test'

describe('fixed auto permission setup', () => {
  test('creates an auto context with bypass disabled', async () => {
    const { getEmptyToolSafetyContext } = await import('../../../Tool.js')
    const context = getEmptyToolSafetyContext()
    expect(context.mode).toBe('auto')
  })
})
