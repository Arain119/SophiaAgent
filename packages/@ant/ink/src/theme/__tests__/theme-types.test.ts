import { describe, expect, test } from 'bun:test'
import { THEME_NAMES, getTheme } from '../theme-types.js'

describe('Sophia theme palette', () => {
  test('uses the canonical pink and light-blue palette in true-color themes', () => {
    const dark = getTheme('dark')
    expect(dark.sophiaPink).toBe('rgb(255,182,193)')
    expect(dark.sophiaPinkDeep).toBe('rgb(255,146,188)')
    expect(dark.sophiaPinkShimmer).toBe('rgb(255,218,226)')
    expect(dark.sophiaBlue).toBe('rgb(135,206,250)')
    expect(dark.sophiaBlueShimmer).toBe('rgb(191,228,255)')

    const light = getTheme('light')
    expect(light.sophiaPink).toBe('rgb(196,78,122)')
    expect(light.sophiaPinkDeep).toBe('rgb(196,78,122)')
    expect(light.sophiaBlue).toBe('rgb(73,154,205)')
  })

  test('all themes expose Sophia colors without legacy brand aliases', () => {
    for (const themeName of THEME_NAMES) {
      const theme = getTheme(themeName)
      expect(theme.sophiaPink).toBeTruthy()
      expect(theme.sophiaPinkDeep).toBeTruthy()
      expect(theme.sophiaPinkShimmer).toBeTruthy()
      expect(theme.sophiaBlue).toBeTruthy()
      expect(theme.sophiaBlueShimmer).toBeTruthy()
      expect('claude' in theme).toBe(false)
      expect('autoAccept' in theme).toBe(false)
      expect('professionalBlue' in theme).toBe(false)
    }
  })

  test('keeps semantic status colors distinct from the brand palette', () => {
    const theme = getTheme('dark')
    expect(theme.error).not.toBe(theme.sophiaPink)
    expect(theme.warning).not.toBe(theme.sophiaPink)
    expect(theme.success).not.toBe(theme.sophiaBlue)
  })
})
