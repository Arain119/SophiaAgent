import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findCachedVerification,
  recordPassedVerification,
} from '../verificationLedger.js'

let directory: string
let configDirectory: string
const originalConfigDir = process.env.SOPHIA_CONFIG_DIR

setDefaultTimeout(20_000)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sophia-verification-repo-'))
  configDirectory = await mkdtemp(join(tmpdir(), 'sophia-verification-home-'))
  process.env.SOPHIA_CONFIG_DIR = configDirectory
  execFileSync('git', ['init', '-q'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'sophia@example.test'], {
    cwd: directory,
  })
  execFileSync('git', ['config', 'user.name', 'Sophia Test'], {
    cwd: directory,
  })
  await writeFile(join(directory, 'source.ts'), 'export const value = 1\n')
  execFileSync('git', ['add', 'source.ts'], { cwd: directory })
  execFileSync('git', ['commit', '-qm', 'test'], { cwd: directory })
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.SOPHIA_CONFIG_DIR
  else process.env.SOPHIA_CONFIG_DIR = originalConfigDir
  await Promise.all([
    rm(directory, { recursive: true, force: true }),
    rm(configDirectory, { recursive: true, force: true }),
  ])
})

describe('verificationLedger', () => {
  test('reuses a passing verification against unchanged tracked state', () => {
    const command = 'bun run typecheck'
    recordPassedVerification(command, 'passed', directory)

    expect(findCachedVerification(command, directory)?.output).toBe('passed')
  })

  test('invalidates a result when tracked content changes', async () => {
    const command = 'bun test'
    recordPassedVerification(command, 'passed', directory)
    await writeFile(join(directory, 'source.ts'), 'export const value = 2\n')

    expect(findCachedVerification(command, directory)).toBeUndefined()
  })

  test('does not cache when untracked inputs exist', async () => {
    await writeFile(join(directory, 'fixture.json'), '{}\n')
    recordPassedVerification('pytest -q', 'passed', directory)

    expect(findCachedVerification('pytest -q', directory)).toBeUndefined()
  })

  test('ignores ordinary shell commands', () => {
    recordPassedVerification('git status --short', 'clean', directory)

    expect(
      findCachedVerification('git status --short', directory),
    ).toBeUndefined()
  })

  test('does not cache build commands that produce artifacts', () => {
    recordPassedVerification('bun run build', 'built', directory)

    expect(findCachedVerification('bun run build', directory)).toBeUndefined()
  })
})
