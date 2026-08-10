import { chmodSync, existsSync, rmSync } from 'node:fs'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBuildFeatures, getMacroDefines } from './scripts/defines.ts'

const outdir = 'dist'
rmSync(outdir, { recursive: true, force: true })

const features = getBuildFeatures()
console.log(
  `Building Sophia Core with ${features.length} compile-time feature.`,
)

const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'bun',
  splitting: false,
  sourcemap: 'linked',
  define: {
    ...getMacroDefines(),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  features,
  external: ['playwright-core'],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// Bun 1.3 emits the compile-time `bun:bundle` import as a bare `bundle`
// specifier when no features are enabled. Ship a tiny runtime fallback so
// the standalone CLI can start outside the build process as well.
const cliOutput = join(outdir, 'cli.js')
const cliSource = await readFile(cliOutput, 'utf8')
await writeFile(
  cliOutput,
  cliSource.replaceAll('from "bundle"', 'from "./bundle.js"'),
)
await writeFile(
  join(outdir, 'bundle.js'),
  'export function feature(_name) { return false }\n',
)

const ripgrepSource = 'src/utils/vendor/ripgrep'
if (existsSync(ripgrepSource)) {
  await cp(ripgrepSource, join(outdir, 'vendor', 'ripgrep'), {
    recursive: true,
  })
}

const launcher = join(outdir, 'cli-bun.js')
await writeFile(launcher, '#!/usr/bin/env bun\nimport "./cli.js"\n')
chmodSync(launcher, 0o755)

console.log(`Bundled ${result.outputs.length} files and generated ${launcher}.`)
