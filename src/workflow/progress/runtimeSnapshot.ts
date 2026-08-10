import type { RunProgress } from './store.js'

let readRuns: (() => RunProgress[]) | null = null

/** Register the live workflow progress source without coupling query.ts to the workflow service. */
export function registerWorkflowRunSnapshotReader(
  reader: () => RunProgress[],
): void {
  readRuns = reader
}

export function getWorkflowRunSnapshots(): RunProgress[] {
  return readRuns?.() ?? []
}

export function clearWorkflowRunSnapshotReader(): void {
  readRuns = null
}
