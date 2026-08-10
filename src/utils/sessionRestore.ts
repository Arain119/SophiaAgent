import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { dirname } from 'path'
import {
  getSessionId,
  setMainThreadAgentType,
  setOriginalCwd,
  switchSession,
} from '../bootstrap/state.js'
import { clearSystemPromptSections } from '../constants/systemPromptSections.js'
import { restoreCostStateForSession } from '../cost-tracker.js'
import type { AppState } from '../state/AppState.js'
import {
  enqueueAgentNotification,
  type LocalAgentTaskState,
} from '../tasks/LocalAgentTask/LocalAgentTask.js'
import { loadAgentCheckpoints } from '../tasks/LocalAgentTask/agentCheckpoint.js'
import {
  getTaskResultIndexPath,
  getTaskResultPath,
  loadLatestAgentRunLedgers,
  recordTerminalMemory,
  type AgentRunLedger,
} from '../tasks/LocalAgentTask/agentTerminalArtifacts.js'
import { closeWorkNode, openWorkNode } from '../tasks/workNodes.js'
import { getTaskOutputPath } from './task/diskOutput.js'
import type { AgentColorName } from '@sophia-agent/builtin-tools/tools/AgentTool/agentColorManager.js'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from '@sophia-agent/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { TODO_WRITE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TodoWriteTool/constants.js'
import { asSessionId } from '../types/ids.js'
import type {
  AttributionSnapshotMessage,
  PersistedWorktreeSession,
} from '../types/logs.js'
import type { Message } from '../types/message.js'
import { renameRecordingForSession } from './asciicast.js'
import { clearMemoryFileCaches } from './claudemd.js'
import {
  type AttributionState,
  attributionRestoreStateFromLog,
  restoreAttributionStateFromSnapshots,
} from './commitAttribution.js'
import { updateSessionName } from './concurrentSessions.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import type { FileHistorySnapshot } from './fileHistory.js'
import { fileHistoryRestoreStateFromLog } from './fileHistory.js'
import { getPlansDirectory } from './plans.js'
import { setCwd } from './Shell.js'
import {
  adoptResumedSessionFile,
  recordContentReplacement,
  resetSessionFilePointer,
  restoreSessionMetadata,
  saveWorktreeState,
} from './sessionStorage.js'
import { isTodoV2Enabled } from './tasks.js'
import type { TodoList } from './todo/types.js'
import { TodoListSchema } from './todo/types.js'
import type { ContentReplacementRecord } from './toolResultStorage.js'
import {
  getCurrentWorktreeSession,
  restoreWorktreeSession,
} from './worktree.js'

type ResumeResult = {
  messages?: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
}

/**
 * Scan the transcript for the last TodoWrite tool_use block and return its todos.
 * Used to hydrate AppState.todos on SDK --resume so the model's todo list
 * survives session restarts without file persistence.
 */
function extractTodosFromTranscript(messages: Message[]): TodoList {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type !== 'assistant') continue
    const toolUse = (msg.message!.content as any[]).find(
      block => block.type === 'tool_use' && block.name === TODO_WRITE_TOOL_NAME,
    )
    if (!toolUse || toolUse.type !== 'tool_use') continue
    const input = toolUse.input
    if (input === null || typeof input !== 'object') return []
    const parsed = TodoListSchema().safeParse(
      (input as Record<string, unknown>).todos,
    )
    return parsed.success ? parsed.data : []
  }
  return []
}

/**
 * Restore session state (file history, attribution, todos) from log on resume.
 * Used by both SDK (print.ts) and interactive (REPL.tsx, main.tsx) resume paths.
 */
