import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getSessionId } from '../bootstrap/state.js'
import { getSophiaConfigHomeDir } from './envUtils.js'
import { getSshPassword } from './sshCredentials.js'

export type SshConnectionContinuity = {
  sessionId: string
  name?: string
  host: string
  port: number
  identityFile?: string
  cwd?: string
  state?: 'disconnected' | 'connecting' | 'ready' | 'degraded' | 'blocked'
  lastSuccessAt?: number
  lastFailureAt?: number
  updatedAt: number
}

function getContinuityFile(): string {
  return join(
    getSophiaConfigHomeDir(),
    'ssh',
    'sessions',
    `${getSessionId()}.json`,
  )
}

export async function recordSshConnectionContinuity(
  connection: Omit<SshConnectionContinuity, 'sessionId' | 'updatedAt'>,
): Promise<void> {
  const continuityFile = getContinuityFile()
  const temporary = `${continuityFile}.${process.pid}.tmp`
  const current = await readSshConnectionContinuity()
  const sameTarget =
    current?.host === connection.host &&
    current.port === connection.port &&
    current.identityFile === connection.identityFile
  const preserved = sameTarget
    ? {
        ...(current.cwd && { cwd: current.cwd }),
        ...(current.state && { state: current.state }),
        ...(current.lastSuccessAt && { lastSuccessAt: current.lastSuccessAt }),
        ...(current.lastFailureAt && { lastFailureAt: current.lastFailureAt }),
      }
    : {}
  await mkdir(dirname(continuityFile), { recursive: true, mode: 0o700 })
  await writeFile(
    temporary,
    `${JSON.stringify({ ...preserved, ...connection, sessionId: getSessionId(), updatedAt: Date.now() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  await rename(temporary, continuityFile)
  await chmod(continuityFile, 0o600).catch(() => {})
}

export async function clearSshConnectionContinuity(
  name?: string,
): Promise<void> {
  if (name) {
    const current = await readSshConnectionContinuity()
    if (current?.name !== name) return
  }
  await unlink(getContinuityFile()).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
}

export async function readSshConnectionContinuity(): Promise<SshConnectionContinuity | null> {
  try {
    const value: unknown = JSON.parse(
      await readFile(getContinuityFile(), 'utf8'),
    )
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>
    if (
      typeof item.sessionId !== 'string' ||
      item.sessionId !== getSessionId() ||
      typeof item.host !== 'string' ||
      typeof item.port !== 'number' ||
      !Number.isInteger(item.port)
    ) {
      return null
    }
    return {
      sessionId: item.sessionId,
      host: item.host,
      port: item.port,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      ...(typeof item.name === 'string' && { name: item.name }),
      ...(typeof item.identityFile === 'string' && {
        identityFile: item.identityFile,
      }),
      ...(typeof item.cwd === 'string' && { cwd: item.cwd }),
      ...((item.state === 'disconnected' ||
        item.state === 'connecting' ||
        item.state === 'ready' ||
        item.state === 'degraded' ||
        item.state === 'blocked') && { state: item.state }),
      ...(typeof item.lastSuccessAt === 'number' && {
        lastSuccessAt: item.lastSuccessAt,
      }),
      ...(typeof item.lastFailureAt === 'number' && {
        lastFailureAt: item.lastFailureAt,
      }),
    }
  } catch {
    return null
  }
}

export function formatSshCompactContext(
  connection: SshConnectionContinuity,
  hasStoredCredential: boolean,
): string {
  const target = connection.name
    ? { name: connection.name }
    : { host: connection.host, port: connection.port }
  const metadata = {
    ...target,
    host: connection.host,
    port: connection.port,
    ...(connection.identityFile && { identityFile: connection.identityFile }),
    ...(connection.cwd && { cwd: connection.cwd }),
    ...(connection.state && { state: connection.state }),
    ...(connection.lastSuccessAt && {
      lastSuccessAt: new Date(connection.lastSuccessAt).toISOString(),
    }),
    ...(connection.lastFailureAt && {
      lastFailureAt: new Date(connection.lastFailureAt).toISOString(),
    }),
    hasStoredCredential,
  }
  const cwdInstruction = connection.cwd
    ? ` Preserve the remote working directory by passing cwd: ${JSON.stringify(connection.cwd)} unless the user explicitly changes it.`
    : ''
  return `<ssh_connection_context>
The most recently used SSH target is available after compaction.
Connection metadata: ${JSON.stringify(metadata)}
For the next SSH operation, call SSHRemote directly with ${JSON.stringify(target)} plus the requested action and command.${cwdInstruction} Do not call list or save first, and do not ask the user for the password when hasStoredCredential is true. The credential is resolved only by the host process and must never be included in tool input or output.
</ssh_connection_context>`
}

export async function getSshCompactContext(): Promise<string | null> {
  const connection = await readSshConnectionContinuity()
  if (!connection) return null
  return formatSshCompactContext(
    connection,
    getSshPassword(connection.host, connection.port) !== undefined,
  )
}
