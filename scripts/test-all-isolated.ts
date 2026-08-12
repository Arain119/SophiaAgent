import { Glob } from 'bun'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const isolated = [
  'src/utils/__tests__/cacheSafeParamsSlot.test.ts',
  'src/utils/__tests__/messages.test.ts',
  'src/utils/__tests__/uuid.test.ts',
]

const glob = new Glob('**/*.test.{ts,tsx}')
const all = Array.from(
  glob.scanSync({
    cwd: root,
    onlyFiles: true,
  }),
)
  .map(path => path.replaceAll('\\', '/'))
  .filter(
    path => !path.startsWith('node_modules/') && !path.startsWith('dist/'),
  )
const isolatedSet = new Set(isolated)
const remaining = all.filter(path => !isolatedSet.has(path))

async function run(files: string[]): Promise<void> {
  const child = Bun.spawn(['bun', 'test', '--max-concurrency=1', ...files], {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
}

await run(isolated)
// Keep argv below Windows' process command-line limit while still isolating
// the known process-global mocks from the rest of the suite.
for (let i = 0; i < remaining.length; i += 50) {
  await run(remaining.slice(i, i + 50))
}
