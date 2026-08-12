import { Glob } from 'bun'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const coverageDir = join(root, 'coverage')
const partsDir = join(coverageDir, 'parts')
const isolated = [
  'src/utils/__tests__/cacheSafeParamsSlot.test.ts',
  'src/utils/__tests__/messages.test.ts',
  'src/utils/__tests__/uuid.test.ts',
]

const glob = new Glob('**/*.test.{ts,tsx}')
const all = Array.from(glob.scanSync({ cwd: root, onlyFiles: true }))
  .map(path => path.replaceAll('\\', '/'))
  .filter(
    path => !path.startsWith('node_modules/') && !path.startsWith('dist/'),
  )
const isolatedSet = new Set(isolated)
const remaining = all.filter(path => !isolatedSet.has(path))
const batches = isolated.map(path => [path])
for (const path of remaining) {
  batches.push([path])
}

await rm(coverageDir, { recursive: true, force: true })
await mkdir(partsDir, { recursive: true })

const reports: string[] = []
for (const [index, files] of batches.entries()) {
  const partName = String(index).padStart(3, '0')
  const partDir = join(partsDir, partName)
  const coverageArg = `coverage/parts/${partName}`
  await mkdir(partDir, { recursive: true })
  const child = Bun.spawn(
    [
      'bun',
      'test',
      '--max-concurrency=1',
      '--coverage',
      '--coverage-reporter',
      'lcov',
      '--coverage-dir',
      coverageArg,
      ...files,
    ],
    {
      cwd: root,
      stdin: 'inherit',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  const partPath = join(partDir, 'lcov.info')
  let info = await stat(partPath).catch(() => undefined)
  let recoveredWindowsReport = false
  if (!info?.isFile()) {
    // Bun 1.3.x can leave a complete temporary LCOV file behind when its
    // final atomic rename fails on Windows. Recover that exact report while
    // retaining the normal path on Linux CI.
    const temporaryReports = (await readdir(partDir)).filter(
      name => name.startsWith('.lcov.info.') && name.endsWith('.tmp'),
    )
    if (process.platform === 'win32' && temporaryReports.length === 1) {
      await rename(join(partDir, temporaryReports[0]), partPath)
      info = await stat(partPath)
      recoveredWindowsReport = true
    }
  }
  const output = `${stdout}\n${stderr}`
  const isOnlyWindowsReporterFailure =
    recoveredWindowsReport &&
    output.includes('EINVAL: Failed to save lcov.info file') &&
    !output.includes('(fail)') &&
    !output.includes('panic(') &&
    !output.includes('Bun has crashed')
  if (exitCode !== 0 && !isOnlyWindowsReporterFailure) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    console.error(
      `::error title=Coverage batch failed::${files.join(', ')} exited with code ${exitCode}`,
    )
    process.exit(exitCode)
  }
  if (!info?.isFile() || info.size === 0) {
    console.error(
      `::error title=Coverage report missing::${files.join(', ')} did not produce lcov.info`,
    )
    throw new Error(`Coverage batch ${index + 1} did not produce lcov.info`)
  }
  reports.push(await Bun.file(partPath).text())
  console.log(
    `✓ Coverage ${index + 1}/${batches.length} (${files.length} test file${files.length === 1 ? '' : 's'})`,
  )
}

const merged = reports.join('\n')
if (!merged.split('\n').some(line => line.startsWith('SF:'))) {
  throw new Error('Coverage report does not contain any source files')
}
const lcovPath = join(coverageDir, 'lcov.info')
await writeFile(lcovPath, merged, 'utf8')
const info = await stat(lcovPath)
console.log(
  `Coverage report verified (${info.size} bytes across ${batches.length} isolated batches).`,
)
