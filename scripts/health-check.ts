import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const requiredFiles = ['dist/cli.js', 'dist/cli-bun.js']
const missing = requiredFiles.filter(file => !existsSync(resolve(file)))
if (missing.length > 0) {
  console.error(`Missing build output: ${missing.join(', ')}`)
  process.exit(1)
}

const version = Bun.spawnSync(['bun', 'dist/cli-bun.js', '--version'], {
  stdout: 'pipe',
  stderr: 'pipe',
})
if (version.exitCode !== 0) {
  process.stderr.write(version.stderr)
  process.exit(version.exitCode)
}

const output = version.stdout.toString().trim()
const packageVersion = (
  (await Bun.file('package.json').json()) as { version?: unknown }
).version
if (typeof packageVersion !== 'string' || !output.startsWith(packageVersion)) {
  console.error(`Unexpected CLI version: ${output}`)
  process.exit(1)
}

console.log(`Sophia health check passed with Bun ${Bun.version} and ${output}.`)
