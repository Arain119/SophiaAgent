import { execFile } from 'child_process'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getMacOsKeychainStorageServiceName,
  getUsername,
  primeKeychainCacheFromPrefetch,
} from './macOsKeychainHelpers.js'

const PREFETCH_TIMEOUT_MS = 10_000
let prefetchPromise: Promise<void> | null = null

function readCredentials(): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'security',
      [
        'find-generic-password',
        '-a',
        getUsername(),
        '-w',
        '-s',
        getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX),
      ],
      { encoding: 'utf-8', timeout: PREFETCH_TIMEOUT_MS },
      (error, stdout) => resolve(error ? null : stdout?.trim() || null),
    )
  })
}

export function startKeychainPrefetch(): void {
  if (process.platform !== 'darwin' || prefetchPromise) return
  prefetchPromise = readCredentials().then(primeKeychainCacheFromPrefetch)
}

export async function ensureKeychainPrefetchCompleted(): Promise<void> {
  await prefetchPromise
}
