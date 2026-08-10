import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import {
  getAgentModelRoute,
  getModelForTier,
  type ModelTier,
  type ProviderProfileSettings,
} from '../providerProfiles.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { ExecutionMode } from '../safety/ExecutionMode.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | null

export function getConfiguredProviderModel(
  settings: ProviderProfileSettings = getSettings_DEPRECATED() ?? {},
  tier: ModelTier = 'deep',
): ModelName {
  if (tier === 'fast') {
    return (
      getAgentModelRoute(settings, 'subagent')?.model ?? getModelForTier(tier)
    )
  }
  return getAgentModelRoute(settings, 'main')?.model ?? getModelForTier(tier)
}

export function requireConfiguredProviderModel(
  model: string,
  _settings: ProviderProfileSettings = getSettings_DEPRECATED() ?? {},
): ModelName {
  const normalized = model.trim()
  if (!normalized) throw new Error('Model ID cannot be empty')
  return normalized
}

export function getSmallFastModel(): ModelName {
  return getConfiguredProviderModel(undefined, 'fast')
}

export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  return getMainLoopModelOverride() ?? undefined
}

export function getMainLoopModel(
  settings: ProviderProfileSettings = getSettings_DEPRECATED() ?? {},
): ModelName {
  const override = getUserSpecifiedModelSetting()
  return override
    ? requireConfiguredProviderModel(override, settings)
    : getConfiguredProviderModel(settings, 'deep')
}

export function getRuntimeMainLoopModel(params: {
  executionMode: ExecutionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  return params.mainLoopModel
}

export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  return name
}

export function getCanonicalName(name: ModelName): ModelShortName {
  return name
}

export function renderModelSetting(setting: ModelName): string {
  return setting
}

export function getPublicModelDisplayName(_model: ModelName): null {
  return null
}

export function renderModelName(model: ModelName): string {
  return model
}

export function getPublicModelName(model: ModelName): string {
  return `Sophia (${model})`
}

export function parseUserSpecifiedModel(modelInput: ModelName): ModelName {
  const model = modelInput.trim()
  if (!model) throw new Error('Model ID cannot be empty')
  return requireConfiguredProviderModel(model)
}

export function resolveSkillModelOverride(
  _skillModel: string,
  _currentModel: string,
): string {
  return getSmallFastModel()
}

export function modelDisplayString(model: ModelSetting): string {
  return model ?? getConfiguredProviderModel()
}

export function normalizeModelStringForAPI(model: string): string {
  return requireConfiguredProviderModel(model)
}
