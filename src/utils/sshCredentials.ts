import { getSecureStorage } from './secureStorage/index.js'

type CredentialStorage = {
  read():
    | ({ sshPasswords?: Record<string, string> } & Record<string, unknown>)
    | null
  update(data: Record<string, unknown>): { success: boolean }
}

export function sshCredentialKey(host: string, port = 22): string {
  return `${host}\0${port}`
}

export function getSshPassword(
  host: string,
  port = 22,
  storage: CredentialStorage = getSecureStorage(),
): string | undefined {
  return storage.read()?.sshPasswords?.[sshCredentialKey(host, port)]
}

export function setSshPassword(
  host: string,
  port: number,
  password: string,
  storage: CredentialStorage = getSecureStorage(),
): Error | null {
  const existing = storage.read() ?? {}
  const result = storage.update({
    ...existing,
    sshPasswords: {
      ...(existing.sshPasswords ?? {}),
      [sshCredentialKey(host, port)]: password,
    },
  })
  return result.success ? null : new Error('Failed to save SSH credential')
}

export function removeSshPassword(
  host: string,
  port = 22,
  storage: CredentialStorage = getSecureStorage(),
): Error | null {
  const existing = storage.read() ?? {}
  const sshPasswords = { ...(existing.sshPasswords ?? {}) }
  delete sshPasswords[sshCredentialKey(host, port)]
  const result = storage.update({
    ...existing,
    sshPasswords:
      Object.keys(sshPasswords).length > 0 ? sshPasswords : undefined,
  })
  return result.success ? null : new Error('Failed to remove SSH credential')
}
