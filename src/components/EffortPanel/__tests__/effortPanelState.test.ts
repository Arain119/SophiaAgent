import { describe, expect, test } from 'bun:test'
import {
  type ApplyFn,
  CANCEL_MESSAGE,
  computeConfirmOutcome,
  END_POSITION,
  getInitialCursor,
  HOME_POSITION,
  moveLeft,
  moveRight,
  PANEL_POSITIONS,
  type PanelPosition,
} from '../effortPanelState.js'

describe('effortPanelState', () => {
  test('contains exactly the five supported effort levels', () => {
    expect(PANEL_POSITIONS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  test('moves left and clamps at low', () => {
    expect(moveLeft('low')).toBe('low')
    expect(moveLeft('high')).toBe('medium')
    expect(moveLeft('max')).toBe('xhigh')
  })

  test('moves right and clamps at max', () => {
    expect(moveRight('medium')).toBe('high')
    expect(moveRight('xhigh')).toBe('max')
    expect(moveRight('max')).toBe('max')
  })

  test('defines low and max as navigation boundaries', () => {
    expect(HOME_POSITION).toBe('low')
    expect(END_POSITION).toBe('max')
  })

  test('uses a valid environment override as the initial cursor', () => {
    expect(
      getInitialCursor({
        envOverride: 'xhigh',
        appStateEffort: 'medium',
        displayed: 'high',
      }),
    ).toBe('xhigh')
  })

  test('falls back to displayed effort without an environment override or for numeric values', () => {
    expect(
      getInitialCursor({
        envOverride: undefined,
        appStateEffort: undefined,
        displayed: 'medium',
      }),
    ).toBe('medium')
    expect(
      getInitialCursor({
        envOverride: 75,
        appStateEffort: 'medium',
        displayed: 'high',
      }),
    ).toBe('high')
  })

  test('PanelPosition accepts each named effort level', () => {
    const position: PanelPosition = 'xhigh'
    expect(position).toBe('xhigh')
  })
})

describe('computeConfirmOutcome', () => {
  const apply: ApplyFn = cursor => ({
    message: 'applied:' + cursor,
    effortUpdate: { value: cursor },
  })

  test('applies the selected effort and forwards its update', () => {
    const outcome = computeConfirmOutcome('max', apply)
    expect(outcome).toEqual({
      kind: 'apply',
      message: 'applied:max',
      effortUpdate: { value: 'max' },
    })
  })

  test('supports an apply result without an effort update', () => {
    const outcome = computeConfirmOutcome('medium', cursor => ({
      message: 'applied:' + cursor,
    }))
    expect(outcome.effortUpdate).toBeUndefined()
  })
})

test('cancel message is stable', () => {
  expect(CANCEL_MESSAGE).toBe('Effort unchanged.')
})
