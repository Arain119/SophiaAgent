import type { ToolResult, ToolUseContext } from 'src/Tool.js'
import type {
  AutoPluginCandidate,
  AutoPluginDiscovery,
} from 'src/services/plugins/autoDiscovery.js'
import type { RefreshActivePluginsResult } from 'src/utils/plugins/refresh.js'

export type AutoPluginOutput = {
  success: boolean
  pluginId?: string
  pluginName?: string
  marketplaceName?: string
  installed: boolean
  activated: boolean
  capabilities?: string[]
  reason?: string
}

export type AutoPluginDependencies = {
  discover(task: string): Promise<AutoPluginDiscovery>
  install(
    candidate: AutoPluginCandidate,
  ): Promise<{ success: true } | { success: false; error: string }>
  refresh(context: ToolUseContext): Promise<RefreshActivePluginsResult>
}

export async function runAutoPlugin(
  task: string,
  context: ToolUseContext,
  dependencies: AutoPluginDependencies,
): Promise<ToolResult<AutoPluginOutput>> {
  const discovery = await dependencies.discover(task)
  const candidate = discovery.candidates[0]
  if (!candidate) {
    return {
      data: {
        success: false,
        installed: false,
        activated: false,
        reason:
          discovery.searchedMarketplaces.length === 0
            ? 'No plugin marketplaces are configured.'
            : 'No strong plugin match was found in the configured marketplaces.',
      },
    }
  }

  const installation = await dependencies.install(candidate)
  if (!installation.success) {
    return {
      data: {
        success: false,
        pluginId: candidate.pluginId,
        pluginName: candidate.pluginName,
        marketplaceName: candidate.marketplaceName,
        installed: false,
        activated: false,
        capabilities: candidate.capabilities,
        reason: installation.error,
      },
    }
  }

  try {
    const refreshed = await dependencies.refresh(context)
    return {
      data: {
        success: true,
        pluginId: candidate.pluginId,
        pluginName: candidate.pluginName,
        marketplaceName: candidate.marketplaceName,
        installed: true,
        activated: true,
        capabilities: candidate.capabilities,
      },
      contextModifier(original) {
        return {
          ...original,
          options: {
            ...original.options,
            commands: refreshed.pluginCommands,
            agentDefinitions: refreshed.agentDefinitions,
          },
        }
      },
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      data: {
        success: true,
        pluginId: candidate.pluginId,
        pluginName: candidate.pluginName,
        marketplaceName: candidate.marketplaceName,
        installed: true,
        activated: false,
        capabilities: candidate.capabilities,
        reason: `Installed, but current-session activation failed: ${reason}`,
      },
    }
  }
}
