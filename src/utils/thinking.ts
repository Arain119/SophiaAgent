import { feature } from 'bun:bundle'
import type { Theme } from './theme.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

export function isUltrathinkEnabled(): boolean {
  return feature('ULTRATHINK')
    ? getFeatureValue_CACHED_MAY_BE_STALE('tengu_turtle_carbon', true)
    : false
}

export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}

export function findThinkingTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  return [...text.matchAll(/\bultrathink\b/gi)].flatMap(match =>
    match.index === undefined
      ? []
      : [
          {
            word: match[0],
            start: match.index,
            end: match.index + match[0].length,
          },
        ],
  )
}

const RAINBOW_COLORS: Array<keyof Theme> = [
  'rainbow_red',
  'rainbow_orange',
  'rainbow_yellow',
  'rainbow_green',
  'rainbow_blue',
  'rainbow_indigo',
  'rainbow_violet',
]

const RAINBOW_SHIMMER_COLORS: Array<keyof Theme> = [
  'rainbow_red_shimmer',
  'rainbow_orange_shimmer',
  'rainbow_yellow_shimmer',
  'rainbow_green_shimmer',
  'rainbow_blue_shimmer',
  'rainbow_indigo_shimmer',
  'rainbow_violet_shimmer',
]

export function getRainbowColor(
  charIndex: number,
  shimmer = false,
): keyof Theme {
  const colors = shimmer ? RAINBOW_SHIMMER_COLORS : RAINBOW_COLORS
  return colors[charIndex % colors.length]!
}

export function modelSupportsThinking(model: string): boolean {
  return model.trim().length > 0
}

export function modelSupportsAdaptiveThinking(model: string): boolean {
  return model.trim().length > 0
}

export function shouldEnableThinkingByDefault(): boolean {
  if (process.env.MAX_THINKING_TOKENS) {
    return Number(process.env.MAX_THINKING_TOKENS) > 0
  }
  return true
}
