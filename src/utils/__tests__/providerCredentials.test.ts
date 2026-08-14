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

  test('merges updates into the last snapshot after a transient read failure', () => {
    let stored: Record<string, unknown> | null = {
      providerApiKeys: { primary: 'primary-key' },
      sshPasswords: { host: 'ssh-password' },
    }
    let updated: Record<string, unknown> | undefined
    const access = createProviderCredentialAccess({
      read: () => stored,
      update(data) {
        updated = data
        return { success: true }
      },
    })

    expect(access.get('primary')).toBe('primary-key')
    stored = null
    expect(access.update({ secondary: 'secondary-key' })).toBeNull()
    expect(updated).toEqual({
      providerApiKeys: {
        primary: 'primary-key',
        secondary: 'secondary-key',
      },
      sshPasswords: { host: 'ssh-password' },
    })
  })

  test('refuses to overwrite storage when no readable snapshot exists', () => {
    let updates = 0
    const access = createProviderCredentialAccess({
      read: () => null,
      update() {
        updates += 1
        return { success: true }
      },
    })

    expect(access.update({ primary: 'new-key' })).toBeInstanceOf(Error)
    expect(updates).toBe(0)
  })
})
