import type { APIProvider } from './model/providers.js'

export const MODEL_TIERS = ['fast', 'deep'] as const

export type ModelTier = (typeof MODEL_TIERS)[number]

export const PROVIDER_MODELS = {
  fast: 'gpt-5.6-luna',
  deep: 'gpt-5.6-sol',
} as const satisfies Record<ModelTier, string>

export type ProviderModels = typeof PROVIDER_MODELS

export type ProviderProfile = {
  protocol: APIProvider
  baseUrl: string
}

export type ProviderProfiles = Record<string, ProviderProfile>

export const AGENT_MODEL_ROLES = ['main', 'subagent'] as const

export type AgentModelRole = (typeof AGENT_MODEL_ROLES)[number]

export type AgentModelRoute = {
  model: string
  provider: string
}

export type AgentModelRoutes = Record<AgentModelRole, AgentModelRoute>

export type ProviderProfileSettings = {
  providers?: ProviderProfiles
  agentModels?: AgentModelRoutes
}

export function getAgentModelRoute(
  settings: ProviderProfileSettings,
  role: AgentModelRole,
): AgentModelRoute | undefined {
  const route = settings.agentModels?.[role]
  return route && settings.providers?.[route.provider] ? route : undefined
}

export function getProviderProfileForRole(
  settings: ProviderProfileSettings,
  role: AgentModelRole,
): ProviderProfile | undefined {
  const route = getAgentModelRoute(settings, role)
  return route ? settings.providers?.[route.provider] : undefined
}

export function getModelForTier(tier: ModelTier): string {
  return PROVIDER_MODELS[tier]
}

export function isModelTier(value: string): value is ModelTier {
  return MODEL_TIERS.some(tier => tier === value)
}

export function getProviderModelIds(): string[] {
  return MODEL_TIERS.map(getModelForTier)
}

export function getProviderModelTier(model: string): ModelTier | undefined {
  return MODEL_TIERS.find(tier => getModelForTier(tier) === model)
}

export function providerProfileToEnvironment(
  profile: ProviderProfile,
  apiKey?: string,
  model?: string,
): Record<string, string | undefined> {
  return {
    OPENAI_BASE_URL: profile.baseUrl,
    OPENAI_API_KEY: apiKey || undefined,
    OPENAI_MODEL: model,
  }
}
