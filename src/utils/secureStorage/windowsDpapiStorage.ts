import { spawnSync } from 'child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { getSophiaConfigHomeDir } from '../envUtils.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import type { SecureStorage, SecureStorageData } from './types.js'

const PROTECT_SCRIPT =
  '$d=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; ' +
  '$b=[Text.Encoding]::UTF8.GetBytes($d); ' +
  '$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
  '[Console]::Out.Write([Convert]::ToBase64String($e))'
const UNPROTECT_SCRIPT =
  '$d=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; ' +
  '$b=[Convert]::FromBase64String($d); ' +
  '$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))'

type DpapiTransform = (
  operation: 'protect' | 'unprotect',
  value: string,
) => string

function runDpapi(operation: 'protect' | 'unprotect', value: string): string {
  const script = operation === 'protect' ? PROTECT_SCRIPT : UNPROTECT_SCRIPT
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {
      input: value,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  if (result.status !== 0 || result.error) {
    throw result.error ?? new Error('DPAPI operation failed')
  }
  return result.stdout
}

export function createWindowsDpapiStorage(
  options: { storagePath?: string; transform?: DpapiTransform } = {},
): SecureStorage {
  const storagePath =
    options.storagePath ?? join(getSophiaConfigHomeDir(), '.credentials.dpapi')
  const transform = options.transform ?? runDpapi
  return {
    name: 'windows-dpapi',
    read(): SecureStorageData | null {
      try {
        return jsonParse(
          transform('unprotect', readFileSync(storagePath, 'utf8')),
        )
      } catch {
        return null
      }
    },
    async readAsync(): Promise<SecureStorageData | null> {
      return this.read()
    },
    update(data: SecureStorageData): { success: boolean } {
      const temporary = `${storagePath}.${process.pid}.tmp`
      try {
        mkdirSync(dirname(storagePath), { recursive: true })
        const encrypted = transform('protect', jsonStringify(data))
        writeFileSync(temporary, encrypted, { encoding: 'utf8', mode: 0o600 })
        renameSync(temporary, storagePath)
        chmodSync(storagePath, 0o600)
        return { success: true }
      } catch {
        try {
          unlinkSync(temporary)
        } catch {}
        return { success: false }
      }
    },
    delete(): boolean {
      try {
        unlinkSync(storagePath)
        return true
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT'
      }
    },
  }
}

export const windowsDpapiStorage = createWindowsDpapiStorage()
