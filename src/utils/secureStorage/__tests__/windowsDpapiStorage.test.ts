import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createWindowsDpapiStorage } from '../windowsDpapiStorage.js'

describe('Windows DPAPI storage', () => {
  test('persists transformed data without plaintext', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sophia-dpapi-'))
    const storagePath = join(dir, 'credentials.dpapi')
    const transform = (operation: 'protect' | 'unprotect', value: string) =>
      operation === 'protect'
        ? Buffer.from(value).toString('base64')
        : Buffer.from(value, 'base64').toString()
    const storage = createWindowsDpapiStorage({ storagePath, transform })
    try {
      expect(
        storage.update({ sshPasswords: { host: 'secret-value' } }).success,
      ).toBe(true)
      expect(await readFile(storagePath, 'utf8')).not.toContain('secret-value')
      expect(storage.read()).toEqual({
        sshPasswords: { host: 'secret-value' },
      })
      expect(storage.delete()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
