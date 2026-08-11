import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { getSessionId } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import { getSophiaConfigHomeDir } from './envUtils.js'

const MAX_CACHED_OUTPUT_CHARS = 20_000
const VERIFICATION_COMMAND =
  /(?:^|[;&|]\s*)(?:[^;&|]*?\s)?(?:pytest|ruff\s+check|tsc(?:\s|$)|biome\s+(?:check|lint)|eslint(?:\s|$)|cargo\s+test|go\s+test|bun\s+(?:run\s+)?(?:test|typecheck|lint|check)|npm\s+(?:test|run\s+(?:test|lint|typecheck|check)))(?:\s|$)/i

type VerificationRecord = {
  command: string
  repository: string
  fingerprint: string
  output: string
  passedAt: number
}

type VerificationLedger = {
  version: 1
  records: VerificationRecord[]
}

export type CachedVerification = {
  output: string
  passedAt: number
}

function ledgerPath(): string {
  return join(
    getSophiaConfigHomeDir(),
    'checkpoints',
    getSessionId(),
    'verification.json',
  )
}

function commandDirectory(command: string, fallback: string): string {
  const match = command.match(
    /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*&&/,
  )
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  if (!value) return fallback
  return isAbsolute(value) ? value : resolve(fallback, value)
}

function git(directory: string, args: string[]): string {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
  })
}

function repositoryState(
  command: string,
  fallbackDirectory = getCwd(),
): { repository: string; fingerprint: string } | undefined {
  if (!VERIFICATION_COMMAND.test(command)) return undefined
  try {
    const directory = commandDirectory(command, fallbackDirectory)
    const repository = git(directory, ['rev-parse', '--show-toplevel']).trim()
    const status = git(repository, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])
    if (status.split(/\r?\n/).some(line => line.startsWith('?? '))) {
      return undefined
    }
    const head = git(repository, ['rev-parse', 'HEAD']).trim()
    const diff = git(repository, ['diff', '--no-ext-diff', '--binary', 'HEAD'])
    const fingerprint = createHash('sha256')
      .update(head)
      .update('\0')
      .update(diff)
      .digest('hex')
    return { repository, fingerprint }
  } catch {
    return undefined
  }
}

function readLedger(): VerificationLedger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as
      | VerificationLedger
      | undefined
    if (parsed?.version === 1 && Array.isArray(parsed.records)) return parsed
  } catch {
    // A missing or partial cache is simply a cache miss.
  }
  return { version: 1, records: [] }
}

function writeLedger(ledger: VerificationLedger): void {
  const path = ledgerPath()
  const temporary = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    renameSync(temporary, path)
  } catch {
    // Verification still ran; failure to cache it must not fail the command.
  }
}

export function findCachedVerification(
  command: string,
  directory = getCwd(),
): CachedVerification | undefined {
  const state = repositoryState(command, directory)
  if (!state) return undefined
  const record = readLedger().records.find(
    item =>
      item.command === command &&
      item.repository === state.repository &&
      item.fingerprint === state.fingerprint,
  )
  return record
    ? { output: record.output, passedAt: record.passedAt }
    : undefined
}

export function recordPassedVerification(
  command: string,
  output: string,
  directory = getCwd(),
): void {
  const state = repositoryState(command, directory)
  if (!state) return
  const ledger = readLedger()
  ledger.records = ledger.records.filter(
    item => item.command !== command || item.repository !== state.repository,
  )
  ledger.records.push({
    command,
    repository: state.repository,
    fingerprint: state.fingerprint,
    output:
      output.length <= MAX_CACHED_OUTPUT_CHARS
        ? output
        : output.slice(-MAX_CACHED_OUTPUT_CHARS),
    passedAt: Date.now(),
  })
  writeLedger(ledger)
}

export function formatCachedVerification(cached: CachedVerification): string {
  const marker = `[Verification reused: the identical command already passed against the unchanged Git state at ${new Date(cached.passedAt).toISOString()}]`
  return cached.output ? `${cached.output.trimEnd()}\n${marker}` : marker
}
