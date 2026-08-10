import type { SettingsJson } from '../../utils/settings/types.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { providerProfileToEnvironment } from '../../utils/providerProfiles.js'
import { getProviderApiKey } from '../../utils/providerCredentials.js'
import type {
  ModelConfigurationDependencies,
  ModelValues,
} from './configuration.js'

function applyMainEnvironment(route: ModelValues): void {
  const profile =
    getSettingsForSource('userSettings')?.providers?.[route.provider]
  if (!profile) return
  const environment = providerProfileToEnvironment(
    profile,
    getProviderApiKey(route.provider),
    route.model,
  )
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

export const modelConfigurationDependencies: ModelConfigurationDependencies = {
  getSettings: () => getSettingsForSource('userSettings'),
  updateSettings: patch =>
    updateSettingsForSource('userSettings', patch as unknown as SettingsJson)
      .error,
  applyMainEnvironment,
}
