import type { EffortLevel, EffortValue } from '../../utils/effort.js'

export type PanelPosition = EffortLevel

export const PANEL_POSITIONS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly PanelPosition[]

export const HOME_POSITION: PanelPosition = 'low'
export const END_POSITION: PanelPosition = 'max'

function normalizeToPanelPosition(
  value: EffortValue | undefined,
): PanelPosition | undefined {
  if (typeof value !== 'string') return undefined
  return (PANEL_POSITIONS as readonly string[]).includes(value)
    ? (value as PanelPosition)
    : undefined
}

export function moveLeft(cursor: PanelPosition): PanelPosition {
  const index = PANEL_POSITIONS.indexOf(cursor)
  return index <= 0 ? HOME_POSITION : PANEL_POSITIONS[index - 1]
}

export function moveRight(cursor: PanelPosition): PanelPosition {
  const index = PANEL_POSITIONS.indexOf(cursor)
  return index < 0 || index >= PANEL_POSITIONS.length - 1
    ? END_POSITION
    : PANEL_POSITIONS[index + 1]
}

export function getInitialCursor(args: {
  envOverride: EffortValue | undefined
  appStateEffort: EffortValue | undefined
  displayed: EffortLevel
}): PanelPosition {
  return normalizeToPanelPosition(args.envOverride) ?? args.displayed
}

export type ConfirmOutcome = {
  kind: 'apply'
  message: string
  effortUpdate?: { value: EffortValue | undefined }
}

export type ApplyFn = (cursor: PanelPosition) => {
  message: string
  effortUpdate?: { value: EffortValue | undefined }
}

export const CANCEL_MESSAGE = 'Effort unchanged.'

export function computeConfirmOutcome(
  cursor: PanelPosition,
  applyFn: ApplyFn,
): ConfirmOutcome {
  const result = applyFn(cursor)
  return {
    kind: 'apply',
    message: result.message,
    effortUpdate: result.effortUpdate,
  }
}
