import { describe, expect, test } from 'bun:test'
import { createProviderCredentialAccess } from '../providerCredentials.js'

describe('provider credential access', () => {
  test('keeps the last successful credential after a transient read failure', () => {
    let reads = 0
    const access = createProviderCredentialAccess({
      read() {
        reads += 1
        return reads === 1
          ? { providerApiKeys: { primary: 'stored-key' } }
          : null
      },
      update() {
        return { success: true }
      },
    })

    expect(access.get('primary')).toBe('stored-key')
    expect(access.get('primary')).toBe('stored-key')
  })

  test('refreshes the credential snapshot after an update', () => {
    let stored: Record<string, unknown> | null = {
      providerApiKeys: { primary: 'old-key' },
    }
    const access = createProviderCredentialAccess({
      read: () => stored,
      update(data) {
        stored = data
        return { success: true }
      },
    })

    expect(access.update({ primary: 'new-key' })).toBeNull()
    stored = null
    expect(access.get('primary')).toBe('new-key')
  })

  test('clears the snapshot after a successful empty read', () => {
    let stored: Record<string, unknown> = {
      providerApiKeys: { primary: 'old-key' },
    }
    const access = createProviderCredentialAccess({
      read: () => stored,
      update() {
        return { success: true }
      },
    })

    expect(access.get('primary')).toBe('old-key')
    stored = {}
    expect(access.get('primary')).toBeUndefined()
  })
})
