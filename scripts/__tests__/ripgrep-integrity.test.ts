import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { RIPGREP_SHA256, getRipgrepSha256, sha256, verifySha256 } =
  require('../ripgrep-integrity.cjs') as {
    RIPGREP_SHA256: Readonly<Record<string, string>>
    getRipgrepSha256(target: string): string
    sha256(buffer: Uint8Array): string
    verifySha256(buffer: Uint8Array, expected: string, label?: string): void
  }

describe('ripgrep archive integrity', () => {
  test('pins a SHA-256 digest for every supported release target', () => {
    expect(Object.keys(RIPGREP_SHA256)).toHaveLength(7)
    for (const digest of Object.values(RIPGREP_SHA256)) {
      expect(digest).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(getRipgrepSha256('x86_64-pc-windows-msvc')).toBe(
      'bd28761f4918ea8fcb7a95f636b4422a915d55af268d9805be82d8ce0fdfc823',
    )
  })

  test('accepts matching content and rejects modified content', () => {
    const archive = Buffer.from('verified archive fixture')
    const expected = sha256(archive)
    expect(() => verifySha256(archive, expected, 'fixture')).not.toThrow()
    expect(() =>
      verifySha256(Buffer.from('modified fixture'), expected, 'fixture'),
    ).toThrow('fixture checksum mismatch')
  })

  test('rejects release targets without a pinned digest', () => {
    expect(() => getRipgrepSha256('unsupported-target')).toThrow(
      'No pinned ripgrep checksum',
    )
  })
})
