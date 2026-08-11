import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import {
  getSshPassword,
  removeSshPassword,
  setSshPassword,
} from '../sshCredentials.js'
import {
  redactSecretText,
  redactTranscriptSecrets,
} from '../transcriptSecretRedaction.js'

function memoryCredentialStorage() {
  let data: Record<string, unknown> = {}
  return {
    read: () => data,
    update: (next: Record<string, unknown>) => {
      data = next
      return { success: true }
    },
  }
}

describe('transcript secret redaction', () => {
  test('persists and removes an SSH password by host and port', () => {
    const storage = memoryCredentialStorage()
    expect(
      setSshPassword('root@example.com', 17034, 'saved-password', storage),
    ).toBeNull()
    expect(getSshPassword('root@example.com', 17034, storage)).toBe(
      'saved-password',
    )
    expect(getSshPassword('root@example.com', 22, storage)).toBeUndefined()

    expect(removeSshPassword('root@example.com', 17034, storage)).toBeNull()
    expect(getSshPassword('root@example.com', 17034, storage)).toBeUndefined()
  })

  test('redacts password labels and common API token formats', () => {
    const text = redactSecretText(
      'password: secret-value npm_1234567890abcdefghijkl sk-1234567890abcdefghijkl',
    )

    expect(text).toContain('password: [stored credential]')
    expect(text).not.toContain('secret-value')
    expect(text).not.toContain('npm_1234567890abcdefghijkl')
    expect(text).not.toContain('sk-1234567890abcdefghijkl')
  })

  test('does not redact ordinary prose about passwords', () => {
    expect(
      redactSecretText('The password must be at least 16 characters.'),
    ).toBe('The password must be at least 16 characters.')
  })

  test('captures an SSH password before redacting user text', () => {
    const captured = new Map<string, string>()
    const messages = [
      {
        type: 'user',
        message: {
          role: 'user',
          content: 'ssh -p 17033 root@example.com 密码: transcript-password',
        },
      },
    ] as unknown as Message[]

    const redacted = redactTranscriptSecrets(messages, (host, port, password) =>
      captured.set(`${host}:${port}`, password),
    )
    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('transcript-password')
    expect(serialized).toContain('[stored credential]')
    expect(captured.get('root@example.com:17033')).toBe('transcript-password')
  })

  test('removes SSHRemote password fields from assistant tool calls', () => {
    const captured = new Map<string, string>()
    const messages = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'SSHRemote',
              input: {
                action: 'test',
                host: 'deploy@example.com',
                port: 2222,
                password: 'tool-password',
              },
            },
          ],
        },
      },
    ] as unknown as Message[]

    const redacted = redactTranscriptSecrets(messages, (host, port, password) =>
      captured.set(`${host}:${port}`, password),
    )
    const serialized = JSON.stringify(redacted)

    expect(serialized).not.toContain('tool-password')
    expect(serialized).toContain('[stored credential]')
    expect(captured.get('deploy@example.com:2222')).toBe('tool-password')
  })
})
