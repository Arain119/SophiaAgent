import { getSecureStorage } from './secureStorage/index.js'

export type ProviderCredentialPatch = Record<string, string | undefined>

export function getProviderApiKey(name: string): string | undefined {
  return getSecureStorage().read()?.providerApiKeys?.[name]
}

export function updateProviderApiKeys(
  patch: ProviderCredentialPatch,
): Error | null {
  if (Object.keys(patch).length === 0) return null

  const storage = getSecureStorage()
  const existing = storage.read() ?? {}
  const providerApiKeys = { ...(existing.providerApiKeys ?? {}) }
  for (const [name, apiKey] of Object.entries(patch)) {
    if (apiKey) providerApiKeys[name] = apiKey
    else delete providerApiKeys[name]
  }

  const result = storage.update({
    ...existing,
    providerApiKeys:
      Object.keys(providerApiKeys).length > 0 ? providerApiKeys : undefined,
  })
  return result.success
    ? null
    : new Error('Failed to update provider credentials')
}
