import type { PluginMarketplaceEntry } from '../../utils/plugins/schemas.js'

const MAX_CANDIDATES = 5
const MIN_MATCH_SCORE = 10

const STOP_WORDS = new Set([
  'agent',
  'code',
  'current',
  'for',
  'from',
  'help',
  'into',
  'need',
  'plugin',
  'project',
  'sophia',
  'that',
  'the',
  'this',
  'tool',
  'use',
  'with',
])

export type AutoPluginCandidate = {
  pluginId: string
  pluginName: string
  marketplaceName: string
  description?: string
  score: number
  capabilities: string[]
  entry: PluginMarketplaceEntry
}

export type AutoPluginDiscovery = {
  candidates: AutoPluginCandidate[]
  searchedMarketplaces: string[]
}

export type PluginCatalogEntry = {
  marketplaceName: string
  entry: PluginMarketplaceEntry
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/front[- ]end/g, 'frontend')
    .replace(/back[- ]end/g, 'backend')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(' ')
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token)),
  )
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === null || value === undefined) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.flatMap(item => collectStrings(item, depth + 1))
  }
  if (typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => [key, ...collectStrings(child, depth + 1)],
  )
}

export function getPluginCapabilities(entry: PluginMarketplaceEntry): string[] {
  const capabilities: string[] = []
  if (entry.skills) capabilities.push('skills')
  if (entry.agents) capabilities.push('agents')
  if (entry.commands) capabilities.push('commands')
  if (entry.hooks) capabilities.push('hooks')
  if (entry.mcpServers) capabilities.push('mcp')
  if (entry.lspServers) capabilities.push('lsp')
  if (entry.outputStyles) capabilities.push('output-styles')
  return capabilities
}

function scoreCandidate(task: string, candidate: PluginCatalogEntry): number {
  const taskNormalized = normalize(task)
  const taskTokens = tokens(task)
  if (taskTokens.size === 0) return 0

  const { entry } = candidate
  const nameNormalized = normalize(entry.name)
  const nameTokens = tokens(entry.name)
  const tagTokens = tokens(
    [entry.category, ...(entry.tags ?? []), ...(entry.keywords ?? [])]
      .filter((value): value is string => typeof value === 'string')
      .join(' '),
  )
  const descriptionTokens = tokens(entry.description ?? '')
  const componentTokens = tokens(
    collectStrings({
      commands: entry.commands,
      agents: entry.agents,
      skills: entry.skills,
      mcpServers: entry.mcpServers,
      lspServers: entry.lspServers,
      outputStyles: entry.outputStyles,
    }).join(' '),
  )

  let score = 0
  if (nameNormalized && taskNormalized.includes(nameNormalized)) score += 50
  for (const token of taskTokens) {
    if (nameTokens.has(token)) score += 14
    if (tagTokens.has(token)) score += 10
    if (descriptionTokens.has(token)) score += 5
    if (componentTokens.has(token)) score += 4
  }
  return score
}

export function rankPluginCandidates(
  task: string,
  catalog: readonly PluginCatalogEntry[],
): AutoPluginCandidate[] {
  return catalog
    .map(({ marketplaceName, entry }) => {
      const pluginId = `${entry.name}@${marketplaceName}`
      return {
        pluginId,
        pluginName: entry.name,
        marketplaceName,
        ...(entry.description ? { description: entry.description } : {}),
        score: scoreCandidate(task, { marketplaceName, entry }),
        capabilities: getPluginCapabilities(entry),
        entry,
      }
    })
    .filter(candidate => candidate.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score || a.pluginId.localeCompare(b.pluginId))
    .slice(0, MAX_CANDIDATES)
}
