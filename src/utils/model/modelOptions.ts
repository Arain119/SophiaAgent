import { getAgentModelRoute } from '../providerProfiles.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'

export type ModelOption = {
  value: string
  label: string
  description: string
  descriptionForModel?: string
}

export function getModelOptions(): ModelOption[] {
  const settings = getSettings_DEPRECATED() ?? {}
  const route = getAgentModelRoute(settings, 'main')
  if (!route) return []
  return [
    {
      value: route.model,
      label: route.model,
      description: 'via ' + route.provider,
    },
  ]
}
