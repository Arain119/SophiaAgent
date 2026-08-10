import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { getInitialSettings } from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import {
  type AgentModelRole,
  getAgentModelRoute,
  getProviderProfileForRole,
} from '../providerProfiles.js'

/** The only supported wire format for configured providers. */
export type APIProvider = 'openai-responses'

export function getConfiguredProviderName(
  role: AgentModelRole = 'main',
  settings: Pick<
    SettingsJson,
    'providers' | 'agentModels'
  > = getInitialSettings(),
): string | undefined {
  return getAgentModelRoute(settings, role)?.provider
}

export function getConfiguredProviderNameForModel(
  model: string,
  settings: Pick<
    SettingsJson,
    'providers' | 'agentModels'
  > = getInitialSettings(),
): string | undefined {
  const main = getAgentModelRoute(settings, 'main')
  const subagent = getAgentModelRoute(settings, 'subagent')
  if (subagent?.model === model && main?.model !== model) {
    return subagent.provider
  }
  return main?.provider
}

export function getConfiguredAPIProvider(
  settings: Pick<
    SettingsJson,
    'providers' | 'agentModels'
  > = getInitialSettings(),
): APIProvider | undefined {
  return getProviderProfileForRole(settings, 'main')?.protocol
}

export function getAPIProvider(
  settings: Pick<
    SettingsJson,
    'providers' | 'agentModels'
  > = getInitialSettings(),
): APIProvider {
  // Startup UI may render before /model creates an active profile.
  // API requests remain blocked by getMainLoopModel() until then.
  return getConfiguredAPIProvider(settings) ?? 'openai-responses'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}
