import { describe, expect, test } from 'bun:test'
import { normalizeNameForMCP } from '../normalization'

describe('normalizeNameForMCP', () => {
  test('returns simple valid name unchanged', () => {
    expect(normalizeNameForMCP('my-server')).toBe('my-server')
  })

  test('replaces dots with underscores', () => {
    expect(normalizeNameForMCP('my.server.name')).toBe('my_server_name')
  })

  test('replaces spaces with underscores', () => {
    expect(normalizeNameForMCP('my server')).toBe('my_server')
  })

  test('replaces special characters with underscores', () => {
    expect(normalizeNameForMCP('server@v2!')).toBe('server_v2_')
  })

  test('returns already valid name unchanged', () => {
    expect(normalizeNameForMCP('valid_name-123')).toBe('valid_name-123')
  })

  test('returns empty string for empty input', () => {
    expect(normalizeNameForMCP('')).toBe('')
  })

  test('preserves one replacement per invalid character', () => {
    expect(normalizeNameForMCP('a..b')).toBe('a__b')
  })

  test('preserves trailing replacements', () => {
    expect(normalizeNameForMCP('name!')).toBe('name_')
  })
})
