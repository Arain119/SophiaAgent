import { describe, expect, test } from 'bun:test'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { ToolFailureTracker } from '../toolFailureTracker.js'

function result(content: string, isError = true): ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: crypto.randomUUID(),
    content,
    is_error: isError,
  }
}

describe('ToolFailureTracker', () => {
  test('guides repeated failures without changing the first result', () => {
    const tracker = new ToolFailureTracker()
    const first = tracker.observe(
      'Bash',
      { command: 'build' },
      result('failed at 2026-08-12T12:00:00Z'),
    )
    const second = tracker.observe(
      'Bash',
      { command: 'build' },
      result('failed at 2026-08-12T12:00:01Z'),
    )
    const third = tracker.observe(
      'Bash',
      { command: 'build' },
      result('failed at 2026-08-12T12:00:02Z'),
    )
    expect(first.content).toBe('failed at 2026-08-12T12:00:00Z')
    expect(String(second.content)).toContain('Change the approach')
    expect(String(third.content)).toContain('Stop retrying')
  })

  test('success clears failures for the same tool target', () => {
    const tracker = new ToolFailureTracker()
    tracker.observe(
      'SSHRemote',
      { host: 'x', command: 'test' },
      result('exit 1'),
    )
    tracker.observe(
      'SSHRemote',
      { host: 'x', command: 'test' },
      result('ok', false),
    )
    const next = tracker.observe(
      'SSHRemote',
      { host: 'x', command: 'test' },
      result('exit 1'),
    )
    expect(next.content).toBe('exit 1')
  })

  test('keeps only the configured number of fingerprints', () => {
    const tracker = new ToolFailureTracker(2)
    tracker.observe('Bash', { command: 'a' }, result('a'))
    tracker.observe('Bash', { command: 'b' }, result('b'))
    tracker.observe('Bash', { command: 'c' }, result('c'))
    expect(tracker.size()).toBe(2)
  })
})
