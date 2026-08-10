import { describe, expect, test } from 'bun:test'
import {
  getModeColor,
  EXECUTION_MODES,
  executionModeShortTitle,
  executionModeSymbol,
  executionModeTitle,
} from '../ExecutionMode.js'

describe('ExecutionMode', () => {
  test('only exposes auto and plan', () => {
    expect(EXECUTION_MODES).toEqual(['auto', 'plan'])
  })

  test('provides display metadata for the two internal states', () => {
    expect(executionModeTitle('auto')).toBe('Auto')
    expect(executionModeShortTitle('plan')).toBe('Plan')
    expect(executionModeSymbol('auto')).toBe('>>')
    expect(getModeColor('auto')).toBe('warning')
    expect(getModeColor('plan')).toBe('planMode')
  })
})
