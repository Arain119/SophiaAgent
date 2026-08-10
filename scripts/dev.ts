#!/usr/bin/env bun
/**
 * Dev entrypoint — launches cli.tsx with MACRO.* defines injected
 * via Bun's -d flag (bunfig.toml [define] doesn't propagate to
 * dynamically imported modules at runtime).
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBuildFeatures, getMacroDefines } from './defines.ts'

// Resolve project root from this script's location
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')
const cliPath = join(projectRoot, 'src/entrypoints/cli.tsx')

const defines = {
  ...getMacroDefines(),
  // React production mode — prevents 6,889+ _debugStack Error objects
  // (12MB) from accumulating during long-running sessions.
  // dev 模式使用 development 模式
  'process.env.NODE_ENV': JSON.stringify('production'),
}

const defineArgs = Object.entries(defines).flatMap(([k, v]) => [
  '-d',
  `${k}:${v}`,
])

// Bun --feature flags are resolved from the closed Core feature set.
const allFeatures = getBuildFeatures()
const featureArgs = allFeatures.flatMap(name => ['--feature', name])
const cliArgs = process.argv.slice(2)

// If BUN_INSPECT is set, pass --inspect-wait to the child process
const inspectArgs = process.env.BUN_INSPECT
  ? ['--inspect-wait=' + process.env.BUN_INSPECT]
  : []

const result = Bun.spawnSync(
  [
    'bun',
    ...inspectArgs,
    'run',
    ...defineArgs,
    ...featureArgs,
    cliPath,
    ...cliArgs,
  ],
  { stdio: ['inherit', 'inherit', 'inherit'], cwd: projectRoot },
)

process.exit(result.exitCode ?? 0)
