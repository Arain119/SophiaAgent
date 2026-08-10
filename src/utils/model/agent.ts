import {
  getAgentModelRoute,
  getModelForTier,
  type ProviderProfileSettings,
} from '../providerProfiles.js'
import { getInitialSettings } from '../settings/settings.js'

export function getDefaultSubagentModel(
  settings: ProviderProfileSettings = getInitialSettings(),
): string {
  return (
    getAgentModelRoute(settings, 'subagent')?.model ?? getModelForTier('fast')
  )
}

export function getAgentModel(settings?: ProviderProfileSettings): string {
  return getDefaultSubagentModel(settings)
}
