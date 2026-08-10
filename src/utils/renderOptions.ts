import { openSync } from 'fs'
import { ReadStream, WriteStream } from 'tty'
import type { RenderOptions } from '@anthropic/ink'
import { isEnvTruthy } from './envUtils.js'
import { logError } from './log.js'

let cachedStdinOverride: ReadStream | undefined | null = null
let cachedStdoutOverride: WriteStream | undefined | null = null

function canUseConsoleOverride(): boolean {
  return !isEnvTruthy(process.env.CI) && !process.argv.includes('mcp')
}

/**
 * Gets a real terminal input stream when stdin is piped.
 * PowerShell npm shims can pipe stdin even when a console is attached.
 */
function getStdinOverride(): ReadStream | undefined {
  if (cachedStdinOverride !== null) {
    return cachedStdinOverride
  }

  if (process.stdin.isTTY) {
    cachedStdinOverride = undefined
    return undefined
  }

  if (!canUseConsoleOverride()) {
    cachedStdinOverride = undefined
    return undefined
  }

  if (process.platform === 'win32') {
    try {
      const ttyFd = openSync('\\\\.\\CONIN$', 'r')
      cachedStdinOverride = new ReadStream(ttyFd)
      return cachedStdinOverride
    } catch (err) {
      logError(err as Error)
      cachedStdinOverride = undefined
      return undefined
    }
  }

  try {
    const ttyFd = openSync('/dev/tty', 'r')
    const ttyStream = new ReadStream(ttyFd)
    ttyStream.isTTY = true
    cachedStdinOverride = ttyStream
    return cachedStdinOverride
  } catch (err) {
    logError(err as Error)
    cachedStdinOverride = undefined
    return undefined
  }
}

function getStdoutOverride(): WriteStream | undefined {
  if (cachedStdoutOverride !== null) {
    return cachedStdoutOverride
  }

  if (
    process.platform !== 'win32' ||
    process.stdout.isTTY ||
    !canUseConsoleOverride()
  ) {
    cachedStdoutOverride = undefined
    return undefined
  }

  try {
    const consoleFd = openSync('\\\\.\\CONOUT$', 'w')
    cachedStdoutOverride = new WriteStream(consoleFd)
    return cachedStdoutOverride
  } catch (err) {
    logError(err as Error)
    cachedStdoutOverride = undefined
    return undefined
  }
}

/**
 * Returns base render options for Ink, including terminal stream overrides.
 */
export function getBaseRenderOptions(
  exitOnCtrlC: boolean = false,
): RenderOptions {
  const stdin = getStdinOverride()
  const stdout = getStdoutOverride()
  if (
    process.platform === 'win32' &&
    !process.stdin.isTTY &&
    !stdin &&
    !isEnvTruthy(process.env.CI) &&
    !process.argv.includes('mcp')
  ) {
    throw new Error(
      'Sophia interactive mode could not access the Windows console. ' +
        'Run sophia directly in PowerShell or use sophia -p "<prompt>" ' +
        'for non-interactive mode.',
    )
  }
  if (stdout) {
    return {
      exitOnCtrlC,
      stdin: stdin ?? process.stdin,
      stdout,
      stderr: stdout,
    }
  }
  return stdin ? { exitOnCtrlC, stdin } : { exitOnCtrlC }
}
