import { describe, expect, test } from 'bun:test'
import type { PluginMarketplaceEntry } from '../../../utils/plugins/schemas.js'
import {
  getPluginCapabilities,
  rankPluginCandidates,
} from '../autoDiscovery.js'

function entry(
  name: string,
  description: string,
  extra: Partial<PluginMarketplaceEntry> = {},
): PluginMarketplaceEntry {
  return {
    name,
    description,
    source: { source: 'npm', package: name },
    strict: true,
    ...extra,
  } as PluginMarketplaceEntry
}

describe('rankPluginCandidates', () => {
  test('prefers a specific product match over generic description overlap', () => {
    const ranked = rankPluginCandidates('improve frontend visual design', [
      {
        marketplaceName: 'trusted',
        entry: entry(
          'generic-helper',
          'General development and design utilities',
        ),
      },
      {
        marketplaceName: 'trusted',
        entry: entry('frontend-design', 'Polished frontend interface design'),
      },
    ])

    expect(ranked[0]?.pluginName).toBe('frontend-design')
  })

  test('rejects unrelated candidates instead of guessing', () => {
    const ranked = rankPluginCandidates('deploy a service to Render', [
      {
        marketplaceName: 'trusted',
        entry: entry('database-migrations', 'Manage SQL schema changes'),
      },
    ])

    expect(ranked).toEqual([])
  })

  test('reports the persistent components a plugin contributes', () => {
    const plugin = entry('frontend-design', 'Design assistance', {
      skills: './skills',
      agents: './agents/reviewer.md',
      commands: './commands/audit.md',
    })

    expect(getPluginCapabilities(plugin)).toEqual([
      'skills',
      'agents',
      'commands',
    ])
  })
})
