// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getInitialSettings } from './settings/settings.js'
import type { EffortLevel } from 'src/entrypoints/sdk/runtimeTypes.js'

export type { EffortLevel }

// NOTE: 'ultracode' is NOT an effort level. It is a session-scoped multi-agent
// orchestration opt-in injected by the harness (claude.ai/client) as a
// system-reminder, orthogonal to the effort parameter. EffortLevel / EffortValue
// must never include 'ultracode'; /effort only accepts the levels below.
export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly EffortLevel[]

export const DEFAULT_EFFORT_LEVEL: EffortLevel = 'medium'

export type EffortValue = EffortLevel | number

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports the effort parameter.
export function modelSupportsEffort(model: string): boolean {
  return model.trim().length > 0
}

// Effort max/xhigh restrictions removed — all models that support effort
// can now use these levels. API errors are the user's responsibility.
export function modelSupportsMaxEffort(_model: string): boolean {
  return true
}

export function modelSupportsXhighEffort(_model: string): boolean {
  return true
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && isValidNumericEffort(value)) {
    return value
  }
  const str = String(value).toLowerCase()
  if (isEffortLevel(str)) {
    return str
  }
  const numericValue = parseInt(str, 10)
  if (!isNaN(numericValue) && isValidNumericEffort(numericValue)) {
    return numericValue
  }
  return undefined
}

/**
 * Numeric values are model-default only and not persisted.
 * All five named levels are valid persistent user choices.
 * Write sites call this before saving to settings so the Zod schema
 * (which only accepts string levels) never rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  ) {
    return value
  }
  return undefined
}

export function getInitialEffortSetting(): EffortLevel {
  return (
    toPersistableEffort(getInitialSettings().effortLevel) ??
    DEFAULT_EFFORT_LEVEL
  )
}

/**
 * Decide what effort level (if any) to persist when the user selects a model
 * in an inference picker. Keeps an explicit prior /effort choice sticky even when it
 * matches the picked model's default, while letting purely-default and
 * session-ephemeral effort (CLI --effort, EffortCallout default) fall through
 * to undefined so it follows future model-default changes.
 *
 * priorPersisted must come from userSettings on disk
 * (getSettingsForSource('userSettings')?.effortLevel), NOT merged settings
 * (project/policy layers would leak into the user's global settings.json)
 * and NOT AppState.effortValue (includes session-scoped sources that
 * deliberately do not write to settings.json).
 */
export function resolvePickerEffortPersistence(
  picked: EffortLevel | undefined,
  modelDefault: EffortLevel,
  priorPersisted: EffortLevel | undefined,
  toggledInPicker: boolean,
): EffortLevel | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== modelDefault ? picked : undefined
}

export function getEffortEnvOverride(): EffortLevel | undefined {
  const envOverride = process.env.SOPHIA_EFFORT_LEVEL?.toLowerCase()
  return envOverride && isEffortLevel(envOverride) ? envOverride : undefined
}

/**
 * Resolve the effort value that will actually be sent to the API for a given
 * model, following the full precedence chain:
 *   env SOPHIA_EFFORT_LEVEL → appState.effortValue → model default
 *
 * The public runtime always resolves to one of the five named effort levels.
 */
export function resolveAppliedEffort(
  model: string,
  appStateEffortValue: EffortValue | undefined,
): EffortValue {
  const envOverride = getEffortEnvOverride()
  return (
    envOverride ??
    appStateEffortValue ??
    getDefaultEffortForModel(model) ??
    DEFAULT_EFFORT_LEVEL
  )
}

/**
 * Resolve the effort level to show the user. Wraps resolveAppliedEffort
 * and guarantees one of the five public levels is shown.
 * Single source of truth for the status bar and /effort output (CC-1088).
 */
export function getDisplayedEffortLevel(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel {
  const resolved = resolveAppliedEffort(model, appStateEffort)
  return convertEffortValueToLevel(resolved)
}

/**
 * Build the ` with {level} effort` suffix shown in Logo/Spinner.
 * Returns empty string if the user hasn't explicitly set an effort value.
 * Delegates to resolveAppliedEffort() so the displayed level matches what
 * the API actually receives (including max→high clamp for non-Opus models).
 */
export function getEffortSuffix(
  model: string,
  effortValue: EffortValue | undefined,
): string {
  if (effortValue === undefined) return ''
  const resolved = resolveAppliedEffort(model, effortValue)
  if (resolved === undefined) return ''
  return ` with ${convertEffortValueToLevel(resolved)} effort`
}

export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}

export function convertEffortValueToLevel(value: EffortValue): EffortLevel {
  if (typeof value === 'string') {
    // Runtime guard: value may come from remote config (GrowthBook) where
    // TypeScript types can't help us. Coerce unknown strings to 'high'
    // rather than passing them through unchecked.
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 100) return 'high'
    return 'max'
  }
  return 'high'
}

/**
 * Get user-facing description for effort levels
 *
 * @param level The effort level to describe
 * @returns Human-readable description
 */
export function getEffortLevelDescription(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return 'Quick, straightforward implementation with minimal overhead'
    case 'medium':
      return 'Balanced approach with standard implementation and testing'
    case 'high':
      return 'Comprehensive implementation with extensive testing and documentation'
    case 'xhigh':
      return 'Extended reasoning beyond high, short of max'
    case 'max':
      return 'Maximum capability with deepest reasoning'
  }
}

/**
 * Get user-facing description for effort values (both string and numeric)
 *
 * @param value The effort value to describe
 * @returns Human-readable description
 */
export function getEffortValueDescription(value: EffortValue): string {
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    return `[ANT-ONLY] Numeric effort value of ${value}`
  }

  if (typeof value === 'string') {
    return getEffortLevelDescription(value)
  }
  return 'Balanced approach with standard implementation and testing'
}

export function getDefaultEffortForModel(
  model: string,
): EffortValue | undefined {
  if (modelSupportsEffort(model)) {
    return 'medium'
  }
  return undefined
}
