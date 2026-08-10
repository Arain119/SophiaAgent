import { getModelUsage } from '../../bootstrap/state.js'
import type { Command, LocalCommandResult } from '../../types/command.js'
import {
  calculateCostBreakdown,
  getModelCosts,
  type BillableUsage,
} from '../../utils/modelCost.js'

type SessionModelUsage = ReturnType<typeof getModelUsage>[string]

const numberFormat = new Intl.NumberFormat('en-US')

function formatTokens(value: number): string {
  return numberFormat.format(value)
}

function formatCost(value: number): string {
  return `$${value.toFixed(6)}`
}

function toBillableUsage(usage: SessionModelUsage): BillableUsage {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
  }
}

function formatCategory(
  label: string,
  tokens: number,
  rate: number,
  cost: number,
): string {
  return `  ${label.padEnd(12)} ${formatTokens(tokens).padStart(12)} x $${rate}/M = ${formatCost(cost)}`
}

function formatUnreportedCategory(label: string): string {
  return `  ${label.padEnd(12)} N/A (not reported)`
}

export function formatUsageReport(
  modelUsage: Record<string, SessionModelUsage> = getModelUsage(),
): string {
  const entries = Object.entries(modelUsage).filter(([, usage]) =>
    [
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheCreationInputTokens,
      usage.cacheReadInputTokens,
    ].some(value => value > 0),
  )
  if (entries.length === 0) {
    return 'No model usage recorded in this session.'
  }

  let totalInput = 0
  let totalOutput = 0
  let totalCacheWrite = 0
  let totalCacheRead = 0
  let totalCost = 0
  let hasUnreportedCacheWrites = false
  const sections: string[] = []

  for (const [model, usage] of entries) {
    const normalized = toBillableUsage(usage)
    const rates = getModelCosts(model, normalized)
    const cost = calculateCostBreakdown(model, normalized)
    totalInput += usage.inputTokens
    totalOutput += usage.outputTokens
    totalCacheWrite += usage.cacheCreationInputTokens
    totalCacheRead += usage.cacheReadInputTokens
    totalCost += cost.total
    const cacheWriteReported = usage.cacheCreationInputTokens > 0
    hasUnreportedCacheWrites ||= !cacheWriteReported
    sections.push(
      [
        `${model}  ${formatCost(cost.total)}`,
        formatCategory(
          'Input',
          usage.inputTokens,
          rates.inputTokens,
          cost.input,
        ),
        formatCategory(
          'Output',
          usage.outputTokens,
          rates.outputTokens,
          cost.output,
        ),
        cacheWriteReported
          ? formatCategory(
              'Cache write',
              usage.cacheCreationInputTokens,
              rates.promptCacheWriteTokens,
              cost.cacheWrite,
            )
          : formatUnreportedCategory('Cache write'),
        formatCategory(
          'Cache read',
          usage.cacheReadInputTokens,
          rates.promptCacheReadTokens,
          cost.cacheRead,
        ),
      ].join('\n'),
    )
  }

  const cacheDenominator = totalInput + totalCacheWrite + totalCacheRead
  const cacheHitRate =
    cacheDenominator > 0
      ? `${((totalCacheRead / cacheDenominator) * 100).toFixed(1)}%`
      : 'N/A'

  return [
    'Session usage',
    `${hasUnreportedCacheWrites ? 'Estimated cost' : 'Total cost    '} ${formatCost(totalCost)}`,
    `Input          ${formatTokens(totalInput)}`,
    `Output         ${formatTokens(totalOutput)}`,
    `Cache write    ${
      hasUnreportedCacheWrites
        ? 'N/A (not reported)'
        : formatTokens(totalCacheWrite)
    }`,
    `Cache read     ${formatTokens(totalCacheRead)}`,
    `Cache hit      ${cacheHitRate}`,
    '',
    ...sections.flatMap((section, index) =>
      index === sections.length - 1 ? [section] : [section, ''],
    ),
  ].join('\n')
}

export async function callUsage(): Promise<LocalCommandResult> {
  return { type: 'text', value: formatUsageReport() }
}

const usage = {
  type: 'local',
  name: 'usage',
  description: 'Show session token usage and cost',
  supportsNonInteractive: true,
  load: async () => ({ call: callUsage }),
} satisfies Command

export default usage
