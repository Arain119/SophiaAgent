export const PRESSURE_TRIGGER_TOKENS = 80_000
export const PRESSURE_TARGET_TOKENS = 64_000
export const MIN_TOOL_RESULT_TOKENS = 24_000
export const PRESSURE_KEEP_RECENT_RESULTS = 6

export type ToolResultUsage = {
  id: string
  tokens: number
}

export function planPressureToolResultClearing(
  estimatedMessageTokens: number,
  toolResults: ToolResultUsage[],
): string[] {
  const totalToolResultTokens = toolResults.reduce(
    (total, result) => total + result.tokens,
    0,
  )
  if (
    estimatedMessageTokens < PRESSURE_TRIGGER_TOKENS ||
    totalToolResultTokens < MIN_TOOL_RESULT_TOKENS ||
    toolResults.length <= PRESSURE_KEEP_RECENT_RESULTS
  ) {
    return []
  }

  const eligible = toolResults.slice(0, -PRESSURE_KEEP_RECENT_RESULTS)
  const tokensToClear = estimatedMessageTokens - PRESSURE_TARGET_TOKENS
  const ids: string[] = []
  let clearedTokens = 0
  for (const result of eligible) {
    ids.push(result.id)
    clearedTokens += result.tokens
    if (clearedTokens >= tokensToClear) break
  }
  return ids
}
