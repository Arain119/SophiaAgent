/** Local builds do not upload session files to a cloud persistence service. */
import type { FilesPersistedEventData, TurnStartTime } from './types.js'

export async function runFilePersistence(
  _turnStartTime: TurnStartTime,
  _signal?: AbortSignal,
): Promise<FilesPersistedEventData | null> {
  return null
}

export async function executeFilePersistence(
  turnStartTime: TurnStartTime,
  signal: AbortSignal,
  onResult: (result: FilesPersistedEventData) => void,
): Promise<void> {
  const result = await runFilePersistence(turnStartTime, signal)
  if (result) onResult(result)
}

export function isFilePersistenceEnabled(): boolean {
  return false
}
