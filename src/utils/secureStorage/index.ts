import { createFallbackStorage } from './fallbackStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import { plainTextStorage } from './plainTextStorage.js'
import type { SecureStorage, SecureStorageData } from './types.js'
import { windowsDpapiStorage } from './windowsDpapiStorage.js'

/**
 * Get the appropriate secure storage implementation for the current platform
 */
export function getSecureStorage(): SecureStorage {
  if (process.platform === 'darwin') {
    return createFallbackStorage(macOsKeychainStorage, plainTextStorage)
  }

  if (process.platform === 'win32') {
    return {
      ...windowsDpapiStorage,
      name: 'windows-dpapi-with-plaintext-migration',
      read() {
        const encrypted = windowsDpapiStorage.read()
        if (encrypted !== null) return encrypted
        const legacy = plainTextStorage.read()
        if (legacy === null) return null
        if (windowsDpapiStorage.update(legacy).success) {
          plainTextStorage.delete()
          return legacy
        }
        return null
      },
      async readAsync() {
        return this.read()
      },
      update(data: SecureStorageData) {
        const result = windowsDpapiStorage.update(data)
        if (result.success) plainTextStorage.delete()
        return result
      },
      delete() {
        const encryptedDeleted = windowsDpapiStorage.delete()
        const legacyDeleted = plainTextStorage.delete()
        return encryptedDeleted && legacyDeleted
      },
    }
  }

  // TODO: add libsecret support for Linux

  return plainTextStorage
}
