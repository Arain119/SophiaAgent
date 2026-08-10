import type {
  AgentModelRole,
  AgentModelRoutes,
  ProviderProfiles,
} from '../../utils/providerProfiles.js'

export type ModelValues = {
  model: string
  provider: string
}

export type SavedModelSettings = {
  providers?: ProviderProfiles
  agentModels?: AgentModelRoutes
}

export type ModelSettingsPatch = {
  agentModels: AgentModelRoutes
}

export type ModelConfigurationDependencies = {
  getSettings(): SavedModelSettings | null
  updateSettings(patch: ModelSettingsPatch): Error | null
  applyMainEnvironment(route: ModelValues): void
}

export function saveModelConfiguration(
  role: AgentModelRole,
  values: ModelValues,
  dependencies: ModelConfigurationDependencies,
): Error | null {
  const model = values.model.trim()
  const provider = values.provider.trim()
  if (!model) return new Error('Model ID is required')
  if (!provider) return new Error('Provider is required')

  const settings = dependencies.getSettings()
  if (!settings?.providers?.[provider]) {
    return new Error(`Provider '${provider}' does not exist`)
  }
  if (!settings.agentModels) {
    return new Error('Agent model routes are not configured')
  }

  const agentModels: AgentModelRoutes = {
    ...settings.agentModels,
    [role]: { model, provider },
  }
  const error = dependencies.updateSettings({ agentModels })
  if (error) return error
  if (role === 'main') dependencies.applyMainEnvironment({ model, provider })
  return null
}
