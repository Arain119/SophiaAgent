import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearProviderRetryAt,
  getProviderRetryAt,
  getProviderRetryStateSnapshot,
  resetProviderRetryStateForTests,
  setProviderRetryAt,
} from '../providerRetryState.js'

let configDir: string | undefined
const originalConfigDir = process.env.SOPHIA_CONFIG_DIR

afterEach(async () => {
  resetProviderRetryStateForTests()
  if (originalConfigDir === undefined) delete process.env.SOPHIA_CONFIG_DIR
  else process.env.SOPHIA_CONFIG_DIR = originalConfigDir
  if (configDir) await rm(configDir, { recursive: true, force: true })
  configDir = undefined
})

describe('providerRetryState', () => {
  test('persists an active retry window across in-memory resets', async () => {
    configDir = await mkdtemp(join(tmpdir(), 'sophia-provider-retry-'))
    process.env.SOPHIA_CONFIG_DIR = configDir
    const retryAt = Date.now() + 60_000

    setProviderRetryAt('primary', retryAt)
    resetProviderRetryStateForTests()

    expect(getProviderRetryAt('primary')).toBe(retryAt)
    expect(getProviderRetryStateSnapshot()).toEqual([
      { key: 'primary', retryAt },
    ])
  })

  test('clears a recovered route', async () => {
    configDir = await mkdtemp(join(tmpdir(), 'sophia-provider-retry-'))
    process.env.SOPHIA_CONFIG_DIR = configDir
    setProviderRetryAt('primary', Date.now() + 60_000)

    clearProviderRetryAt('primary')

    expect(getProviderRetryAt('primary')).toBeUndefined()
    expect(getProviderRetryStateSnapshot()).toEqual([])
  })
})
