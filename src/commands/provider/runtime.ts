import {
  type ProviderConfigurationDependencies,
  type ProviderEnvironmentPatch,
} from './configuration.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import {
  getProviderApiKey,
  updateProviderApiKeys,
} from '../../utils/providerCredentials.js'

function applyProcessEnvironment(patch: ProviderEnvironmentPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

export const providerConfigurationDependencies: ProviderConfigurationDependencies =
  {
    getSettings: () => getSettingsForSource('userSettings'),
    updateSettings: patch =>
      updateSettingsForSource('userSettings', patch as unknown as SettingsJson)
        .error,
    applyEnvironment: applyProcessEnvironment,
    getApiKey: getProviderApiKey,
    updateApiKeys: updateProviderApiKeys,
  }
