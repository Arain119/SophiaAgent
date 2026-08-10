import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../../tools.js'
import { SSHRemoteTool } from '../SSHRemoteTool.js'

describe('SSHRemoteTool', () => {
  test('is registered in the Core model tool pool', () => {
    expect(getAllBaseTools().map(tool => tool.name)).toContain('SSHRemote')
  })

  test('accepts an execution target and local connection options', () => {
    const result = SSHRemoteTool.inputSchema.safeParse({
      action: 'execute',
      host: 'deploy@example.com',
      command: 'git status --short',
      cwd: '/srv/app',
      port: 2222,
      identityFile: 'C:\\Users\\me\\.ssh\\deploy',
      timeoutMs: 30_000,
      password: 'sophia-secret!42',
    })

    expect(result.success).toBe(true)
  })

  test('accepts a one-time password without exposing it in rendered use text', () => {
    const result = SSHRemoteTool.inputSchema.safeParse({
      action: 'test',
      host: 'root@example.com',
      password: 'sophia-secret!42',
    })
    expect(result.success).toBe(true)
    expect(
      SSHRemoteTool.renderToolUseMessage({
        action: 'test',
        host: 'root@example.com',
        password: 'sophia-secret!42',
      }),
    ).not.toContain('sophia-secret')
  })

  test('accepts SSH command and URL forms as a host input', () => {
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'test',
        host: 'ssh -p 17033 root@example.com',
        password: 'secret',
      }).success,
    ).toBe(true)
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'test',
        host: 'ssh://root@example.com:17033',
        password: 'secret',
      }).success,
    ).toBe(true)
  })

  test('rejects unknown fields and invalid timeouts', () => {
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'execute',
        host: 'example.com',
        command: 'pwd',
        unexpectedSecret: 'secret',
      }).success,
    ).toBe(false)
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'execute',
        host: 'example.com',
        command: 'pwd',
        timeoutMs: 10,
      }).success,
    ).toBe(false)
  })

  test('validates named connection management actions', () => {
    expect(
      SSHRemoteTool.inputSchema.safeParse({ action: 'status' }).success,
    ).toBe(true)
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'status',
        name: 'production',
      }).success,
    ).toBe(true)
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'save',
        name: 'production',
        host: 'deploy@example.com',
        identityFile: 'C:\\Users\\me\\.ssh\\deploy',
      }).success,
    ).toBe(true)
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'execute',
        name: 'production',
        command: 'systemctl status app',
      }).success,
    ).toBe(true)
    expect(
      SSHRemoteTool.inputSchema.safeParse({
        action: 'save',
        host: 'example.com',
      }).success,
    ).toBe(false)
    expect(
      SSHRemoteTool.inputSchema.safeParse({ action: 'disconnect' }).success,
    ).toBe(false)
  })

  test('marks inspection commands read-only and all calls destructive-capable', () => {
    expect(
      SSHRemoteTool.isReadOnly({
        action: 'execute',
        host: 'example.com',
        command: 'git status',
      }),
    ).toBe(true)
    expect(
      SSHRemoteTool.isReadOnly({
        action: 'execute',
        host: 'example.com',
        command: 'rm -rf build',
      }),
    ).toBe(false)
    expect(SSHRemoteTool.isDestructive()).toBe(true)
  })

  test('maps stdout, stderr, and exit status into one model result', () => {
    const result = SSHRemoteTool.mapToolResultToToolResultBlockParam(
      { stdout: 'ok\n', stderr: 'warning\n', exitCode: 0 },
      'tool-1',
    )

    expect(result.content).toContain('exit code: 0')
    expect(result.content).toContain('stdout:\nok')
    expect(result.content).toContain('stderr:\nwarning')
  })
})
