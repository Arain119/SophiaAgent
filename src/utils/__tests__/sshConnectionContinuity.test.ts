import { describe, expect, test } from 'bun:test'
import { formatSshCompactContext } from '../sshConnectionContinuity.js'

describe('SSH connection continuity', () => {
  test('provides a deterministic named target after compaction', () => {
    const context = formatSshCompactContext(
      {
        sessionId: 'session-1',
        name: 'production',
        host: 'deploy@example.com',
        port: 2222,
        cwd: '/srv/app',
        state: 'ready',
        lastSuccessAt: 1,
        updatedAt: 1,
      },
      true,
    )
    expect(context).toContain('<ssh_connection_context>')
    expect(context).toContain('"name":"production"')
    expect(context).toContain('"hasStoredCredential":true')
    expect(context).toContain('"cwd":"/srv/app"')
    expect(context).toContain('"state":"ready"')
    expect(context).toContain('passing cwd: "/srv/app"')
    expect(context).toContain('Do not call list or save first')
    expect(context).not.toMatch(/"password"|secret-value/)
  })

  test('falls back to an explicit host and port for unnamed targets', () => {
    const context = formatSshCompactContext(
      {
        sessionId: 'session-1',
        host: 'root@example.com',
        port: 22,
        updatedAt: 1,
      },
      false,
    )
    expect(context).toContain('"host":"root@example.com"')
    expect(context).toContain('"port":22')
    expect(context).toContain('"hasStoredCredential":false')
  })

  test('exposes connection metadata without credential material', () => {
    const context = formatSshCompactContext(
      {
        sessionId: 'session-1',
        host: 'root@example.com',
        port: 38100,
        targetUrl: 'ssh://root@example.com:38100',
        username: 'root',
        identityFile: '~/.ssh/id_ed25519',
        authMethod: 'identity_file',
        credentialSource: 'session',
        credentialAvailable: true,
        updatedAt: 1,
      },
      false,
    )
    expect(context).toContain('"targetUrl":"ssh://root@example.com:38100"')
    expect(context).toContain('"username":"root"')
    expect(context).toContain('"authMethod":"identity_file"')
    expect(context).toContain('"credentialSource":"session"')
    expect(context).not.toContain('secret-value')
    expect(context).not.toContain('BEGIN OPENSSH PRIVATE KEY')
  })
})
