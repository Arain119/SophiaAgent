import {
  type AgentModelRoutes,
  getAgentModelRoute,
  getProviderProfileForRole,
  PROVIDER_MODELS,
  providerProfileToEnvironment,
  type ProviderProfile,
  type ProviderProfiles,
} from '../../utils/providerProfiles.js'
import type { ProviderCredentialPatch } from '../../utils/providerCredentials.js'

export type ProviderField = 'name' | 'baseUrl' | 'apiKey'

export type ProviderValues = Record<ProviderField, string>

export type ProviderEnvironmentPatch = Record<
  'OPENAI_BASE_URL' | 'OPENAI_API_KEY' | 'OPENAI_MODEL',
  string | undefined
>

export type PreparedProviderConfiguration = {
  name: string
  profile: ProviderProfile
  apiKey: string
  env: ProviderEnvironmentPatch
}

export type ProviderSettingsPatch = {
  providers: Record<string, ProviderProfile | undefined> | undefined
  agentModels: AgentModelRoutes | undefined
  model: undefined
  env: ProviderEnvironmentPatch
}

export type SavedProviderSettings = {
  providers?: ProviderProfiles
  agentModels?: AgentModelRoutes
  env?: Partial<ProviderEnvironmentPatch> & Record<string, unknown>
}

export type ProviderConfigurationDependencies = {
  getSettings(): SavedProviderSettings | null
  updateSettings(patch: ProviderSettingsPatch): Error | null
  applyEnvironment(patch: ProviderEnvironmentPatch): void
  getApiKey(name: string): string | undefined
  updateApiKeys(patch: ProviderCredentialPatch): Error | null
}

export function emptyProviderEnvironmentPatch(): ProviderEnvironmentPatch {
  return {
    OPENAI_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
  }
}

export function hasSavedProviderConfiguration(
  settings: SavedProviderSettings | null,
): boolean {
  return Boolean(settings?.providers && Object.keys(settings.providers).length)
}

export function prepareProviderConfiguration(
  values: ProviderValues,
  existingApiKey = '',
): PreparedProviderConfiguration | Error {
  const name = values.name.trim()
  const baseUrl = values.baseUrl.trim().replace(/\/+$/, '')
  const apiKey = values.apiKey.trim() || existingApiKey.trim()

  if (!name) return new Error('Provider name is required')
  if (name.length > 64) {
    return new Error('Provider name must be 64 characters or fewer')
  }
  if (!baseUrl) return new Error('Base URL is required')

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return new Error('Base URL must be an absolute HTTP or HTTPS URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new Error('Base URL must be an absolute HTTP or HTTPS URL')
  }

  const requiresApiKey = url.hostname === 'api.openai.com'
  if (requiresApiKey && !apiKey) return new Error('API Key is required')

  const profile: ProviderProfile = {
    protocol: 'openai-responses',
    baseUrl,
  }
  return {
    name,
    profile,
    apiKey,
    env: {
      ...emptyProviderEnvironmentPatch(),
      ...providerProfileToEnvironment(profile, apiKey),
    },
  }
}

function createSettingsPatch(
  providers: ProviderProfiles,
  agentModels: AgentModelRoutes | undefined,
  removedProviderNames: string[] = [],
): ProviderSettingsPatch {
  const persistedProviders =
    Object.keys(providers).length > 0
      ? {
          ...providers,
          ...Object.fromEntries(
            removedProviderNames.map(name => [name, undefined]),
          ),
        }
      : undefined
  return {
    providers: persistedProviders,
    agentModels,
    model: undefined,
    env: emptyProviderEnvironmentPatch(),
  }
}

