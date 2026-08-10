import { describe, expect, test } from 'bun:test'
import {
  EFFORT_RIPPLE_CONFIG,
  createEffortRippleRows,
  getEffortRippleOrigin,
  type EffortRippleSegment,
} from '../EffortRippleSurface.js'
import { PANEL_POSITIONS } from '../effortPanelState.js'

function expandRow(
  row: EffortRippleSegment[],
): Array<{ char: string; color: string }> {
  return row.flatMap(segment =>
    [...segment.text].map(char => ({
      char,
      color: String(segment.color),
    })),
  )
}

describe('effort ripple surface', () => {
  test('anchors every wave at the center of its selected label segment', () => {
    expect(
      PANEL_POSITIONS.map(position => getEffortRippleOrigin(10, position)),
    ).toEqual([
      { x: 5, y: 6 },
      { x: 15, y: 6 },
      { x: 25, y: 6 },
      { x: 35, y: 6 },
      { x: 45, y: 6 },
    ])
  })

  test('deepens and adds rings and particles for each effort level', () => {
    const configs = PANEL_POSITIONS.map(
      position => EFFORT_RIPPLE_CONFIG[position],
    )
    expect(configs.map(config => config.rings)).toEqual([1, 2, 3, 4, 5])
    for (let index = 1; index < configs.length; index += 1) {
      expect(configs[index]!.density).toBeGreaterThan(
        configs[index - 1]!.density,
      )
      expect(configs[index]!.thickness).toBeGreaterThan(
        configs[index - 1]!.thickness,
      )
      expect(configs[index]!.wake).toBeGreaterThan(configs[index - 1]!.wake)
      expect(configs[index]!.reach).toBeGreaterThan(configs[index - 1]!.reach)
      expect(configs[index]!.speed).toBeGreaterThan(configs[index - 1]!.speed)
      expect(configs[index]!.sparkle).toBeGreaterThan(
        configs[index - 1]!.sparkle,
      )
    }
  })

  test('renders an uninterrupted pink crest with a blue wake', () => {
    const rows = createEffortRippleRows({
      width: 70,
      segmentWidth: 14,
      cursor: 'max',
      elapsed: 980,
      reducedMotion: false,
      status: 'adjust',
    })
    const cells = rows.flatMap(expandRow)
    const colors = cells
      .map(cell => cell.color)
      .filter(color => color.startsWith('rgb('))
      .map(color => color.match(/\d+/g)?.map(Number))
      .filter((rgb): rgb is number[] => rgb !== undefined)

    expect(colors.some(([red, , blue]) => red! > blue!)).toBe(true)
    expect(colors.some(([red, , blue]) => blue! > red!)).toBe(true)
    expect(expandRow(rows[3]!).some(cell => cell.char === '-')).toBe(false)

    const particleGlyphs = new Set(
      cells
        .map(cell => cell.char)
        .filter(char => ['·', '˙', '∙', '∘', '◦', '•'].includes(char)),
    )
    expect(particleGlyphs.size).toBeGreaterThan(1)
  })
  test('propagates from high into the full selection surface', () => {
    const initial = createEffortRippleRows({
      width: 50,
      segmentWidth: 10,
      cursor: 'high',
      elapsed: 0,
      reducedMotion: false,
      status: 'adjust',
    })
    const expanded = createEffortRippleRows({
      width: 50,
      segmentWidth: 10,
      cursor: 'high',
      elapsed: 740,
      reducedMotion: false,
      status: 'adjust',
    })

    expect(expanded).toHaveLength(9)
    for (const row of expanded) {
      expect(
        row.reduce((length, segment) => length + segment.text.length, 0),
      ).toBe(50)
    }

    const initialTop = expandRow(initial[0]!)
    const expandedTop = expandRow(expanded[0]!)
    expect(initialTop[25]!.color).toBe('subtle')
    expect(expandedTop[25]!.color).toStartWith('rgb(')

    const labelRow = expandRow(expanded[6]!)
    expect(labelRow.map(cell => cell.char).join('')).toContain('high')
    expect(labelRow[25]!.color).toStartWith('rgb(')
  })
})
