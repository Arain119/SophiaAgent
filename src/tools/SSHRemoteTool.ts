import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod/v4'
import type { ToolResultBlockParam } from '../Tool.js'
import { buildTool } from '../Tool.js'
import { lazySchema } from '../utils/lazySchema.js'
import { compactCommandDisplay } from '../utils/compactCommandDisplay.js'
import {
  getSshPassword,
  removeSshPassword,
  setSshPassword,
} from '../utils/sshCredentials.js'
import {
  clearSshConnectionContinuity,
  recordSshConnectionContinuity,
} from '../utils/sshConnectionContinuity.js'

const inputSchema = lazySchema(() =>
  z
    .strictObject({
      action: z
        .enum([
          'save',
          'list',
          'status',
          'execute',
          'test',
          'remove',
          'disconnect',
        ])
        .describe('Connection operation.'),
      name: z
        .string()
        .regex(/^[A-Za-z0-9._-]+$/)
        .max(64)
        .optional()
        .describe('Saved connection name.'),
      host: z
        .string()
        .min(1)
        .optional()
        .describe('SSH host, optionally in user@host form.'),
      command: z
        .string()
        .min(1)
        .optional()
        .describe('Shell command to execute on the remote host.'),
      cwd: z.string().optional().describe('Remote working directory.'),
      port: z.number().int().min(1).max(65535).optional().describe('SSH port.'),
      identityFile: z
        .string()
        .optional()
        .describe(
          'Path to a local private key file. The key contents never enter the model context.',
        ),
      password: z
        .string()
        .min(1)
        .max(4096)
        .refine(value => !/[\r\n]/.test(value), 'password must be one line')
        .optional()
        .describe(
          'SSH password supplied by the user. After successful authentication it is stored locally, reused across Sophia sessions, and never returned by the tool.',
        ),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe('Command timeout in milliseconds.'),
    })
    .superRefine((input, context) => {
      const needsName = input.action === 'save' || input.action === 'remove'
      if (needsName && !input.name) {
        context.addIssue({
          code: 'custom',
          message: `${input.action} requires name`,
          path: ['name'],
        })
      }
      if (input.action === 'save' && !input.host) {
        context.addIssue({
          code: 'custom',
          message: 'save requires host',
          path: ['host'],
        })
      }
      if (input.action === 'execute' && !input.command) {
        context.addIssue({
          code: 'custom',
          message: 'execute requires command',
          path: ['command'],
        })
      }
      if (
        ['execute', 'test', 'disconnect'].includes(input.action) &&
        !input.name &&
        !input.host
      ) {
        context.addIssue({
          code: 'custom',
          message: `${input.action} requires name or host`,
          path: ['name'],
        })
      }
    }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>
type Output = {
  stdout: string
  stderr: string
  exitCode: number
  retryDisposition?: 'safe' | 'unknown'
  nextRetryAt?: number
}
type Connection = {
  name?: string
  host: string
  port?: number
  identityFile?: string
  password?: string
}
type ConnectionLifecycleState = {
  state: 'disconnected' | 'connecting' | 'ready' | 'degraded' | 'blocked'
  host: string
  port: number
  lastSuccessAt?: number
  lastFailureAt?: number
  failureCount: number
  nextRetryAt?: number
  lastError?: string
}

const CONTROL_DIR = join(tmpdir(), 'sophia-agent-ssh')
const CONNECTIONS_FILE = join(homedir(), '.sophia', 'ssh', 'connections.json')
const connectionPaths = new Map<string, string>()
const sessionPasswords = new Map<string, string>()
const connectionStates = new Map<string, ConnectionLifecycleState>()
const connectionProbeTimers = new Map<string, ReturnType<typeof setTimeout>>()
const SSH_PROBE_BASE_DELAY_MS = 2 * 60 * 1000
const SSH_PROBE_MAX_DELAY_MS = 60 * 60 * 1000

export function getSshProbeRetryDelayMs(failureCount: number): number {
  const exponent = Math.max(0, Math.floor(failureCount) - 1)
  return Math.min(
    SSH_PROBE_BASE_DELAY_MS * 2 ** exponent,
    SSH_PROBE_MAX_DELAY_MS,
  )
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function sanitizeSshStderr(stderr: string): string {
  const lines = stderr.replaceAll('\r\n', '\n').split('\n')
  const kept: string[] = []
  let skippingWarning = false
  for (const line of lines) {
    if (
      /CryptographyDeprecationWarning:.*(?:TripleDES|Blowfish)/i.test(line) ||
      /TripleDES has been moved to cryptography\.hazmat\.decrepit/i.test(
        line,
      ) ||
      /Blowfish has been deprecated/i.test(line)
    ) {
      skippingWarning = true
      continue
    }
    if (
      skippingWarning &&
      /^\s*(?:warnings\.warn|from cryptography\.)/i.test(line)
    ) {
      continue
    }
    skippingWarning = false
    kept.push(line)
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseSshHost(value: string): { host: string; port?: number } {
  const trimmed = value.trim()
  const commandMatch = trimmed.match(/^ssh\s+(?:-p\s+(\d+)\s+)?([^\s]+)$/i)
  if (commandMatch) {
    return {
      host: commandMatch[2]!,
      ...(commandMatch[1] ? { port: Number(commandMatch[1]) } : {}),
    }
  }
  if (trimmed.startsWith('ssh://')) {
    const parsed = new URL(trimmed)
    return {
      host: parsed.username
        ? `${parsed.username}@${parsed.hostname}`
        : parsed.hostname,
      ...(parsed.port ? { port: Number(parsed.port) } : {}),
    }
  }
  return { host: trimmed }
}

async function readConnections(): Promise<Record<string, Connection>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(CONNECTIONS_FILE, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const connections: Record<string, Connection> = {}
    for (const [name, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const candidate = value as Record<string, unknown>
      if (typeof candidate.host !== 'string' || candidate.host.length === 0) {
        continue
      }
      connections[name] = {
        host: candidate.host,
        ...(typeof candidate.port === 'number' && { port: candidate.port }),
        ...(typeof candidate.identityFile === 'string' && {
          identityFile: candidate.identityFile,
        }),
      }
    }
    return connections
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function writeConnections(
  connections: Record<string, Connection>,
): Promise<void> {
  await mkdir(dirname(CONNECTIONS_FILE), { recursive: true })
  const temporaryFile = `${CONNECTIONS_FILE}.${process.pid}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(connections, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryFile, CONNECTIONS_FILE)
  await chmod(CONNECTIONS_FILE, 0o600).catch(() => {})
}

async function resolveConnection(input: Input): Promise<Connection> {
  const saved = input.name ? (await readConnections())[input.name] : undefined
  if (input.name && !saved) {
    throw new Error(`SSH connection "${input.name}" was not found`)
  }
  const rawHost = input.host ?? saved?.host
  if (!rawHost) throw new Error('SSH host is required')
  const parsedHost = parseSshHost(rawHost)
  const host = parsedHost.host
  const port = input.port ?? parsedHost.port ?? saved?.port
  const connection: Connection = {
    ...(input.name && { name: input.name }),
    host,
    port,
    identityFile: input.identityFile ?? saved?.identityFile,
    password:
      input.password ??
      sessionPasswords.get(passwordKey({ host, port })) ??
      getSshPassword(host, port ?? 22),
  }
  await recordSshConnectionContinuity({
    ...(input.name && { name: input.name }),
    host,
    port: port ?? 22,
    ...(connection.identityFile && { identityFile: connection.identityFile }),
  })
  return connection
}

function connectionKey(connection: Connection): string {
  return `${connection.host}\0${connection.port ?? 22}\0${connection.identityFile ?? join(homedir(), '.ssh', 'default')}`
}

function passwordKey(connection: Pick<Connection, 'host' | 'port'>): string {
  return `${connection.host}\0${connection.port ?? 22}`
}

function authenticationFailed(output: Output): boolean {
  return /permission denied|authentication failed|too many authentication failures/i.test(
    output.stderr,
  )
}

function connectionFailed(output: Output): boolean {
  return (
    output.exitCode !== 0 &&
    /connection (closed|refused|reset|timed out)|could not resolve|no route to host|broken pipe|control socket connect|ssh command timed out/i.test(
      `${output.stderr}\n${output.stdout}`,
    )
  )
}

export function isSshFailureSafeToReplay(message: string): boolean {
  return /connection refused|connection timed out|could not resolve|no route to host|control socket connect/i.test(
    message,
  )
}

function publicError(output: Output): string {
  return (
    output.stderr ||
    output.stdout ||
    `SSH exited with code ${output.exitCode}`
  )
    .trim()
    .slice(0, 500)
}

function updateConnectionState(
  connection: Connection,
  state: ConnectionLifecycleState['state'],
  output?: Output,
): void {
  const key = connectionKey(connection)
  const previous = connectionStates.get(key)
  const now = Date.now()
  const failed = state === 'degraded' || state === 'blocked'
  const failureCount = failed ? (previous?.failureCount ?? 0) + 1 : 0
  connectionStates.set(key, {
    state,
    host: connection.host,
    port: connection.port ?? 22,
    failureCount,
    lastSuccessAt: state === 'ready' ? now : previous?.lastSuccessAt,
    lastFailureAt: failed ? now : previous?.lastFailureAt,
    nextRetryAt:
      state === 'degraded'
        ? now + getSshProbeRetryDelayMs(failureCount)
        : undefined,
    lastError: failed && output ? publicError(output) : undefined,
  })
  if (state === 'ready' || state === 'disconnected' || state === 'blocked') {
    const timer = connectionProbeTimers.get(key)
    if (timer) clearTimeout(timer)
    connectionProbeTimers.delete(key)
  }
}

async function persistConnectionContinuity(
  connection: Connection,
  state: ConnectionLifecycleState['state'],
  cwd?: string,
): Promise<void> {
  const lifecycle = connectionStates.get(connectionKey(connection))
  await recordSshConnectionContinuity({
    ...(connection.name && { name: connection.name }),
    host: connection.host,
    port: connection.port ?? 22,
    ...(connection.identityFile && { identityFile: connection.identityFile }),
    ...(cwd && { cwd }),
    state,
    ...(lifecycle?.lastSuccessAt && {
      lastSuccessAt: lifecycle.lastSuccessAt,
    }),
    ...(lifecycle?.lastFailureAt && {
      lastFailureAt: lifecycle.lastFailureAt,
    }),
  })
}

function scheduleConnectionProbe(
  connection: Connection,
  controlPath: string,
): void {
  const key = connectionKey(connection)
  if (connectionProbeTimers.has(key)) return
  const state = connectionStates.get(key)
  const delayMs = Math.max(
    0,
    (state?.nextRetryAt ??
      Date.now() + getSshProbeRetryDelayMs(state?.failureCount ?? 1)) -
      Date.now(),
  )
  const timer = setTimeout(() => {
    connectionProbeTimers.delete(key)
    void (async () => {
      await unlink(controlPath).catch(() => {})
      const output = await spawnSsh(
        [...sshArgs(connection, controlPath), connection.host, 'true'],
        15_000,
        connection.password,
      ).catch(error => ({
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }))
      if (output.exitCode === 0) {
        connectionPaths.set(key, controlPath)
        updateConnectionState(connection, 'ready')
        await persistConnectionContinuity(connection, 'ready')
      } else if (authenticationFailed(output)) {
        updateConnectionState(connection, 'blocked', output)
        await persistConnectionContinuity(connection, 'blocked')
      } else {
        updateConnectionState(connection, 'degraded', output)
        await persistConnectionContinuity(connection, 'degraded')
        scheduleConnectionProbe(connection, controlPath)
      }
    })()
  }, delayMs)
  timer.unref?.()
  connectionProbeTimers.set(key, timer)
}

function formatConnectionState(state: ConnectionLifecycleState): string {
  return JSON.stringify({
    host: state.host,
    port: state.port,
    state: state.state,
    failureCount: state.failureCount,
    lastSuccessAt: state.lastSuccessAt
      ? new Date(state.lastSuccessAt).toISOString()
      : undefined,
    lastFailureAt: state.lastFailureAt
      ? new Date(state.lastFailureAt).toISOString()
      : undefined,
    nextRetryAt: state.nextRetryAt
      ? new Date(state.nextRetryAt).toISOString()
      : undefined,
    lastError: state.lastError,
  })
}

export function getSshControlArgs(
  controlPath: string,
  currentPlatform: NodeJS.Platform = platform(),
): string[] {
  // Windows OpenSSH does not implement Unix-domain ControlMaster sockets.
  // Passing these options connects successfully, then fails locally with
  // "getsockname failed: Not a socket" before returning command output.
  if (currentPlatform === 'win32') return []
  return [
    '-o',
    'ControlMaster=auto',
    '-o',
    'ControlPersist=300',
    '-o',
    `ControlPath=${controlPath}`,
  ]
}

function sshArgs(connection: Connection, controlPath: string): string[] {
  const args = [
    'ssh',
    '-o',
    `BatchMode=${connection.password ? 'no' : 'yes'}`,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=10',
    ...getSshControlArgs(controlPath),
  ]
  if (connection.port !== undefined) {
    args.push('-p', String(connection.port))
  }
  if (connection.identityFile !== undefined) {
    args.push('-i', connection.identityFile)
  }
  if (connection.password !== undefined) {
    args.push(
      '-o',
      'PreferredAuthentications=keyboard-interactive,password',
      '-o',
      'NumberOfPasswordPrompts=1',
    )
  }
  return args
}

async function spawnSsh(
  args: string[],
  timeoutMs: number,
  password?: string,
): Promise<Output> {
  let askpassPath: string | undefined
  if (password) {
    await mkdir(CONTROL_DIR, { recursive: true })
    const isWindows = platform() === 'win32'
    askpassPath = join(
      CONTROL_DIR,
      `askpass-${process.pid}-${crypto.randomUUID()}${isWindows ? '.cmd' : '.sh'}`,
    )
    const helper = isWindows
      ? '@echo off\r\npowershell.exe -NoProfile -NonInteractive -Command "[Console]::Out.Write($env:SOPHIA_SSH_PASSWORD)"\r\n'
      : '#!/bin/sh\nprintf "%s" "$SOPHIA_SSH_PASSWORD"\n'
    await writeFile(askpassPath, helper, {
      encoding: 'utf8',
      mode: 0o700,
    })
    await chmod(askpassPath, 0o700).catch(() => {})
  }
  const proc = Bun.spawn(args, {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    ...(password
      ? {
          env: {
            ...process.env,
            SSH_ASKPASS: askpassPath!,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: 'sophia',
            SOPHIA_SSH_PASSWORD: password,
          },
        }
      : {}),
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]).then(([stdout, stderr, exitCode]) => ({
        stdout,
        stderr: sanitizeSshStderr(stderr),
        exitCode,
      })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          proc.kill()
          reject(new Error(`SSH command timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (askpassPath)
      await Bun.file(askpassPath)
        .delete()
        .catch(() => {})
  }
}

async function runRemoteCommand(input: Input): Promise<Output> {
  const connection = await resolveConnection(input)
  await mkdir(CONTROL_DIR, { recursive: true })
  const key = connectionKey(connection)
  const controlPath =
    connectionPaths.get(key) ??
    join(
      CONTROL_DIR,
      createHash('sha256').update(key).digest('hex').slice(0, 32),
    )
  connectionPaths.set(key, controlPath)
  const args = sshArgs(connection, controlPath)
  const timeoutMs = input.timeoutMs ?? 120_000

  if (input.action === 'disconnect') {
    connectionPaths.delete(key)
    await unlink(controlPath).catch(() => {})
    const output =
      platform() === 'win32'
        ? {
            stdout: 'Cleared local SSH connection state.\n',
            stderr: '',
            exitCode: 0,
          }
        : await spawnSsh(
            [...args, '-O', 'exit', connection.host],
            Math.min(timeoutMs, 15_000),
            connection.password,
          )
    updateConnectionState(connection, 'disconnected')
    await persistConnectionContinuity(connection, 'disconnected')
    return output
  }

  const command = input.action === 'test' ? 'true' : input.command
  if (!command) throw new Error('SSH command is required')
  const remoteCommand = input.cwd
    ? `cd -- ${shellQuote(input.cwd)} && ${command}`
    : command
  updateConnectionState(connection, 'connecting')
  await persistConnectionContinuity(connection, 'connecting')
  let output: Output = await spawnSsh(
    [...args, connection.host, remoteCommand],
    timeoutMs,
    connection.password,
  ).catch(error => ({
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    exitCode: 1,
  }))
  const safeToReplay = isSshFailureSafeToReplay(
    `${output.stderr}\n${output.stdout}`,
  )
  if (connectionFailed(output) && (input.action === 'test' || safeToReplay)) {
    await unlink(controlPath).catch(() => {})
    for (const delayMs of [500, 1500]) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      output = await spawnSsh(
        [...args, connection.host, remoteCommand],
        timeoutMs,
        connection.password,
      )
      if (!connectionFailed(output)) break
      await unlink(controlPath).catch(() => {})
    }
  }
  if (input.password && !authenticationFailed(output)) {
    sessionPasswords.set(passwordKey(connection), input.password)
    const credentialError = setSshPassword(
      connection.host,
      connection.port ?? 22,
      input.password,
    )
    if (credentialError) {
      output.stderr = `${output.stderr}${output.stderr ? '\n' : ''}${credentialError.message}`
    }
  } else if (authenticationFailed(output) && connection.password) {
    sessionPasswords.delete(passwordKey(connection))
    removeSshPassword(connection.host, connection.port ?? 22)
  }
  if (output.exitCode === 0) {
    updateConnectionState(connection, 'ready')
    await persistConnectionContinuity(connection, 'ready', input.cwd)
  } else if (authenticationFailed(output)) {
    updateConnectionState(connection, 'blocked', output)
    await persistConnectionContinuity(connection, 'blocked')
  } else if (connectionFailed(output)) {
    connectionPaths.delete(key)
    await unlink(controlPath).catch(() => {})
    updateConnectionState(connection, 'degraded', output)
    scheduleConnectionProbe(connection, controlPath)
    const state = connectionStates.get(key)
    output.retryDisposition = safeToReplay ? 'safe' : 'unknown'
    output.nextRetryAt = state?.nextRetryAt
    await persistConnectionContinuity(connection, 'degraded')
  } else {
    // A non-zero remote command exit still proves the SSH transport is ready.
    updateConnectionState(connection, 'ready')
    await persistConnectionContinuity(connection, 'ready')
  }
  return output
}

async function call(input: Input): Promise<Output> {
  if (input.action === 'list') {
    const connections = await readConnections()
    const lines = Object.entries(connections).map(
      ([name, connection]) =>
        `${name}: ${connection.host}${connection.port ? `:${connection.port}` : ''}${connection.identityFile ? ` (key: ${connection.identityFile})` : ''}`,
    )
    return {
      stdout:
        lines.length > 0
          ? `${lines.join('\n')}\n`
          : 'No saved SSH connections.\n',
      stderr: '',
      exitCode: 0,
    }
  }

  if (input.action === 'status') {
    if (input.name || input.host) {
      const connection = await resolveConnection(input)
      const state = connectionStates.get(connectionKey(connection)) ?? {
        state: 'disconnected' as const,
        host: connection.host,
        port: connection.port ?? 22,
        failureCount: 0,
      }
      return {
        stdout: `${formatConnectionState(state)}\n`,
        stderr: '',
        exitCode: 0,
      }
    }
    const states = [...connectionStates.values()].map(formatConnectionState)
    return {
      stdout: states.length
        ? `${states.join('\n')}\n`
        : 'No active SSH connection state.\n',
      stderr: '',
      exitCode: 0,
    }
  }

  if (input.action === 'save') {
    const connections = await readConnections()
    const name = input.name!
    connections[name] = {
      host: input.host!,
      ...(input.port !== undefined && { port: input.port }),
      ...(input.identityFile !== undefined && {
        identityFile: input.identityFile,
      }),
    }
    await writeConnections(connections)
    const parsedHost = parseSshHost(input.host!)
    await recordSshConnectionContinuity({
      name,
      host: parsedHost.host,
      port: input.port ?? parsedHost.port ?? 22,
      ...(input.identityFile && { identityFile: input.identityFile }),
    })
    if (input.password) {
      const port = input.port ?? parsedHost.port ?? 22
      sessionPasswords.set(
        passwordKey({ host: parsedHost.host, port }),
        input.password,
      )
      const credentialError = setSshPassword(
        parsedHost.host,
        port,
        input.password,
      )
      if (credentialError) throw credentialError
    }
    return {
      stdout: `Saved SSH connection "${name}".\n`,
      stderr: '',
      exitCode: 0,
    }
  }

  if (input.action === 'remove') {
    const connections = await readConnections()
    const name = input.name!
    if (!connections[name]) {
      throw new Error(`SSH connection "${name}" was not found`)
    }
    const removed = connections[name]!
    delete connections[name]
    const parsedHost = parseSshHost(removed.host)
    sessionPasswords.delete(
      passwordKey({
        host: parsedHost.host,
        port: parsedHost.port ?? removed.port,
      }),
    )
    const credentialError = removeSshPassword(
      parsedHost.host,
      parsedHost.port ?? removed.port ?? 22,
    )
    if (credentialError) throw credentialError
    for (const [key, state] of connectionStates) {
      if (
        state.host === parsedHost.host &&
        state.port === (parsedHost.port ?? removed.port ?? 22)
      ) {
        connectionStates.delete(key)
        connectionPaths.delete(key)
        const timer = connectionProbeTimers.get(key)
        if (timer) clearTimeout(timer)
        connectionProbeTimers.delete(key)
      }
    }
    await writeConnections(connections)
    await clearSshConnectionContinuity(name)
    return {
      stdout: `Removed SSH connection "${name}".\n`,
      stderr: '',
      exitCode: 0,
    }
  }

  return runRemoteCommand(input)
}

export const SSHRemoteTool = buildTool({
  name: 'SSHRemote',
  maxResultSizeChars: 100_000,
  strict: true,
  get inputSchema(): ReturnType<typeof inputSchema> {
    return inputSchema()
  },
  async description() {
    return 'Save, reuse, inspect, and operate SSH connections with the local OpenSSH client.'
  },
  async prompt() {
    return 'Use SSHRemote automatically when the user provides an SSH host/URL and password. Extract user, host, port, command, and password from the same user message and call the tool directly; do not ask the user to re-enter them. Use the cwd field instead of embedding cd in command. Keep remote commands small and avoid nested SSH commands or heredocs when structured fields suffice. A successfully used password is stored in local credential storage and automatically reused across Sophia sessions; never repeat it in output. Save named connections for reusable targets, and prefer the local SSH agent or private-key path when available. Do not bypass SSHRemote by building a Paramiko, Python, sshpass, or shell-based password client; retry or report the SSHRemote error so credentials remain host-managed. A transient connection failure is not a reason to abandon a long task: continue independent local work and retry when the reported nextRetryAt is reached. If a write command reports an unknown execution outcome, inspect remote state before deciding whether to run it again.'
  },
  renderToolUseMessage(input: Partial<Input>) {
    const target = input.name ?? input.host ?? ''
    return `SSH ${input.action ?? ''} ${target}${input.command ? `: ${compactCommandDisplay(input.command)}` : ''}`.trim()
  },
  async call(input: Input) {
    try {
      return { data: await call(input) }
    } catch (error) {
      return {
        data: {
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        },
      }
    }
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input: Input) {
    if (
      input.action === 'list' ||
      input.action === 'status' ||
      input.action === 'test'
    )
      return true
    if (input.action !== 'execute' || !input.command) return false
    return /^(cat|cd|df|du|echo|env|find|git\s+(diff|log|status)|head|ls|pwd|stat|tail|uname|whoami|which|grep|rg|sed\s+-n)\b/i.test(
      input.command.trim(),
    )
  },
  isDestructive() {
    return true
  },
  mapToolResultToToolResultBlockParam(
    data: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    const parts = [`exit code: ${data.exitCode}`]
    if (data.stdout) parts.push(`stdout:\n${data.stdout}`)
    if (data.stderr) parts.push(`stderr:\n${data.stderr}`)
    if (data.retryDisposition) {
      parts.push(
        data.retryDisposition === 'safe'
          ? `retry: safe after ${data.nextRetryAt ? new Date(data.nextRetryAt).toISOString() : 'the connection recovers'}`
          : `retry: verify remote state before replay${data.nextRetryAt ? `; connection probe scheduled for ${new Date(data.nextRetryAt).toISOString()}` : ''}`,
      )
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: parts.join('\n\n'),
      is_error: data.exitCode !== 0,
    }
  },
})
