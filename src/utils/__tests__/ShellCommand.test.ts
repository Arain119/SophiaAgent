import { describe, expect, test } from 'bun:test'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { classifyShellTermination, wrapSpawn } from '../ShellCommand.js'
import { TaskOutput } from '../task/TaskOutput.js'

describe('classifyShellTermination', () => {
  test('classifies an unexplained exit 137 as likely memory pressure', () => {
    expect(classifyShellTermination(137)).toBe('likely_oom')
  })

  test('preserves a known Sophia-initiated termination reason', () => {
    expect(classifyShellTermination(137, 'user')).toBe('user')
    expect(classifyShellTermination(143, 'timeout')).toBe('timeout')
    expect(classifyShellTermination(137, 'output_limit')).toBe('output_limit')
    expect(classifyShellTermination(137, 'memory_pressure')).toBe(
      'memory_pressure',
    )
  })

  test('does not label an ordinary failure as a termination', () => {
    expect(classifyShellTermination(1)).toBeUndefined()
  })
})

describe('ShellCommand lifecycle controls', () => {
  test('memory controls become safe no-ops after cleanup', () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 12345,
      stdout: null,
      stderr: null,
    }) as unknown as ChildProcess
    const command = wrapSpawn(
      child,
      new AbortController().signal,
      10_000,
      new TaskOutput(`shell-cleanup-${Date.now()}`, null),
    )

    command.cleanup()

    expect(command.pid).toBeUndefined()
    expect(command.pause()).toBe(false)
    expect(command.resume()).toBe(false)
    expect(() => command.terminateForMemoryPressure()).not.toThrow()
  })
})
