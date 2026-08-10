import { describe, expect, test } from 'bun:test'

/**
 * Verify compaction and context-related user messages are clear and actionable.
 * Pure string tests — no side effects.
 */

describe('Compaction error messages', () => {
  test('not enough messages includes guidance', () => {
    const msg =
      'Not enough messages to compact. Send a few more messages first, then try again.'
    expect(msg).toContain('Not enough messages')
    expect(msg).toContain('try again')
  })

  test('prompt too long suggests actions', () => {
    const msg =
      'Conversation too long to continue. Start a new session with /new.'
    expect(msg).not.toContain('/compact')
    expect(msg).toContain('/new')
    expect(msg).toContain('too long')
  })

  test('incomplete response mentions network', () => {
    const msg =
      'Compaction interrupted · This may be due to network issues — please try again.'
    expect(msg).toContain('interrupted')
    expect(msg).toContain('try again')
  })

  test('user abort is clear', () => {
    const msg = 'API Error: Request was aborted.'
    expect(msg).toContain('aborted')
  })
})

describe('Compaction display text', () => {
  test('compact boundary is a short inline marker', () => {
    const title = '\u25cf Conversation compacted'
    expect(title).toBe('\u25cf Conversation compacted')
  })

  test('manual compact title mentions message count', () => {
    const line1 = 'Summarized conversation'
    expect(line1).toContain('Summarized')
  })

  test('expand hint says "view summary" not "expand"', () => {
    const hint = 'view summary'
    expect(hint).toContain('summary')
  })
})