function applyPatch(
  patch: ProviderSettingsPatch,
  dependencies: ProviderConfigurationDependencies,
  credentialPatch: ProviderCredentialPatch = {},
): Error | null {
  const previousCredentials = Object.fromEntries(
    Object.keys(credentialPatch).map(name => [
      name,
      dependencies.getApiKey(name),
    ]),
  )
  const credentialError = dependencies.updateApiKeys(credentialPatch)
  if (credentialError) return credentialError

  const error = dependencies.updateSettings(patch)
  if (error) {
    const rollbackError = dependencies.updateApiKeys(previousCredentials)
    return rollbackError
      ? new Error(error.message + '; provider credential rollback also failed')
      : error
  }
  const routableSettings = {
    providers: Object.fromEntries(
      Object.entries(patch.providers ?? {}).filter(
        (entry): entry is [string, ProviderProfile] => entry[1] !== undefined,
      ),
    ),
    agentModels: patch.agentModels,
  }
  const mainProfile = getProviderProfileForRole(routableSettings, 'main')
  const mainRoute = getAgentModelRoute(routableSettings, 'main')
  dependencies.applyEnvironment(
    mainProfile && mainRoute
      ? {
          ...emptyProviderEnvironmentPatch(),
          ...providerProfileToEnvironment(
            mainProfile,
            dependencies.getApiKey(mainRoute.provider),
            mainRoute.model,
          ),
        }
      : emptyProviderEnvironmentPatch(),
  )
  return null
}

export function saveProviderConfiguration(
  values: ProviderValues,
  dependencies: ProviderConfigurationDependencies,
  previousName?: string,
): Error | null {
  const previousApiKey = previousName
    ? dependencies.getApiKey(previousName)
    : undefined
  const prepared = prepareProviderConfiguration(values, previousApiKey)
  if (prepared instanceof Error) return prepared

  const providers = {
    ...(dependencies.getSettings()?.providers ?? {}),
  }
  if (
    previousName &&
    previousName !== prepared.name &&
    providers[prepared.name]
  ) {
    return new Error("Provider '" + prepared.name + "' already exists")
  }
  if (previousName && previousName !== prepared.name) {
    delete providers[previousName]
  }
  providers[prepared.name] = prepared.profile

  const currentRoutes = dependencies.getSettings()?.agentModels
  let agentModels: AgentModelRoutes = currentRoutes ?? {
    main: { model: PROVIDER_MODELS.deep, provider: prepared.name },
    subagent: { model: PROVIDER_MODELS.fast, provider: prepared.name },
  }
  if (previousName && previousName !== prepared.name) {
    agentModels = {
      main: {
        ...agentModels.main,
        provider:
          agentModels.main.provider === previousName
            ? prepared.name
            : agentModels.main.provider,
      },
      subagent: {
        ...agentModels.subagent,
        provider:
          agentModels.subagent.provider === previousName
            ? prepared.name
            : agentModels.subagent.provider,
      },
    }
  }

  const credentialPatch: ProviderCredentialPatch = {
    ...(previousName && previousName !== prepared.name
      ? { [previousName]: undefined }
      : {}),
    [prepared.name]: prepared.apiKey || undefined,
  }
  return applyPatch(
    createSettingsPatch(
      providers,
      agentModels,
      previousName && previousName !== prepared.name ? [previousName] : [],
    ),
    dependencies,
    credentialPatch,
  )
}

export function removeProviderConfiguration(
  name: string,
  dependencies: ProviderConfigurationDependencies,
): Error | null {
  const settings = dependencies.getSettings()
  const providers = { ...(settings?.providers ?? {}) }
  if (!providers[name]) {
    return new Error("Provider '" + name + "' does not exist")
  }
  const routes = settings?.agentModels
  const usedBy = routes
    ? (['main', 'subagent'] as const).filter(
        role => routes[role].provider === name,
      )
    : []
  const isLastProvider = Object.keys(providers).length === 1
  if (usedBy.length > 0 && !isLastProvider) {
    return new Error(
      `Provider '${name}' is used by ${usedBy.join(' and ')}; change it with /model first`,
    )
  }
  delete providers[name]

  return applyPatch(
    createSettingsPatch(
      providers,
      isLastProvider ? undefined : routes,
      isLastProvider ? [] : [name],
    ),
    dependencies,
    {
      [name]: undefined,
    },
  )
}
