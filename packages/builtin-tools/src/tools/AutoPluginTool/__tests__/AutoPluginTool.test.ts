import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from 'src/Tool.js'
import type { AppState } from 'src/state/AppState.js'
import type { AutoPluginCandidate } from 'src/services/plugins/autoDiscovery.js'
import type { RefreshActivePluginsResult } from 'src/utils/plugins/refresh.js'
import { runAutoPlugin, type AutoPluginDependencies } from '../runner.js'

const candidate = {
  pluginId: 'frontend-design@trusted',
  pluginName: 'frontend-design',
  marketplaceName: 'trusted',
  description: 'Improve frontend visual design',
  score: 80,
  capabilities: ['skills'],
  entry: {
    name: 'frontend-design',
    description: 'Improve frontend visual design',
    source: { source: 'npm', package: 'frontend-design' },
    strict: true,
  },
} as AutoPluginCandidate

function context(): ToolUseContext {
  const state = {} as AppState
  return {
    options: { commands: [], agentDefinitions: {} },
    getAppState: () => state,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

function refreshResult(): RefreshActivePluginsResult {
  return {
    enabled_count: 1,
    disabled_count: 0,
    command_count: 0,
    agent_count: 0,
    hook_count: 0,
    mcp_count: 0,
    lsp_count: 0,
    error_count: 0,
    agentDefinitions: { allAgents: [], activeAgents: [] },
    pluginCommands: [],
  } as unknown as RefreshActivePluginsResult
}

function dependencies(
  overrides: Partial<AutoPluginDependencies> = {},
): AutoPluginDependencies {
  return {
    discover: async () => ({
      candidates: [candidate],
      searchedMarketplaces: ['trusted'],
    }),
    install: async () => ({ success: true }),
    refresh: async () => refreshResult(),
    ...overrides,
  }
}

describe('runAutoPlugin', () => {
  test('installs only the best candidate and activates it in the current context', async () => {
    let installs = 0
    const result = await runAutoPlugin(
      'frontend design',
      context(),
      dependencies({
        discover: async () => ({
          candidates: [candidate, { ...candidate, pluginId: 'second@trusted' }],
          searchedMarketplaces: ['trusted'],
        }),
        install: async selected => {
          installs += 1
          expect(selected.pluginId).toBe(candidate.pluginId)
          return { success: true }
        },
      }),
    )

    expect(installs).toBe(1)
    expect(result.data).toMatchObject({
      success: true,
      installed: true,
      activated: true,
      pluginId: candidate.pluginId,
    })
    expect(result.contextModifier).toBeDefined()
  })

  test('reports an installed plugin that needs restart when refresh fails', async () => {
    const result = await runAutoPlugin(
      'frontend design',
      context(),
      dependencies({
        refresh: async () => {
          throw new Error('refresh failed')
        },
      }),
    )

    expect(result.data).toMatchObject({
      success: true,
      installed: true,
      activated: false,
    })
    expect(result.data.reason).toContain('refresh failed')
  })

  test('does not install when no strong match exists', async () => {
    let installed = false
    const result = await runAutoPlugin(
      'unknown capability',
      context(),
      dependencies({
        discover: async () => ({
          candidates: [],
          searchedMarketplaces: ['trusted'],
        }),
        install: async () => {
          installed = true
          return { success: true }
        },
      }),
    )

    expect(installed).toBe(false)
    expect(result.data.success).toBe(false)
    expect(result.data.reason).toContain('No strong plugin match')
  })
})
