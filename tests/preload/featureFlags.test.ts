import { afterEach, describe, expect, test } from 'bun:test'
import { feature } from 'bundle'

const PROBE_FEATURE = 'SOPHIA_TEST_PRELOAD_PROBE'
const PROBE_ENV = `FEATURE_${PROBE_FEATURE}`

afterEach(() => {
  delete process.env[PROBE_ENV]
})

describe('test feature runtime', () => {
  test('keeps Core features disabled by default', () => {
    delete process.env[PROBE_ENV]
    expect(feature(PROBE_FEATURE)).toBe(false)
  })

  test('allows an explicit feature override for focused tests', () => {
    process.env[PROBE_ENV] = '1'
    expect(feature(PROBE_FEATURE)).toBe(true)
  })
})
