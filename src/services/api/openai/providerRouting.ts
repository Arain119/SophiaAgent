import type { ProviderProfiles } from '../../../utils/providerProfiles.js'
import type { ResponsesProviderEndpoint } from './responsesAdapter.js'

export function getSelectedResponsesProvider(
  providers: ProviderProfiles,
  selectedProvider: string,
  getApiKey: (name: string) => string | undefined,
): ResponsesProviderEndpoint[] {
  const profile = providers[selectedProvider]
  return profile
    ? [
        {
          name: selectedProvider,
          baseUrl: profile.baseUrl,
          apiKey: getApiKey(selectedProvider),
        },
      ]
    : []
}
