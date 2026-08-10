import z from 'zod/v4'
import { PAUSE_ICON } from '../../constants/figures.js'
import { EXECUTION_MODES, type ExecutionMode } from '../../types/safety.js'
import { lazySchema } from '../lazySchema.js'

export { EXECUTION_MODES, type ExecutionMode }

export const executionModeSchema = lazySchema(() => z.enum(EXECUTION_MODES))

type ModeColorKey = 'planMode' | 'warning'

const MODE_CONFIG: Record<
  ExecutionMode,
  { title: string; shortTitle: string; symbol: string; color: ModeColorKey }
> = {
  auto: {
    title: 'Auto',
    shortTitle: 'Auto',
    symbol: '>>',
    color: 'warning',
  },
  plan: {
    title: 'Plan Mode',
    shortTitle: 'Plan',
    symbol: PAUSE_ICON,
    color: 'planMode',
  },
}

export function executionModeTitle(mode: ExecutionMode): string {
  return MODE_CONFIG[mode].title
}

export function executionModeShortTitle(mode: ExecutionMode): string {
  return MODE_CONFIG[mode].shortTitle
}

export function executionModeSymbol(mode: ExecutionMode): string {
  return MODE_CONFIG[mode].symbol
}

export function getModeColor(mode: ExecutionMode): ModeColorKey {
  return MODE_CONFIG[mode].color
}
