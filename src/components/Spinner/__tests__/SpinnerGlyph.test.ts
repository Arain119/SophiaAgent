import { describe, expect, test } from 'bun:test'
import { stringWidth } from '@anthropic/ink'
import {
  EFFORT_WAVE_RADIUS,
  EFFORT_WAVE_WIDTH,
  getEffortWaveParticleCount,
  MODEL_SPINNER_FRAME_MS,
  MODEL_SPINNER_FRAMES,
  MODEL_SPINNER_WIDTH,
} from '../SpinnerGlyph.js'

describe('model spinner glyph', () => {
  test('uses the original single-character rotating circle', () => {
    expect(MODEL_SPINNER_WIDTH).toBe(2)
    expect(MODEL_SPINNER_FRAME_MS).toBe(80)
    expect(MODEL_SPINNER_FRAMES).toEqual([
      '\u280b',
      '\u2819',
      '\u2839',
      '\u2838',
      '\u283c',
      '\u2834',
      '\u2826',
      '\u2827',
      '\u2807',
      '\u280f',
    ])
    expect(
      new Set(MODEL_SPINNER_FRAMES.map(frame => stringWidth(frame))),
    ).toEqual(new Set([1]))
  })
})

describe('effort panel wave', () => {
  test('grows in radius and particle count with every effort level', () => {
    expect(EFFORT_WAVE_WIDTH).toBe(11)
    expect(EFFORT_WAVE_RADIUS).toEqual({
      low: 1,
      medium: 2,
      high: 3,
      xhigh: 4,
      max: 5,
    })
    expect(
      ['low', 'medium', 'high', 'xhigh', 'max'].map(level =>
        getEffortWaveParticleCount(level as keyof typeof EFFORT_WAVE_RADIUS),
      ),
    ).toEqual([3, 5, 7, 9, 11])
  })
})