export async function restoreSessionStateFromLog(
  result: ResumeResult,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<void> {
  // Restore file history state
  if (result.fileHistorySnapshots && result.fileHistorySnapshots.length > 0) {
    fileHistoryRestoreStateFromLog(result.fileHistorySnapshots, newState => {
      setAppState(prev => ({ ...prev, fileHistory: newState }))
    })
  }

  // Restore attribution state (ant-only feature)
  if (
    feature('COMMIT_ATTRIBUTION') &&
    result.attributionSnapshots &&
    result.attributionSnapshots.length > 0
  ) {
    attributionRestoreStateFromLog(result.attributionSnapshots, newState => {
      setAppState(prev => ({ ...prev, attribution: newState }))
    })
  }

  // Restore TodoWrite state from transcript (SDK/non-interactive only).
  // Interactive mode uses file-backed v2 tasks, so AppState.todos is unused there.
  if (!isTodoV2Enabled() && result.messages && result.messages.length > 0) {
    const todos = extractTodosFromTranscript(result.messages)
    if (todos.length > 0) {
      const agentId = getSessionId()
      setAppState(prev => ({
        ...prev,
        todos: { ...prev.todos, [agentId]: todos },
      }))
    }
  }

  const [ledgers, checkpoints] = await Promise.all([
    loadLatestAgentRunLedgers(),
    loadAgentCheckpoints(),
  ])
  const terminalTaskIds = new Set(
    ledgers
      .filter(ledger => ledger.status !== 'running')
      .map(ledger => ledger.taskId),
  )
  for (const checkpoint of checkpoints) {
    if (
      (checkpoint.status !== 'pending' && checkpoint.status !== 'running') ||
      terminalTaskIds.has(checkpoint.agentId)
    )
      continue
    ledgers.push({
      taskId: checkpoint.agentId,
      agentType: checkpoint.agentType,
      description: checkpoint.description,
      prompt: checkpoint.prompt,
      model: checkpoint.model,
      provider: checkpoint.provider,
      effort: checkpoint.effort,
      isExactContext: false,
      status: 'failed',
      startTime: checkpoint.startTime,
      endTime: checkpoint.updatedAt,
      durationMs: checkpoint.updatedAt - checkpoint.startTime,
      toolUses: checkpoint.toolUseCount,
      terminalMemory: {
        outcome:
          checkpoint.summary ??
          `Agent was interrupted while ${checkpoint.status}.`,
        decisions: [],
        evidence: checkpoint.lastActivity
          ? [`Last activity: ${checkpoint.lastActivity}`]
          : [],
        verification: [],
        remainingWork: checkpoint.remainingWork ?? [
          'Resume this agent from its checkpoint.',
        ],
      },
    })
  }
  restoreAgentTasksFromLedgers(ledgers, setAppState)
}

export function restoreAgentTasksFromLedgers(
  ledgers: AgentRunLedger[],
  setAppState: (f: (prev: AppState) => AppState) => void,
): number {
  const restoredTasks = new Map<string, LocalAgentTaskState>()
  for (const ledger of ledgers) {
    if (ledger.status === 'running') continue
    const terminalStatus = ledger.status
    if (ledger.terminalMemory) {
      recordTerminalMemory(ledger.taskId, ledger.terminalMemory)
      openWorkNode({
        id: ledger.taskId,
        parentId: ledger.parentId,
        toolUseId: ledger.toolUseId,
        goal: ledger.description,
        owner: ledger.agentType,
      })
      closeWorkNode(ledger.taskId, terminalStatus, ledger.terminalMemory)
    }
    const task: LocalAgentTaskState = {
      id: ledger.taskId,
      type: 'local_agent',
      status: terminalStatus,
      description: ledger.description,
      startTime: ledger.startTime,
      endTime: ledger.endTime,
      outputFile: getTaskOutputPath(ledger.taskId),
      outputOffset: 0,
      notified: ledger.consumedAt !== undefined,
      agentId: ledger.taskId,
      prompt: ledger.prompt ?? ledger.description,
      agentType: ledger.agentType,
      model: ledger.model,
      provider: ledger.provider,
      effort: ledger.effort,
      isExactContext: ledger.isExactContext,
      runLedger: ledger,
      terminalMemory: ledger.terminalMemory,
      resultFile: ledger.resultFile ?? getTaskResultPath(ledger.taskId),
      resultIndexFile:
        ledger.resultIndexFile ?? getTaskResultIndexPath(ledger.taskId),
      consumedAt: ledger.consumedAt,
      notificationQueued: false,
      error:
        ledger.status === 'failed'
          ? (ledger.terminalMemory?.outcome ?? 'Agent task failed')
          : undefined,
      retrieved: ledger.consumedAt !== undefined,
      lastReportedToolCount: ledger.toolUses ?? 0,
      lastReportedTokenCount:
        (ledger.inputTokens ?? 0) + (ledger.outputTokens ?? 0),
      isBackgrounded: true,
      pendingMessages: [],
      retain: false,
      diskLoaded: false,
    }
    restoredTasks.set(task.id, task)
  }
  if (restoredTasks.size === 0) return 0
  setAppState(prev => ({
    ...prev,
    tasks: { ...prev.tasks, ...Object.fromEntries(restoredTasks) },
  }))
  for (const task of restoredTasks.values()) {
    if (task.consumedAt !== undefined) continue
    if (task.status === 'running' || task.status === 'pending') continue
    enqueueAgentNotification({
      taskId: task.id,
      status: task.status,
      description: task.description,
      finalMessage: task.terminalMemory?.outcome,
      error: task.error,
      setAppState,
    })
  }
  return restoredTasks.size
}

/**
 * Compute restored attribution state from log snapshots.
 * Used for computing initial state before render (e.g., main.tsx --continue).
 * Returns undefined if attribution feature is disabled or no snapshots exist.
 */
export function computeRestoredAttributionState(
  result: ResumeResult,
): AttributionState | undefined {
  if (
    feature('COMMIT_ATTRIBUTION') &&
    result.attributionSnapshots &&
    result.attributionSnapshots.length > 0
  ) {
    return restoreAttributionStateFromSnapshots(result.attributionSnapshots)
  }
  return undefined
}

/**
 * Compute standalone agent context (name/color) for session resume.
 * Used for computing initial state before render (per SOPHIA.md guidelines).
 * Returns undefined if no name/color is set on the session.
 */
export function computeStandaloneAgentContext(
  agentName: string | undefined,
  agentColor: string | undefined,
): AppState['standaloneAgentContext'] | undefined {
  if (!agentName && !agentColor) {
    return undefined
  }
  return {
    name: agentName ?? '',
    color: (agentColor === 'default' ? undefined : agentColor) as
      | AgentColorName
      | undefined,
  }
}

/**
 * Restore agent setting from a resumed session.
 *
 * When resuming a conversation that used a custom agent, this re-applies the
 * agent type unless the user specified --agent on the CLI.
 * Mutates bootstrap state via setMainThreadAgentType.
 *
 * Returns the restored agent definition and its agentType string, or undefined
 * if no agent was restored.
 */
export function restoreAgentFromSession(
  agentSetting: string | undefined,
  currentAgentDefinition: AgentDefinition | undefined,
  agentDefinitions: AgentDefinitionsResult,
): {
  agentDefinition: AgentDefinition | undefined
  agentType: string | undefined
} {
  // If user already specified --agent on CLI, keep that definition
  if (currentAgentDefinition) {
    return { agentDefinition: currentAgentDefinition, agentType: undefined }
  }

  // If session had no agent, clear any stale bootstrap state
  if (!agentSetting) {
    setMainThreadAgentType(undefined)
    return { agentDefinition: undefined, agentType: undefined }
  }

  const resumedAgent = agentDefinitions.activeAgents.find(
    agent => agent.agentType === agentSetting,
  )
  if (!resumedAgent) {
    logForDebugging(
      `Resumed session had agent "${agentSetting}" but it is no longer available. Using default behavior.`,
    )
    setMainThreadAgentType(undefined)
    return { agentDefinition: undefined, agentType: undefined }
  }

  setMainThreadAgentType(resumedAgent.agentType)

  return { agentDefinition: resumedAgent, agentType: resumedAgent.agentType }
}

/**
 * Result of processing a resumed/continued conversation for rendering.
 */
export type ProcessedResume = {
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  contentReplacements?: ContentReplacementRecord[]
  agentName: string | undefined
  agentColor: AgentColorName | undefined
  restoredAgentDef: AgentDefinition | undefined
  initialState: AppState
}

/**
 * The loaded conversation data (return type of loadConversationForResume).
 */
type ResumeLoadResult = {
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  sessionId: UUID | undefined
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  tag?: string
  worktreeSession?: PersistedWorktreeSession | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
}

/**
 * Restore the worktree working directory on resume. The transcript records
 * the last worktree enter/exit; if the session crashed while inside a
 * worktree (last entry = session object, not null), cd back into it.
 *
 * process.chdir is the TOCTOU-safe existence check — it throws ENOENT if
 * the /exit dialog removed the directory, or if the user deleted it
 * manually between sessions.
 *
 * When --worktree already created a fresh worktree, that takes precedence
 * over the resumed session's state. restoreSessionMetadata just overwrote
 * project.currentSessionWorktree with the stale transcript value, so
 * re-assert the fresh worktree here before adoptResumedSessionFile writes
 * it back to disk.
 */
export function restoreWorktreeForResume(
  worktreeSession: PersistedWorktreeSession | null | undefined,
): void {
  const fresh = getCurrentWorktreeSession()
  if (fresh) {
    saveWorktreeState(fresh)
    return
  }
  if (!worktreeSession) return

  try {
    process.chdir(worktreeSession.worktreePath)
  } catch {
    // Directory is gone. Override the stale cache so the next
    // reAppendSessionMetadata records "exited" instead of re-persisting
    // a path that no longer exists.
    saveWorktreeState(null)
    return
  }

  setCwd(worktreeSession.worktreePath)
  setOriginalCwd(getCwd())
  // projectRoot is intentionally NOT set here. The transcript doesn't record
  // whether the worktree was entered via --worktree (which sets projectRoot)
  // or EnterWorktreeTool (which doesn't). Leaving projectRoot stable matches
  // EnterWorktreeTool's behavior — skills/history stay anchored to the
  // original project.
  restoreWorktreeSession(worktreeSession)
  // The /resume slash command calls this mid-session after caches have been
  // populated against the old cwd. Cheap no-ops for the CLI-flag path
  // (caches aren't populated yet there).
  clearMemoryFileCaches()
  clearSystemPromptSections()
  getPlansDirectory.cache.clear?.()
}

/**
 * Undo restoreWorktreeForResume before a mid-session /resume switches to
 * another session. Without this, /resume from a worktree session to a
 * non-worktree session leaves the user in the old worktree directory with
 * currentWorktreeSession still pointing at the prior session. /resume to a
 * *different* worktree fails entirely — the getCurrentWorktreeSession()
 * guard above blocks the switch.
 *
 * Not needed by CLI --resume/--continue: those run once at startup where
 * getCurrentWorktreeSession() is only truthy if --worktree was used (fresh
 * worktree that should take precedence, handled by the re-assert above).
 */
export function exitRestoredWorktree(): void {
  const current = getCurrentWorktreeSession()
  if (!current) return

  restoreWorktreeSession(null)
  // Worktree state changed, so cached prompt sections that reference it are
  // stale whether or not chdir succeeds below.
  clearMemoryFileCaches()
  clearSystemPromptSections()
  getPlansDirectory.cache.clear?.()

  try {
    process.chdir(current.originalCwd)
  } catch {
    // Original dir is gone (rare). Stay put — restoreWorktreeForResume
    // will cd into the target worktree next if there is one.
    return
  }
  setCwd(current.originalCwd)
  setOriginalCwd(getCwd())
}

/**
 * Process a loaded conversation for resume/continue.
 *
 * Handles session ID setup, agent restoration, and initial state computation.
 * Called by both --continue and --resume paths in main.tsx.
 */
export async function processResumedConversation(
  result: ResumeLoadResult,
  opts: {
    forkSession: boolean
    sessionIdOverride?: string
    transcriptPath?: string
    includeAttribution?: boolean
  },
  context: {
    mainThreadAgentDefinition: AgentDefinition | undefined
    agentDefinitions: AgentDefinitionsResult
    initialState: AppState
  },
): Promise<ProcessedResume> {
  // Reuse the resumed session's ID unless --fork-session is specified
  if (!opts.forkSession) {
    const sid = opts.sessionIdOverride ?? result.sessionId
    if (sid) {
      // When resuming from a different project directory (git worktrees,
      // cross-project), transcriptPath points to the actual file; its dirname
      // is the project dir. Otherwise the session lives in the current project.
      switchSession(
        asSessionId(sid),
        opts.transcriptPath ? dirname(opts.transcriptPath) : null,
      )
      // Rename asciicast recording to match the resumed session ID so
      // getSessionRecordingPaths() can discover it during /share
      await renameRecordingForSession()
      await resetSessionFilePointer()
      restoreCostStateForSession(sid)
    }
  } else if (result.contentReplacements?.length) {
    // --fork-session keeps the fresh startup session ID. useLogMessages will
    // copy source messages into the new JSONL via recordTranscript, but
    // content-replacement entries are a separate entry type only written by
    // recordContentReplacement (which query.ts calls for newlyReplaced, never
    // the pre-loaded records). Without this seed, `sophia -r {newSessionId}`
    // finds source tool_use_ids in messages but no matching replacement records
    // → they're classified as FROZEN → full content sent (cache miss, permanent
    // overage). insertContentReplacement stamps sessionId = getSessionId() =
    // the fresh ID, so loadTranscriptFile's keyed lookup will match.
    await recordContentReplacement(result.contentReplacements)
  }

  // Restore session metadata so /status shows the saved name and metadata
  // is re-appended on session exit. Fork doesn't take ownership of the
  // original session's worktree — a "Remove" on the fork's exit dialog
  // would delete a worktree the original session still references — so
  // strip worktreeSession from the fork path so the cache stays unset.
  restoreSessionMetadata(
    opts.forkSession ? { ...result, worktreeSession: undefined } : result,
  )

  if (!opts.forkSession) {
    // Cd back into the worktree the session was in when it last exited.
    // Done after restoreSessionMetadata (which caches the worktree state
    // from the transcript) so if the directory is gone we can override
    // the cache before adoptResumedSessionFile writes it.
    restoreWorktreeForResume(result.worktreeSession)

    // Point sessionFile at the resumed transcript and re-append metadata
    // now. resetSessionFilePointer above nulled it (so the old fresh-session
    // path doesn't leak), but that blocks reAppendSessionMetadata — which
    // bails on null — from running in the exit cleanup handler. For fork,
    // useLogMessages populates a *new* file via recordTranscript on REPL
    // mount; the normal lazy-materialize path is correct there.
    adoptResumedSessionFile()
  }

  // Restore agent setting from resumed session
  const { agentDefinition: restoredAgent, agentType: resumedAgentType } =
    restoreAgentFromSession(
      result.agentSetting,
      context.mainThreadAgentDefinition,
      context.agentDefinitions,
    )

  // Compute initial state before render (per SOPHIA.md guidelines)
  const restoredAttribution = opts.includeAttribution
    ? computeRestoredAttributionState(result)
    : undefined
  const standaloneAgentContext = computeStandaloneAgentContext(
    result.agentName,
    result.agentColor,
  )
  void updateSessionName(result.agentName)
  return {
    messages: result.messages,
    fileHistorySnapshots: result.fileHistorySnapshots,
    contentReplacements: result.contentReplacements,
    agentName: result.agentName,
    agentColor: (result.agentColor === 'default'
      ? undefined
      : result.agentColor) as AgentColorName | undefined,
    restoredAgentDef: restoredAgent,
    initialState: {
      ...context.initialState,
      ...(resumedAgentType && { agent: resumedAgentType }),
      ...(restoredAttribution && { attribution: restoredAttribution }),
      ...(standaloneAgentContext && { standaloneAgentContext }),
      agentDefinitions: context.agentDefinitions,
    },
  }
}
