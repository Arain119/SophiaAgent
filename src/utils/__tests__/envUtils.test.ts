import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  isEnvTruthy,
  isEnvDefinedFalsy,
  parseEnvVars,
  hasNodeOption,
  isBareMode,
  shouldMaintainProjectWorkingDir,
  getSophiaConfigHomeDir,
} from '../envUtils'

// 鈹€鈹€鈹€ isEnvTruthy 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('isEnvTruthy', () => {
  test("returns true for '1'", () => {
    expect(isEnvTruthy('1')).toBe(true)
  })

  test("returns true for 'true'", () => {
    expect(isEnvTruthy('true')).toBe(true)
  })

  test("returns true for 'TRUE'", () => {
    expect(isEnvTruthy('TRUE')).toBe(true)
  })

  test("returns true for 'yes'", () => {
    expect(isEnvTruthy('yes')).toBe(true)
  })

  test("returns true for 'on'", () => {
    expect(isEnvTruthy('on')).toBe(true)
  })

  test('returns true for boolean true', () => {
    expect(isEnvTruthy(true)).toBe(true)
  })

  test("returns false for '0'", () => {
    expect(isEnvTruthy('0')).toBe(false)
  })

  test("returns false for 'false'", () => {
    expect(isEnvTruthy('false')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isEnvTruthy('')).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(isEnvTruthy(undefined)).toBe(false)
  })

  test('returns false for boolean false', () => {
    expect(isEnvTruthy(false)).toBe(false)
  })

  test("returns true for ' true ' (trimmed)", () => {
    expect(isEnvTruthy(' true ')).toBe(true)
  })
})

// 鈹€鈹€鈹€ isEnvDefinedFalsy 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('isEnvDefinedFalsy', () => {
  test("returns true for '0'", () => {
    expect(isEnvDefinedFalsy('0')).toBe(true)
  })

  test("returns true for 'false'", () => {
    expect(isEnvDefinedFalsy('false')).toBe(true)
  })

  test("returns true for 'no'", () => {
    expect(isEnvDefinedFalsy('no')).toBe(true)
  })

  test("returns true for 'off'", () => {
    expect(isEnvDefinedFalsy('off')).toBe(true)
  })

  test('returns true for boolean false', () => {
    expect(isEnvDefinedFalsy(false)).toBe(true)
  })

  test('returns false for undefined', () => {
    expect(isEnvDefinedFalsy(undefined)).toBe(false)
  })

  test("returns false for '1'", () => {
    expect(isEnvDefinedFalsy('1')).toBe(false)
  })

  test("returns false for 'true'", () => {
    expect(isEnvDefinedFalsy('true')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isEnvDefinedFalsy('')).toBe(false)
  })
})

// 鈹€鈹€鈹€ parseEnvVars 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('parseEnvVars', () => {
  test('parses KEY=VALUE pairs', () => {
    const result = parseEnvVars(['FOO=bar', 'BAZ=qux'])
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('handles value with equals sign', () => {
    const result = parseEnvVars(['URL=http://host?a=1&b=2'])
    expect(result).toEqual({ URL: 'http://host?a=1&b=2' })
  })

  test('returns empty object for undefined', () => {
    expect(parseEnvVars(undefined)).toEqual({})
  })

  test('returns empty object for empty array', () => {
    expect(parseEnvVars([])).toEqual({})
  })

  test('throws for missing value', () => {
    expect(() => parseEnvVars(['NOVALUE'])).toThrow(
      'Invalid environment variable format',
    )
  })

  test('throws for empty key', () => {
    expect(() => parseEnvVars(['=value'])).toThrow(
      'Invalid environment variable format',
    )
  })
})

// 鈹€鈹€鈹€ hasNodeOption 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('hasNodeOption', () => {
  const saved = process.env.NODE_OPTIONS
  afterEach(() => {
    if (saved === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = saved
  })

  test('returns true when flag present', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096 --inspect'
    expect(hasNodeOption('--inspect')).toBe(true)
  })

  test('returns false when flag absent', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096'
    expect(hasNodeOption('--inspect')).toBe(false)
  })

  test('returns false when NODE_OPTIONS not set', () => {
    delete process.env.NODE_OPTIONS
    expect(hasNodeOption('--inspect')).toBe(false)
  })

  test('does not match partial flags', () => {
    process.env.NODE_OPTIONS = '--inspect-brk'
    expect(hasNodeOption('--inspect')).toBe(false)
  })
})

// 鈹€鈹€鈹€ isBareMode 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('isBareMode', () => {
  const saved = process.env.SOPHIA_SIMPLE
  const originalArgv = [...process.argv]

  afterEach(() => {
    if (saved === undefined) delete process.env.SOPHIA_SIMPLE
    else process.env.SOPHIA_SIMPLE = saved
    process.argv.length = 0
    process.argv.push(...originalArgv)
  })

  test('returns true when SOPHIA_SIMPLE=1', () => {
    process.env.SOPHIA_SIMPLE = '1'
    expect(isBareMode()).toBe(true)
  })

  test('returns true when --bare in argv', () => {
    process.argv.push('--bare')
    expect(isBareMode()).toBe(true)
  })

  test('returns false when neither set', () => {
    delete process.env.SOPHIA_SIMPLE
    // argv doesn't have --bare by default
    expect(isBareMode()).toBe(false)
  })
})

// 鈹€鈹€鈹€ shouldMaintainProjectWorkingDir 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('shouldMaintainProjectWorkingDir', () => {
  const saved = process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR

  afterEach(() => {
    if (saved === undefined)
      delete process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR
    else process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = saved
  })

  test('returns true when set to truthy', () => {
    process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = '1'
    expect(shouldMaintainProjectWorkingDir()).toBe(true)
  })

  test('returns false when not set', () => {
    delete process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR
    expect(shouldMaintainProjectWorkingDir()).toBe(false)
  })
})

// 鈹€鈹€鈹€ getSophiaConfigHomeDir 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('getSophiaConfigHomeDir', () => {
  const saved = process.env.SOPHIA_CONFIG_DIR

  afterEach(() => {
    if (saved === undefined) delete process.env.SOPHIA_CONFIG_DIR
    else process.env.SOPHIA_CONFIG_DIR = saved
  })

  test('uses SOPHIA_CONFIG_DIR when set', () => {
    process.env.SOPHIA_CONFIG_DIR = '/tmp/test-claude'
    // Memoized by SOPHIA_CONFIG_DIR key, so changing env gives fresh value
    expect(getSophiaConfigHomeDir()).toBe('/tmp/test-claude')
  })

  test('returns a string ending with .sophia by default', () => {
    delete process.env.SOPHIA_CONFIG_DIR
    const result = getSophiaConfigHomeDir()
    expect(result).toMatch(/\.sophia$/)
  })
})
