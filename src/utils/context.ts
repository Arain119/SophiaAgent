// Shared context and output limits for Sophia's fixed Responses models.
export const MODEL_CONTEXT_WINDOW_DEFAULT = 272_000
/** Fixed Sophia Responses models compact before the final 22k headroom. */
export const MODEL_AUTO_COMPACT_THRESHOLD = 250_000
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

const DEFAULT_MAX_OUTPUT_TOKENS = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 128_000

export function is1mContextDisabled(): boolean {
  return true
}

export function has1mContext(_model: string): boolean {
  return false
}

export function modelSupports1M(_model: string): boolean {
  return false
}

export function getContextWindowForModel(
  _model: string,
  _betas?: string[],
): number {
  const configured = Number(process.env.OPENAI_CONTEXT_WINDOW)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : MODEL_CONTEXT_WINDOW_DEFAULT
}

export function getSonnet1mExpTreatmentEnabled(_model: string): boolean {
  return false
}

export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) return { used: null, remaining: null }
  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens
  if (totalInputTokens === 0) return { used: null, remaining: null }
  const used = Math.min(
    100,
    Math.max(0, Math.round((totalInputTokens / contextWindowSize) * 100)),
  )
  return { used, remaining: 100 - used }
}

export function getModelMaxOutputTokens(_model: string): {
  default: number
  upperLimit: number
} {
  return {
    default: DEFAULT_MAX_OUTPUT_TOKENS,
    upperLimit: MAX_OUTPUT_TOKENS_UPPER_LIMIT,
  }
}

export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
