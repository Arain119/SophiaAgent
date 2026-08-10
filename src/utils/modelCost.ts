import { PROVIDER_MODELS } from './providerProfiles.js'

export type BillableUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  server_tool_use?: { web_search_requests?: number | null } | null
}

export type ModelCosts = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  promptCacheReadTokens: number
  webSearchRequests: number
}

const UNPRICED_MODEL_COST: ModelCosts = {
  inputTokens: 0,
  outputTokens: 0,
  promptCacheWriteTokens: 0,
  promptCacheReadTokens: 0,
  webSearchRequests: 0,
} as const satisfies ModelCosts

// USD per one million tokens. These are Sophia's fixed provider rates.
export const MODEL_COSTS: Readonly<Record<string, ModelCosts>> = {
  [PROVIDER_MODELS.deep]: {
    inputTokens: 5,
    outputTokens: 30,
    promptCacheWriteTokens: 6.25,
    promptCacheReadTokens: 0.5,
    webSearchRequests: 0,
  },
  [PROVIDER_MODELS.fast]: {
    inputTokens: 0.2,
    outputTokens: 1.2,
    promptCacheWriteTokens: 0.25,
    promptCacheReadTokens: 0.02,
    webSearchRequests: 0,
  },
}

export type ModelCostBreakdown = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  webSearch: number
  total: number
}

export function getModelCosts(
  model: string,
  _usage: BillableUsage,
): ModelCosts {
  return MODEL_COSTS[model] ?? UNPRICED_MODEL_COST
}

export function calculateCostBreakdown(
  model: string,
  usage: BillableUsage,
): ModelCostBreakdown {
  const rates = getModelCosts(model, usage)
  const input = ((usage.input_tokens ?? 0) * rates.inputTokens) / 1_000_000
  const output = ((usage.output_tokens ?? 0) * rates.outputTokens) / 1_000_000
  const cacheWrite =
    ((usage.cache_creation_input_tokens ?? 0) * rates.promptCacheWriteTokens) /
    1_000_000
  const cacheRead =
    ((usage.cache_read_input_tokens ?? 0) * rates.promptCacheReadTokens) /
    1_000_000
  const webSearch =
    (usage.server_tool_use?.web_search_requests ?? 0) * rates.webSearchRequests
  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    webSearch,
    total: input + output + cacheWrite + cacheRead + webSearch,
  }
}

export function calculateUSDCost(model: string, usage: BillableUsage): number {
  return calculateCostBreakdown(model, usage).total
}
