import { chmod, mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  onSessionSwitch,
} from '../bootstrap/state.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getSophiaConfigHomeDir } from './envUtils.js'
import { errorMessage, isFsInaccessible } from './errors.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { getPlatform } from './platform.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { getAgentId } from './teammate.js'

function getSessionsDir(): string {
  return join(getSophiaConfigHomeDir(), 'sessions')
}

/**
 * Register a top-level session for local peer discovery.
 * Teammates and subagents coordinate through the task system instead.
 */
export async function registerSession(): Promise<boolean> {
  if (getAgentId() != null) return false

  const dir = getSessionsDir()
  const pidFile = join(dir, `${process.pid}.json`)

  registerCleanup(async () => {
    try {
      await unlink(pidFile)
    } catch {
      // The file may already be gone after a crash cleanup.
    }
  })

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    await writeFile(
      pidFile,
      jsonStringify({
        pid: process.pid,
        sessionId: getSessionId(),
        cwd: getOriginalCwd(),
        startedAt: Date.now(),
        entrypoint: process.env.SOPHIA_ENTRYPOINT,
        messagingSocketPath: process.env.SOPHIA_MESSAGING_SOCKET,
      }),
    )
    onSessionSwitch(id => {
      void updatePidFile({ sessionId: id })
    })
    return true
  } catch (error) {
    logForDebugging(
      `[concurrentSessions] register failed: ${errorMessage(error)}`,
    )
    return false
  }
}

async function updatePidFile(patch: Record<string, unknown>): Promise<void> {
  const pidFile = join(getSessionsDir(), `${process.pid}.json`)
  try {
    const data = jsonParse(await readFile(pidFile, 'utf8')) as Record<
      string,
      unknown
    >
    await writeFile(pidFile, jsonStringify({ ...data, ...patch }))
  } catch (error) {
    logForDebugging(
      `[concurrentSessions] updatePidFile failed: ${errorMessage(error)}`,
    )
  }
}

export async function updateSessionName(
  name: string | undefined,
): Promise<void> {
  if (!name) return
  await updatePidFile({ name })
}

/** Count live top-level sessions and remove stale registry files. */
export async function countConcurrentSessions(): Promise<number> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (error) {
    if (!isFsInaccessible(error)) {
      logForDebugging(
        `[concurrentSessions] readdir failed: ${errorMessage(error)}`,
      )
    }
    return 0
  }

  let count = 0
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (pid === process.pid || isProcessRunning(pid)) {
      count++
    } else if (getPlatform() !== 'wsl') {
      void unlink(join(dir, file)).catch(() => {})
    }
  }
  return count
}
