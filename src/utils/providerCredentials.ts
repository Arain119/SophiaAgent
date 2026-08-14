import { getSecureStorage } from './secureStorage/index.js'

export type ProviderCredentialPatch = Record<string, string | undefined>

type ProviderCredentialStorage = {
  read():
    | ({ providerApiKeys?: Record<string, string> } & Record<string, unknown>)
    | null
  update(data: Record<string, unknown>): { success: boolean }
}

export function createProviderCredentialAccess(
  storage: ProviderCredentialStorage,
): {
  get(name: string): string | undefined
  update(patch: ProviderCredentialPatch): Error | null
} {
  let lastKnownData: Record<string, unknown> | undefined
  let lastKnownApiKeys: Record<string, string> | undefined

  return {
    get(name: string): string | undefined {
      const stored = storage.read()
      if (stored !== null) {
        lastKnownData = { ...stored }
        lastKnownApiKeys = { ...(stored.providerApiKeys ?? {}) }
      }
      return lastKnownApiKeys?.[name]
    },
    update(patch: ProviderCredentialPatch): Error | null {
      if (Object.keys(patch).length === 0) return null

      const stored = storage.read()
      if (stored !== null) {
        lastKnownData = { ...stored }
        lastKnownApiKeys = { ...(stored.providerApiKeys ?? {}) }
      }
      const existing = stored ?? lastKnownData ?? null
      if (existing === null) {
        return new Error(
          'Failed to read existing credentials; refusing to overwrite secure storage',
        )
      }
      const existingData = existing as Record<string, unknown>
      const providerApiKeys = {
        ...((existingData.providerApiKeys as
          | Record<string, string>
          | undefined) ?? {}),
      }
      for (const [name, apiKey] of Object.entries(patch)) {
        if (apiKey) providerApiKeys[name] = apiKey
        else delete providerApiKeys[name]
      }

      const result = storage.update({
        ...existing,
        providerApiKeys:
          Object.keys(providerApiKeys).length > 0 ? providerApiKeys : undefined,
      })
      if (result.success) {
        lastKnownData = { ...existingData, providerApiKeys }
        lastKnownApiKeys = { ...providerApiKeys }
      }
      return result.success
        ? null
        : new Error('Failed to update provider credentials')
    },
  }
}

const providerCredentialAccess = createProviderCredentialAccess(
  getSecureStorage(),
)

export function getProviderApiKey(name: string): string | undefined {
  return providerCredentialAccess.get(name)
}

export function updateProviderApiKeys(
  patch: ProviderCredentialPatch,
): Error | null {
  return providerCredentialAccess.update(patch)
}
