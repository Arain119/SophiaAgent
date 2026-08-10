import { describe, expect, test } from 'bun:test'
import {
  safetyRuleExtractPrefix,
  hasWildcards,
  matchWildcardPattern,
  parseSafetyRule,
  suggestionForExactCommand,
  suggestionForPrefix,
} from '../shellRuleMatching'

// ─── safetyRuleExtractPrefix ────────────────────────────────────────

describe('safetyRuleExtractPrefix', () => {
  test('extracts prefix from legacy :* syntax', () => {
    expect(safetyRuleExtractPrefix('npm:*')).toBe('npm')
  })

  test('extracts multi-word prefix', () => {
    expect(safetyRuleExtractPrefix('git commit:*')).toBe('git commit')
  })

  test('returns null for non-prefix rule', () => {
    expect(safetyRuleExtractPrefix('npm install')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(safetyRuleExtractPrefix('')).toBeNull()
  })

  test('returns null for wildcard without colon', () => {
    expect(safetyRuleExtractPrefix('npm *')).toBeNull()
  })
})

// ─── hasWildcards ───────────────────────────────────────────────────────

describe('hasWildcards', () => {
  test('returns true for unescaped wildcard', () => {
    expect(hasWildcards('git *')).toBe(true)
  })

  test('returns false for legacy :* syntax', () => {
    expect(hasWildcards('npm:*')).toBe(false)
  })

  test('returns false for escaped wildcard', () => {
    expect(hasWildcards('git \\*')).toBe(false)
  })

  test('returns true for * with even backslashes', () => {
    expect(hasWildcards('git \\\\*')).toBe(true)
  })

  test('returns false for no wildcards', () => {
    expect(hasWildcards('npm install')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(hasWildcards('')).toBe(false)
  })
})

// ─── matchWildcardPattern ───────────────────────────────────────────────

describe('matchWildcardPattern', () => {
  test('matches simple wildcard', () => {
    expect(matchWildcardPattern('git *', 'git add')).toBe(true)
  })

  test('matches bare command when pattern ends with space-wildcard', () => {
    expect(matchWildcardPattern('git *', 'git')).toBe(true)
  })

  test('rejects non-matching command', () => {
    expect(matchWildcardPattern('git *', 'npm install')).toBe(false)
  })

  test('matches middle wildcard', () => {
    expect(matchWildcardPattern('git * --verbose', 'git add --verbose')).toBe(
      true,
    )
  })

  test('handles escaped asterisk as literal', () => {
    expect(matchWildcardPattern('echo \\*', 'echo *')).toBe(true)
    expect(matchWildcardPattern('echo \\*', 'echo hello')).toBe(false)
  })

  test('case-insensitive matching', () => {
    expect(matchWildcardPattern('Git *', 'git add', true)).toBe(true)
  })

  test('exact match without wildcards', () => {
    expect(matchWildcardPattern('npm install', 'npm install')).toBe(true)
    expect(matchWildcardPattern('npm install', 'npm update')).toBe(false)
  })

  test('handles regex special characters in pattern', () => {
    expect(matchWildcardPattern('echo (hello)', 'echo (hello)')).toBe(true)
  })
})

// ─── parseSafetyRule ────────────────────────────────────────────────

describe('parseSafetyRule', () => {
  test('parses exact command', () => {
    const result = parseSafetyRule('npm install')
    expect(result).toEqual({ type: 'exact', command: 'npm install' })
  })

  test('parses legacy prefix syntax', () => {
    const result = parseSafetyRule('npm:*')
    expect(result).toEqual({ type: 'prefix', prefix: 'npm' })
  })

  test('parses wildcard pattern', () => {
    const result = parseSafetyRule('git *')
    expect(result).toEqual({ type: 'wildcard', pattern: 'git *' })
  })

  test('escaped wildcard is treated as exact', () => {
    const result = parseSafetyRule('echo \\*')
    expect(result.type).toBe('exact')
  })
})

// ─── suggestionForExactCommand ──────────────────────────────────────────

describe('suggestionForExactCommand', () => {
  test('creates addRules suggestion', () => {
    const result = suggestionForExactCommand('Bash', 'npm install')
    expect(result).toHaveLength(1)
    expect(result[0]!.type).toBe('addRules')
    expect((result[0] as any).rules[0]!.toolName).toBe('Bash')
    expect((result[0] as any).rules[0]!.ruleContent).toBe('npm install')
    expect((result[0] as any).behavior).toBe('allow')
  })
})

// ─── suggestionForPrefix ────────────────────────────────────────────────

describe('suggestionForPrefix', () => {
  test('creates prefix suggestion with :*', () => {
    const result = suggestionForPrefix('Bash', 'npm')
    expect((result[0] as any).rules[0]!.ruleContent).toBe('npm:*')
  })
})
