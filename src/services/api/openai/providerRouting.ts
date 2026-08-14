import type { ProviderProfiles } from '../../../utils/providerProfiles.js'
import type { ResponsesProviderEndpoint } from './responsesAdapter.js'

export function resolveResponsesProviderName(
  providers: ProviderProfiles,
  requestedProvider: string | undefined,
  configuredProvider: string | undefined,
): string {
  if (requestedProvider && providers[requestedProvider]) {
    return requestedProvider
  }
  return configuredProvider ?? requestedProvider ?? ''
}

export function getSelectedResponsesProvider(
  providers: ProviderProfiles,
  selectedProvider: string,
  getApiKey: (name: string) => string | undefined,
): ResponsesProviderEndpoint[] {
  const profile = providers[selectedProvider]
  const requiresApiKey = profile
    ? new URL(profile.baseUrl).hostname === 'api.openai.com'
    : false
  return profile
    ? [
        {
          name: selectedProvider,
          baseUrl: profile.baseUrl,
          apiKey: getApiKey(selectedProvider),
          requiresApiKey,
        },
      ]
    : []
}
