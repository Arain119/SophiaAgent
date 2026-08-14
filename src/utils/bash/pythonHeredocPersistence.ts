import { createHash } from 'crypto'
import { chmod, mkdir, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { extractHeredocs } from './heredoc.js'

let pythonHeredocCount = 0

export type PythonHeredocRewrite = {
  command: string
  script?: { content: string; relativePath: string }
}

function quoteForBash(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function planPythonHeredocPersistence(
  command: string,
): PythonHeredocRewrite {
  const { heredocs } = extractHeredocs(command)
  if (heredocs.size !== 1) return { command }
  const info = [...heredocs.values()][0]!
  const prefix = command.slice(0, info.operatorStartIndex)
  const suffix = command.slice(info.contentEndIndex).trim()
  if (suffix) return { command }

  const invocation = prefix.match(
    /^\s*((?:"[^"]*python(?:3)?\.exe"|'[^']*python(?:3)?\.exe'|[\w./\\:-]*python(?:3)?(?:\.exe)?)\s+)-\s*$/i,
  )
  if (!invocation) return { command }

  const bodyWithDelimiter = command.slice(
    info.contentStartIndex + 1,
    info.contentEndIndex,
  )
  const lines = bodyWithDelimiter.split(/\r?\n/)
  if (lines.at(-1)?.trim() !== info.delimiter) return { command }
  const content = `${lines.slice(0, -1).join('\n')}\n`
  pythonHeredocCount++
  if (pythonHeredocCount === 1) return { command }

  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  const relativePath = `.sophia/experiments/python-${hash}.py`
  return {
    command: `${invocation[1]}${quoteForBash(relativePath)}`,
    script: { content, relativePath },
  }
}

export async function persistPlannedPythonHeredoc(
  projectRoot: string,
  plan: PythonHeredocRewrite,
): Promise<void> {
  if (!plan.script) return
  const path = join(projectRoot, plan.script.relativePath)
  const temporary = `${path}.${process.pid}.tmp`
  await mkdir(join(projectRoot, '.sophia', 'experiments'), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(temporary, plan.script.content, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

export function resetPythonHeredocPersistenceForTest(): void {
  pythonHeredocCount = 0
}
