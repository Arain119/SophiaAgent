import { describe, expect, test } from 'bun:test'
import { classifyShellTermination } from '../ShellCommand.js'

describe('classifyShellTermination', () => {
  test('classifies an unexplained exit 137 as likely memory pressure', () => {
    expect(classifyShellTermination(137)).toBe('likely_oom')
  })

  test('preserves a known Sophia-initiated termination reason', () => {
    expect(classifyShellTermination(137, 'user')).toBe('user')
    expect(classifyShellTermination(143, 'timeout')).toBe('timeout')
    expect(classifyShellTermination(137, 'output_limit')).toBe('output_limit')
  })

  test('does not label an ordinary failure as a termination', () => {
    expect(classifyShellTermination(1)).toBeUndefined()
  })
})
