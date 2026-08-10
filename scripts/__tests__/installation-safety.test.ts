import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packagePath = fileURLToPath(
  new URL('../../package.json', import.meta.url),
)
const require = createRequire(import.meta.url)
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
  name: string
  bin: Record<string, string>
  scripts: Record<string, string>
}

describe('installation safety', () => {
  test('publishes under the sophiaagent package name', () => {
    expect(packageJson.name).toBe('sophiaagent')
  })

  test('default package installation has no setup lifecycle hook', () => {
    expect(packageJson.scripts.postinstall).toBeUndefined()
    expect(packageJson.scripts.preinstall).toBeUndefined()
    expect(packageJson.scripts.install).toBeUndefined()
    expect(packageJson.scripts.prepare).toBeUndefined()
  })

  test('optional ripgrep setup remains explicit', () => {
    expect(packageJson.scripts['setup:ripgrep']).toBe(
      'node scripts/postinstall.cjs',
    )
    expect(packageJson.scripts['setup:chrome']).toBeUndefined()
    expect(packageJson.scripts['setup:all']).toBeUndefined()
  })

  test('publishes only the sophia executable', () => {
    expect(packageJson.bin.sophia).toBe('dist/cli-bun.js')
    expect(Object.keys(packageJson.bin).sort()).toEqual(['sophia'])
  })

  test('loading the ripgrep setup module does not start a download', () => {
    const setup = require('../postinstall.cjs') as {
      downloadAndExtract: () => Promise<void>
      main: () => Promise<void>
    }
    expect(setup.downloadAndExtract).toBeFunction()
    expect(setup.main).toBeFunction()
  })
})
