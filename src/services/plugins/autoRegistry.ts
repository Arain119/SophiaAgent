import { isPluginInstalled } from '../../utils/plugins/installedPluginsManager.js'
import {
  getMarketplaceCacheOnly,
  loadKnownMarketplacesConfig,
} from '../../utils/plugins/marketplaceManager.js'
import { isPluginBlockedByPolicy } from '../../utils/plugins/pluginPolicy.js'
import {
  rankPluginCandidates,
  type AutoPluginDiscovery,
  type PluginCatalogEntry,
} from './autoDiscovery.js'

/** Search only marketplaces already configured and materialized by the user. */
export async function findAutoPluginCandidates(
  task: string,
): Promise<AutoPluginDiscovery> {
  const config = await loadKnownMarketplacesConfig()
  const searchedMarketplaces = Object.keys(config).sort()
  const catalog: PluginCatalogEntry[] = []

  for (const marketplaceName of searchedMarketplaces) {
    const marketplace = await getMarketplaceCacheOnly(marketplaceName)
    if (!marketplace) continue
    for (const entry of marketplace.plugins) {
      const pluginId = `${entry.name}@${marketplaceName}`
      if (isPluginInstalled(pluginId)) continue
      if (isPluginBlockedByPolicy(pluginId)) continue
      catalog.push({ marketplaceName, entry })
    }
  }

  return {
    candidates: rankPluginCandidates(task, catalog),
    searchedMarketplaces,
  }
}
