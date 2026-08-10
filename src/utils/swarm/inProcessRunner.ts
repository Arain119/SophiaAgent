/**
 * In-process teammate runner
 *
 * Wraps runAgent() for in-process teammates, providing:
 * - AsyncLocalStorage-based context isolation via runWithTeammateContext()
 * - Progress tracking and AppState updates
 * - Idle notification to leader when complete
 * - Plan mode approval flow support
 * - Cleanup on completion or abort
 */

import { getSystemPrompt } from '../../constants/prompts.js'
import { TEAMMATE_MESSAGE_TAG } from '../../constants/xml.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getAutoCompactThreshold } from '../../services/compact/autoCompact.js'
import {
  buildPostCompactMessages,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
} from '../../services/compact/compact.js'
import { resetMicrocompactState } from '../../services/compact/microCompact.js'
import type { AppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import { appendTeammateMessage } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import type {
  InProcessTeammateTaskState,
  TeammateIdentity,
} from '../../tasks/InProcessTeammateTask/types.js'
import { appendCappedMessage } from '../../tasks/InProcessTeammateTask/types.js'
import {
  createActivityDescriptionResolver,
  createProgressTracker,
  getProgressUpdate,
  updateProgressFromMessage,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { CustomAgentDefinition } from '@sophia-agent/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { runAgent } from '@sophia-agent/builtin-tools/tools/AgentTool/runAgent.js'
import type { AgentToolResult } from '@sophia-agent/builtin-tools/tools/AgentTool/agentToolUtils.js'
import { SEND_MESSAGE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/SendMessageTool/constants.js'
import { TASK_CREATE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskCreateTool/constants.js'
import { TASK_GET_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskGetTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TaskUpdateTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/TeamDeleteTool/constants.js'
import type { Message } from '../../types/message.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { evictTaskOutput } from '../../utils/task/diskOutput.js'
import { evictTerminalTask } from '../../utils/task/framework.js'
import {
  tokenCountWithEstimation,
  getTokenCountFromUsage,
} from '../../utils/tokens.js'
import { createAbortController } from '../abortController.js'
import { type AgentContext, runWithAgentContext } from '../agentContext.js'
import {
  markAutonomyRunCompleted,
  markAutonomyRunFailed,
  markAutonomyRunRunning,
} from '../autonomyRuns.js'
import { count } from '../array.js'
import { logForDebugging } from '../debug.js'
import { cloneFileStateCache } from '../fileStateCache.js'
import { applyFixedSafetyPolicy } from '../safety/fixedSafetyPolicy.js'
import { evaluateToolSafety } from '../safety/toolSafety.js'
import { emitTaskTerminatedSdk } from '../sdkEventQueue.js'
import { sleep } from '../sleep.js'
import { jsonStringify } from '../slowOperations.js'
import { asSystemPrompt } from '../systemPromptType.js'
import { claimTask, listTasks, type Task, updateTask } from '../tasks.js'
import type { TeammateContext } from '../teammateContext.js'
import { runWithTeammateContext } from '../teammateContext.js'
import {
  createIdleNotification,
  getLastPeerDmSummary,
  isShutdownRequest,
  markMessageAsReadByIdentity,
  readMailbox,
  writeToMailbox,
} from '../teammateMailbox.js'
import { unregisterAgent as unregisterPerfettoAgent } from '../telemetry/perfettoTracing.js'
import { createContentReplacementState } from '../toolResultStorage.js'
import { TEAM_LEAD_NAME } from './constants.js'
import { TEAMMATE_SYSTEM_PROMPT_ADDENDUM } from './teammatePromptAddendum.js'

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void

/**
 * Creates a canUseTool function for in-process teammates that properly resolves
 * 'ask' permissions via the UI rather than treating them as denials.
 *
 * Always uses the leader's ToolUseConfirm dialog with a worker badge when
 * the bridge is available, giving teammates the same tool-specific UI
 * (BashPermissionRequest, FileEditToolDiff, etc.) as the leader's own tools.
 *
 * Falls back to the mailbox system when the bridge is unavailable:
 * sends a permission request to the leader's inbox, waits for the response
 * in the teammate's own mailbox.
 */
function createInProcessCanUseTool(): CanUseToolFn {
  return async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseID,
    forceDecision,
  ) => {
    const decision =
      forceDecision ??
      (await evaluateToolSafety(
        tool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseID,
      ))
    return applyFixedSafetyPolicy(tool.name, input, decision)
  }
}

/**
 * Formats a message as <teammate-message> XML for injection into the conversation.
 * This ensures the model sees messages in the same format as tmux teammates.
 */
function formatAsTeammateMessage(
  from: string,
  content: string,
  color?: string,
  summary?: string,
): string {
  const colorAttr = color ? ` color="${color}"` : ''
  const summaryAttr = summary ? ` summary="${summary}"` : ''
  return `<${TEAMMATE_MESSAGE_TAG} teammate_id="${from}"${colorAttr}${summaryAttr}>\n${content}\n</${TEAMMATE_MESSAGE_TAG}>`
}

/**
 * Configuration for running an in-process teammate.
 */
export type InProcessRunnerConfig = {
  /** Teammate identity for context */
  identity: TeammateIdentity
  /** Task ID in AppState */
  taskId: string
  /** Initial prompt for the teammate */
  prompt: string
  /** Optional agent definition (for specialized agents) */
  agentDefinition?: CustomAgentDefinition
  /** Teammate context for AsyncLocalStorage */
  teammateContext: TeammateContext
  /** Parent's tool use context */
  toolUseContext: ToolUseContext
  /** Abort controller linked to parent */
  abortController: AbortController
  /** Optional system prompt override for this teammate */
  systemPrompt?: string
  /** How to apply the system prompt: 'replace' or 'append' to default */
  systemPromptMode?: 'default' | 'replace' | 'append'
  /** Tool permissions to auto-allow for this teammate */
  allowedTools?: string[]
  /** Short description of the task (used as summary for the initial prompt header) */
  description?: string
  /** request_id of the API call that spawned this teammate, for lineage
   *  tracing on tengu_api_* events. */
  invokingRequestId?: string
}

/**
 * Result from running an in-process teammate.
 */
export type InProcessRunnerResult = {
  /** Whether the run completed successfully */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Messages produced by the agent */
  messages: Message[]
}

/**
 * Updates task state in AppState.
 */
function updateTaskState(
  taskId: string,
  updater: (task: InProcessTeammateTaskState) => InProcessTeammateTaskState,
  setAppState: SetAppStateFn,
): void {
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (!task || task.type !== 'in_process_teammate') {
      return prev
    }
    const updated = updater(task)
    if (updated === task) {
      return prev
    }
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: updated,
      },
    }
  })
}

/**
 * Sends a message to the leader's file-based mailbox.
 * Uses the same mailbox system as tmux teammates for consistency.
 */
async function sendMessageToLeader(
  from: string,
  text: string,
  color: string | undefined,
  teamName: string,
): Promise<void> {
  await writeToMailbox(
    TEAM_LEAD_NAME,
    {
      from,
      text,
      timestamp: new Date().toISOString(),
      color,
    },
    teamName,
  )
}

/**
 * Sends idle notification to the leader via file-based mailbox.
 * Uses agentName (not agentId) for consistency with process-based teammates.
 */
async function sendIdleNotification(
  agentName: string,
  agentColor: string | undefined,
  teamName: string,
  options?: {
    idleReason?: 'available' | 'interrupted' | 'failed'
    summary?: string
    completedTaskId?: string
    completedStatus?: 'resolved' | 'blocked' | 'failed'
    failureReason?: string
  },
): Promise<void> {
  const notification = createIdleNotification(agentName, options)

  await sendMessageToLeader(
    agentName,
    jsonStringify(notification),
    agentColor,
    teamName,
  )
}

/**
 * Find an available task from the team's task list.
 * A task is available if it's pending, has no owner, and is not blocked.
 */
function findAvailableTask(tasks: Task[]): Task | undefined {
  const unresolvedTaskIds = new Set(
    tasks.filter(t => t.status !== 'completed').map(t => t.id),
  )

  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    return task.blockedBy.every(id => !unresolvedTaskIds.has(id))
  })
}

/**
 * Format a task as a prompt for the teammate to work on.
 */
function formatTaskAsPrompt(task: Task): string {
  let prompt = `Complete all open tasks. Start with task #${task.id}: \n\n ${task.subject}`

  if (task.description) {
    prompt += `\n\n${task.description}`
  }

  return prompt
}

/**
 * Try to claim an available task from the team's task list.
 * Returns the formatted prompt if a task was claimed, or undefined if none available.
 */
async function tryClaimNextTask(
  taskListId: string,
  agentName: string,
): Promise<string | undefined> {
  try {
    const tasks = await listTasks(taskListId)
    const availableTask = findAvailableTask(tasks)

    if (!availableTask) {
      return undefined
    }

    const result = await claimTask(taskListId, availableTask.id, agentName)

    if (!result.success) {
      logForDebugging(
        `[inProcessRunner] Failed to claim task #${availableTask.id}: ${result.reason}`,
      )
      return undefined
    }

    // Also set status to in_progress so the UI reflects it immediately
    await updateTask(taskListId, availableTask.id, { status: 'in_progress' })

    logForDebugging(
      `[inProcessRunner] Claimed task #${availableTask.id}: ${availableTask.subject}`,
    )

    return formatTaskAsPrompt(availableTask)
  } catch (err) {
    logForDebugging(`[inProcessRunner] Error checking task list: ${err}`)
    return undefined
  }
}

/**
 * Result of waiting for messages.
 */
type WaitResult =
  | {
      type: 'shutdown_request'
      request: ReturnType<typeof isShutdownRequest>
      originalMessage: string
    }
  | {
      type: 'new_message'
      message: string
      autonomyRunId?: string
      autonomyRootDir?: string
      from: string
      color?: string
      summary?: string
    }
  | {
      type: 'aborted'
    }

/**
 * Waits for new prompts or shutdown request.
 * Polls the teammate's mailbox every 500ms, checking for:
 * - Shutdown request from leader (returned to caller for model decision)
 * - New messages/prompts from leader
 * - Abort signal
 *
 * This keeps the teammate alive in 'idle' state instead of terminating.
 * Does NOT auto-approve shutdown - the model should make that decision.
 */
async function waitForNextPromptOrShutdown(
  identity: TeammateIdentity,
  abortController: AbortController,
  taskId: string,
  getAppState: () => AppState,
  setAppState: SetAppStateFn,
  taskListId: string,
): Promise<WaitResult> {
  const POLL_INTERVAL_MS = 500

  logForDebugging(
    `[inProcessRunner] ${identity.agentName} starting poll loop (abort=${abortController.signal.aborted})`,
  )

  let pollCount = 0
  while (!abortController.signal.aborted) {
    // Check for in-memory pending messages on every iteration (from transcript viewing)
    const appState = getAppState()
    const task = appState.tasks[taskId]
    if (
      task &&
      task.type === 'in_process_teammate' &&
      task.pendingUserMessages.length > 0
    ) {
      const pending = task.pendingUserMessages[0]! // Safe: checked length > 0
      // Pop the message from the queue
      setAppState(prev => {
        const prevTask = prev.tasks[taskId]
        if (!prevTask || prevTask.type !== 'in_process_teammate') {
          return prev
        }
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [taskId]: {
              ...prevTask,
              pendingUserMessages: prevTask.pendingUserMessages.slice(1),
            },
          },
        }
      })
      logForDebugging(
        `[inProcessRunner] ${identity.agentName} found pending user message (poll #${pollCount})`,
      )
      if (pending.autonomyRunId) {
        await markAutonomyRunRunning(
          pending.autonomyRunId,
          pending.autonomyRootDir,
        )
      }
      return {
        type: 'new_message',
        message: pending.message,
        autonomyRunId: pending.autonomyRunId,
        autonomyRootDir: pending.autonomyRootDir,
        from: 'user',
      }
    }

    // Wait before next poll (skip on first iteration to check immediately)
    if (pollCount > 0) {
      await sleep(POLL_INTERVAL_MS)
    }
    pollCount++

    // Check for abort
    if (abortController.signal.aborted) {
      logForDebugging(
        `[inProcessRunner] ${identity.agentName} aborted while waiting (poll #${pollCount})`,
      )
      return { type: 'aborted' }
    }

    // Check for messages in mailbox
    logForDebugging(
      `[inProcessRunner] ${identity.agentName} poll #${pollCount}: checking mailbox`,
    )
    try {
      // Read all messages and scan unread for shutdown requests first.
      // Shutdown requests are prioritized over regular messages to prevent
      // starvation when peer-to-peer messages flood the queue.
      const allMessages = await readMailbox(
        identity.agentName,
        identity.teamName,
      )

      // Scan all unread messages for shutdown requests (highest priority).
      // readMailbox() already reads all messages from disk, so this scan
      // adds only ~1-2ms of JSON parsing overhead.
      let shutdownIndex = -1
      let shutdownParsed: ReturnType<typeof isShutdownRequest> = null
      for (let i = 0; i < allMessages.length; i++) {
        const m = allMessages[i]
        if (m && !m.read) {
          const parsed = isShutdownRequest(m.text)
          if (parsed) {
            shutdownIndex = i
            shutdownParsed = parsed
            break
          }
        }
      }

      if (shutdownIndex !== -1) {
        const msg = allMessages[shutdownIndex]!
        const skippedUnread = count(
          allMessages.slice(0, shutdownIndex),
          m => !m.read,
        )
        logForDebugging(
          `[inProcessRunner] ${identity.agentName} received shutdown request from ${shutdownParsed?.from} (prioritized over ${skippedUnread} unread messages)`,
        )
        await markMessageAsReadByIdentity(
          identity.agentName,
          identity.teamName,
          msg,
        )
        return {
          type: 'shutdown_request',
          request: shutdownParsed,
          originalMessage: msg.text,
        }
      }

      // No shutdown request found. Prioritize team-lead messages over peer
      // messages — the leader represents user intent and coordination, so
      // their messages should not be starved behind peer-to-peer chatter.
      // Fall back to FIFO for peer messages.
      let selectedIndex = -1

      // Check for unread team-lead messages first
      for (let i = 0; i < allMessages.length; i++) {
        const m = allMessages[i]
        if (m && !m.read && m.from === TEAM_LEAD_NAME) {
          selectedIndex = i
          break
        }
      }

      // Fall back to first unread message (any sender)
      if (selectedIndex === -1) {
        selectedIndex = allMessages.findIndex(m => !m.read)
      }

      if (selectedIndex !== -1) {
        const msg = allMessages[selectedIndex]
        if (msg) {
          logForDebugging(
            `[inProcessRunner] ${identity.agentName} received new message from ${msg.from} (index ${selectedIndex})`,
          )
          await markMessageAsReadByIdentity(
            identity.agentName,
            identity.teamName,
            msg,
          )
          return {
            type: 'new_message',
            message: msg.text,
            from: msg.from,
            color: msg.color,
            summary: msg.summary,
          }
        }
      }
    } catch (err) {
      logForDebugging(
        `[inProcessRunner] ${identity.agentName} poll error: ${err}`,
      )
      // Continue polling even if one read fails
    }

    // Check the team's task list for unclaimed tasks
    const taskPrompt = await tryClaimNextTask(taskListId, identity.agentName)
    if (taskPrompt) {
      return {
        type: 'new_message',
        message: taskPrompt,
        from: 'task-list',
      }
    }
  }

  logForDebugging(
    `[inProcessRunner] ${identity.agentName} exiting poll loop (abort=${abortController.signal.aborted}, polls=${pollCount})`,
  )
  return { type: 'aborted' }
}

/**
 * Runs an in-process teammate with a continuous prompt loop.
 *
 * Executes runAgent() within the teammate's AsyncLocalStorage context,
 * tracks progress, updates task state, sends idle notification on completion,
 * then waits for new prompts or shutdown requests.
 *
 * Unlike background tasks, teammates stay alive and can receive multiple prompts.
 * The loop only exits on abort or after shutdown is approved by the model.
 *
 * @param config - Runner configuration
 * @returns Result with messages and success status
 */
export async function runInProcessTeammate(
  config: InProcessRunnerConfig,
): Promise<InProcessRunnerResult> {
  const {
    identity,
    taskId,
    prompt,
    description,
    agentDefinition,
    teammateContext,
    toolUseContext,
    abortController,
    systemPrompt,
    systemPromptMode,
    allowedTools,
    invokingRequestId,
  } = config
  const { setAppState } = toolUseContext
  const startTime = Date.now()

  logForDebugging(
    `[inProcessRunner] Starting agent loop for ${identity.agentId}`,
  )

  // Create AgentContext for analytics attribution
  const agentContext: AgentContext = {
    agentId: identity.agentId,
    parentSessionId: identity.parentSessionId,
    agentName: identity.agentName,
    teamName: identity.teamName,
    agentColor: identity.color,
    isTeamLead: false,
    agentType: 'teammate',
    invokingRequestId,
    invocationKind: 'spawn',
    invocationEmitted: false,
  }

  // Build system prompt based on systemPromptMode
  let teammateSystemPrompt: string
  if (systemPromptMode === 'replace' && systemPrompt) {
    teammateSystemPrompt = systemPrompt
  } else {
    const fullSystemPromptParts = await getSystemPrompt(
      toolUseContext.options.tools,
      toolUseContext.options.mainLoopModel,
      undefined,
      toolUseContext.options.mcpClients,
    )

    const systemPromptParts = [
      ...fullSystemPromptParts,
      TEAMMATE_SYSTEM_PROMPT_ADDENDUM,
    ]

    // If custom agent definition provided, append its prompt
    if (agentDefinition) {
      const customPrompt = agentDefinition.getSystemPrompt()
      if (customPrompt) {
        systemPromptParts.push(`\n# Custom Agent Instructions\n${customPrompt}`)
      }

      // Log agent memory loaded event for in-process teammates
      if (agentDefinition.memory) {
        logEvent('tengu_agent_memory_loaded', {
          ...(process.env.USER_TYPE === 'ant'
            ? {
                agent_type:
                  agentDefinition.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          scope:
            agentDefinition.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source:
            'in-process-teammate' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
    }

    // Append mode: add provided system prompt after default
    if (systemPromptMode === 'append' && systemPrompt) {
      systemPromptParts.push(systemPrompt)
    }

    teammateSystemPrompt = systemPromptParts.join('\n')
  }

  // Resolve agent definition - use full system prompt with teammate addendum
  const resolvedAgentDefinition: CustomAgentDefinition = {
    agentType: identity.agentName,
    whenToUse: `In-process teammate: ${identity.agentName}`,
    getSystemPrompt: () => teammateSystemPrompt,
    // Inject team-essential tools so teammates can always respond to
    // shutdown requests, send messages, and coordinate via the task list,
    // even with explicit tool lists
    tools: agentDefinition?.tools
      ? [
          ...new Set([
            ...agentDefinition.tools,
            SEND_MESSAGE_TOOL_NAME,
            TEAM_CREATE_TOOL_NAME,
            TEAM_DELETE_TOOL_NAME,
            TASK_CREATE_TOOL_NAME,
            TASK_GET_TOOL_NAME,
            TASK_LIST_TOOL_NAME,
            TASK_UPDATE_TOOL_NAME,
          ]),
        ]
      : ['*'],
    source: 'projectSettings',
  }

  // All messages across all prompts
  const allMessages: Message[] = []
  // Wrap initial prompt with XML for proper styling in transcript view
  const wrappedInitialPrompt = formatAsTeammateMessage(
    'team-lead',
    prompt,
    undefined,
    description,
  )
  let currentPrompt = wrappedInitialPrompt
  let currentAutonomyRunId: string | undefined
  let currentAutonomyRootDir: string | undefined
  let shouldExit = false

  // Try to claim an available task immediately so the UI can show activity
  // from the very start. The idle loop handles claiming for subsequent tasks.
  // Use parentSessionId as the task list ID since the leader creates tasks
  // under its session ID, not the team name.
  await tryClaimNextTask(identity.parentSessionId, identity.agentName)

  try {
    // Add initial prompt to task.messages for display (wrapped with XML)
    updateTaskState(
      taskId,
      task => ({
        ...task,
        messages: appendCappedMessage(
          task.messages,
          createUserMessage({ content: wrappedInitialPrompt }),
        ),
      }),
      setAppState,
    )

    // Per-teammate content replacement state. The while-loop below calls
    // runAgent repeatedly over an accumulating `allMessages` buffer (which
    // carries FULL original tool result content, not previews — query() yields
    // originals, enforcement is non-mutating). Without persisting state across
    // iterations, each call gets a fresh empty state from createSubagentContext
    // and makes holistic replace-globally-largest decisions, diverging from
    // earlier iterations' incremental frozen-first decisions → wire prefix
    // differs → cache miss. Gated on parent to inherit feature-flag-off.
    let teammateReplacementState = toolUseContext.contentReplacementState
      ? createContentReplacementState()
      : undefined

    // Main teammate loop - runs until abort or shutdown approved
    while (!abortController.signal.aborted && !shouldExit) {
      logForDebugging(
        `[inProcessRunner] ${identity.agentId} processing prompt: ${currentPrompt.substring(0, 50)}...`,
      )

      // Create a per-turn abort controller for this iteration.
      // This allows Escape to stop current work without killing the whole teammate.
      // The lifecycle abortController still kills the whole teammate if needed.
      const currentWorkAbortController = createAbortController()

      // Store the work controller in task state so UI can abort it
      updateTaskState(
        taskId,
        task => ({ ...task, currentWorkAbortController }),
        setAppState,
      )

      // Prepare prompt messages for this iteration
      // For the first iteration, start fresh
      // For subsequent iterations, pass accumulated messages as context
      const userMessage = createUserMessage({ content: currentPrompt })
      const promptMessages: Message[] = [userMessage]

      // Check if compaction is needed before building context
      let contextMessages = allMessages
      const tokenCount = tokenCountWithEstimation(allMessages)
      if (
        tokenCount >
        getAutoCompactThreshold(toolUseContext.options.mainLoopModel)
      ) {
        logForDebugging(
          `[inProcessRunner] ${identity.agentId} compacting history (${tokenCount} tokens)`,
        )
        // Create an isolated copy of toolUseContext so that compaction
        // does not clear the main session's readFileState cache or
        // trigger the main session's UI callbacks.
        const isolatedContext: ToolUseContext = {
          ...toolUseContext,
          readFileState: cloneFileStateCache(toolUseContext.readFileState),
          onCompactProgress: undefined,
          setStreamMode: undefined,
        }
        const compactedSummary = await compactConversation(
          allMessages,
          isolatedContext,
          {
            systemPrompt: asSystemPrompt([]),
            userContext: {},
            systemContext: {},
            toolUseContext: isolatedContext,
            forkContextMessages: [],
          },
          true, // suppressFollowUpQuestions
          undefined, // customInstructions
          true, // isAutoCompact
        )
        contextMessages = buildPostCompactMessages(compactedSummary)
        // Reset microcompact state since full compact replaces all
        // messages — old tool IDs are no longer relevant
        resetMicrocompactState()
        // Reset content replacement state — compact replaces all messages
        // so old tool_use_ids are gone. Stale Map entries are harmless
        // (UUID keys never match) but accumulate memory over long runs.
        if (teammateReplacementState) {
          teammateReplacementState = createContentReplacementState()
        }
        // Update allMessages in place with compacted version
        allMessages.length = 0
        allMessages.push(...contextMessages)

        // Mirror compaction into task.messages — otherwise the AppState
        // mirror grows unbounded (500 turns = 500+ messages, 10-50MB).
        // Replace with the compacted messages, matching allMessages.
        updateTaskState(
          taskId,
          task => ({ ...task, messages: [...contextMessages, userMessage] }),
          setAppState,
        )
      }

      // Pass previous messages as context to preserve conversation history
      // allMessages accumulates all previous messages (user + assistant) from prior iterations
      const forkContextMessages =
        contextMessages.length > 0 ? [...contextMessages] : undefined

      // Add the user message to allMessages so it's included in future context
      // This ensures the full conversation (user + assistant turns) is preserved
      allMessages.push(userMessage)

      // Create fresh progress tracker for this prompt
      const tracker = createProgressTracker()
      const resolveActivity = createActivityDescriptionResolver(
        toolUseContext.options.tools,
      )
      const iterationMessages: Message[] = []

      const iterationAgentDefinition = resolvedAgentDefinition

      // Track if this iteration was interrupted by work abort (not lifecycle abort)
      let workWasAborted = false

      // Run agent within contexts
      await runWithTeammateContext(teammateContext, async () => {
        return runWithAgentContext(agentContext, async () => {
          // Mark task as running (not idle)
          updateTaskState(
            taskId,
            task => ({ ...task, status: 'running', isIdle: false }),
            setAppState,
          )

          // Run the normal agent loop - same runAgent() used by AgentTool/subagents.
          // This calls query() internally, so we share the core API infrastructure.
          // Pass forkContextMessages to preserve conversation history across prompts.
          // Use currentWorkAbortController so Escape stops this turn only, not the teammate.
          for await (const message of runAgent({
            agentDefinition: iterationAgentDefinition,
            promptMessages,
            toolUseContext,
            canUseTool: createInProcessCanUseTool(),
            isAsync: true,
            forkContextMessages,
            querySource: 'agent:custom',
            override: { abortController: currentWorkAbortController },
            preserveToolUseResults: true,
            availableTools: toolUseContext.options.tools,
            allowedTools,
            contentReplacementState: teammateReplacementState,
          })) {
            // Check lifecycle abort first (kills whole teammate)
            if (abortController.signal.aborted) {
              logForDebugging(
                `[inProcessRunner] ${identity.agentId} lifecycle aborted`,
              )
              break
            }

            // Check work abort (stops current turn only)
            if (currentWorkAbortController.signal.aborted) {
              logForDebugging(
                `[inProcessRunner] ${identity.agentId} current work aborted (Escape pressed)`,
              )
              workWasAborted = true
              break
            }

            iterationMessages.push(message)
            allMessages.push(message)

            updateProgressFromMessage(
              tracker,
              message,
              resolveActivity,
              toolUseContext.options.tools,
            )
            const progress = getProgressUpdate(tracker)

            updateTaskState(
              taskId,
              task => {
                // Track in-progress tool use IDs for animation in transcript view
                let inProgressToolUseIDs = task.inProgressToolUseIDs
                if (message.type === 'assistant') {
                  for (const block of Array.isArray(message.message!.content)
                    ? message.message!.content
                    : []) {
                    if (
                      typeof block !== 'string' &&
                      block.type === 'tool_use'
                    ) {
                      inProgressToolUseIDs = new Set([
                        ...(inProgressToolUseIDs ?? []),
                        block.id,
                      ])
                    }
                  }
                } else if (message.type === 'user') {
                  const content = message.message!.content
                  if (Array.isArray(content)) {
                    for (const block of content) {
                      if (
                        typeof block === 'object' &&
                        'type' in block &&
                        block.type === 'tool_result'
                      ) {
                        if (inProgressToolUseIDs) {
                          inProgressToolUseIDs = new Set(inProgressToolUseIDs)
                          inProgressToolUseIDs.delete(block.tool_use_id)
                        }
                      }
                    }
                  }
                }

                return {
                  ...task,
                  progress,
                  messages: appendCappedMessage(task.messages, message),
                  inProgressToolUseIDs,
                }
              },
              setAppState,
            )
          }

          return { success: true, messages: iterationMessages }
        })
      })

      // Clear the work controller from state (it's no longer valid)
      updateTaskState(
        taskId,
        task => ({ ...task, currentWorkAbortController: undefined }),
        setAppState,
      )

      // Check if lifecycle aborted during agent run (kills whole teammate)
      if (abortController.signal.aborted) {
        break
      }

      // If work was aborted (Escape), log it and add interrupt message, then continue to idle state
      if (workWasAborted) {
        logForDebugging(
          `[inProcessRunner] ${identity.agentId} work interrupted, returning to idle`,
        )

        // Add interrupt message to teammate's messages so it appears in their scrollback
        const interruptMessage = createAssistantAPIErrorMessage({
          content: ERROR_MESSAGE_USER_ABORT,
        })
        updateTaskState(
          taskId,
          task => ({
            ...task,
            messages: appendCappedMessage(task.messages, interruptMessage),
          }),
          setAppState,
        )
        if (currentAutonomyRunId) {
          await markAutonomyRunFailed(
            currentAutonomyRunId,
            ERROR_MESSAGE_USER_ABORT,
            currentAutonomyRootDir,
          )
          currentAutonomyRunId = undefined
          currentAutonomyRootDir = undefined
        }
      } else if (currentAutonomyRunId) {
        await markAutonomyRunCompleted(
          currentAutonomyRunId,
          currentAutonomyRootDir,
        )
        currentAutonomyRunId = undefined
        currentAutonomyRootDir = undefined
      }

      // Check if already idle before updating (to skip duplicate notification)
      const prevAppState = toolUseContext.getAppState()
      const prevTask = prevAppState.tasks[taskId]
      const wasAlreadyIdle =
        prevTask?.type === 'in_process_teammate' && prevTask.isIdle

      // Mark task as idle (NOT completed) and notify any waiters
      updateTaskState(
        taskId,
        task => {
          // Call any registered idle callbacks
          task.onIdleCallbacks?.forEach(cb => cb())
          return { ...task, isIdle: true, onIdleCallbacks: [] }
        },
        setAppState,
      )

      // Note: We do NOT automatically send the teammate's response to the leader.
      // Teammates should use the Teammate tool to communicate with the leader.
      // This matches process-based teammates where output is not visible to the leader.

      // Only send idle notification on transition to idle (not if already idle)
      if (!wasAlreadyIdle) {
        await sendIdleNotification(
          identity.agentName,
          identity.color,
          identity.teamName,
          {
            idleReason: workWasAborted ? 'interrupted' : 'available',
            summary: getLastPeerDmSummary(allMessages),
          },
        )
      } else {
        logForDebugging(
          `[inProcessRunner] Skipping duplicate idle notification for ${identity.agentName}`,
        )
      }

      logForDebugging(
        `[inProcessRunner] ${identity.agentId} finished prompt, waiting for next`,
      )

      // Wait for next message or shutdown
      const waitResult = await waitForNextPromptOrShutdown(
        identity,
        abortController,
        taskId,
        toolUseContext.getAppState,
        setAppState,
        identity.parentSessionId,
      )

      switch (waitResult.type) {
        case 'shutdown_request':
          // Pass shutdown request to model for decision
          // Format as teammate-message for consistency with how tmux teammates receive it
          // The model will use approveShutdown or rejectShutdown tool
          logForDebugging(
            `[inProcessRunner] ${identity.agentId} received shutdown request - passing to model`,
          )
          currentPrompt = formatAsTeammateMessage(
            waitResult.request?.from || 'team-lead',
            waitResult.originalMessage,
          )
          // Add shutdown request to task.messages for transcript display
          appendTeammateMessage(
            taskId,
            createUserMessage({ content: currentPrompt }),
            setAppState,
          )
          currentAutonomyRunId = undefined
          currentAutonomyRootDir = undefined
          break

        case 'new_message':
          // New prompt from leader or teammate
          logForDebugging(
            `[inProcessRunner] ${identity.agentId} received new message from ${waitResult.from}`,
          )
          // Messages from the user should be plain text (not wrapped in XML)
          // Messages from other teammates get XML wrapper for identification
          if (waitResult.from === 'user') {
            currentPrompt = waitResult.message
            currentAutonomyRunId = waitResult.autonomyRunId
            currentAutonomyRootDir = waitResult.autonomyRootDir
          } else {
            currentPrompt = formatAsTeammateMessage(
              waitResult.from,
              waitResult.message,
              waitResult.color,
              waitResult.summary,
            )
            // Add to task.messages for transcript display (only for non-user messages)
            // Messages from 'user' come from pendingUserMessages which are already
            // added by injectUserMessageToTeammate
            appendTeammateMessage(
              taskId,
              createUserMessage({ content: currentPrompt }),
              setAppState,
            )
            currentAutonomyRunId = undefined
            currentAutonomyRootDir = undefined
          }
          break

        case 'aborted':
          logForDebugging(
            `[inProcessRunner] ${identity.agentId} aborted while waiting`,
          )
          shouldExit = true
          break
      }
    }

    // Mark as completed when exiting the loop
    let alreadyTerminal = false
    let toolUseId: string | undefined

    // Compute result so the detail dialog can show token usage.
    // Walk backwards for the last API usage (cumulative input_tokens from the
    // Anthropic API already includes all prior context).
    let completionTokens = 0
    let completionToolUseCount = 0
    let lastAssistantContent: AgentToolResult['content'] = []
    let lastUsage: AgentToolResult['usage'] | undefined
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]!
      if (m.type === 'assistant') {
        const blocks = (m.message?.content ?? []) as any[]
        for (const b of blocks) {
          if (b?.type === 'tool_use') completionToolUseCount++
        }
        const textBlocks = blocks.filter((b: any) => b?.type === 'text')
        if (textBlocks.length > 0 && lastAssistantContent.length === 0) {
          lastAssistantContent = textBlocks.map((b: any) => ({
            type: 'text' as const,
            text: b.text,
          }))
        }
        if (!lastUsage && m.message?.usage) {
          lastUsage = m.message.usage as AgentToolResult['usage']
          completionTokens = getTokenCountFromUsage(
            m.message.usage as Parameters<typeof getTokenCountFromUsage>[0],
          )
        }
        if (completionTokens > 0 && lastAssistantContent.length > 0) break
      }
    }

    const teammateResult: AgentToolResult = {
      agentId: identity.agentId,
      agentType: 'teammate',
      content: lastAssistantContent,
      totalToolUseCount: completionToolUseCount,
      totalDurationMs: Date.now() - startTime,
      totalTokens: completionTokens,
      usage: lastUsage as AgentToolResult['usage'],
    } as unknown as AgentToolResult

    updateTaskState(
      taskId,
      task => {
        // killInProcessTeammate may have already set status:killed +
        // notified:true + cleared fields. Don't overwrite (would flip
        // killed → completed and double-emit the SDK bookend).
        if (task.status !== 'running') {
          alreadyTerminal = true
          return task
        }
        toolUseId = task.toolUseId
        task.onIdleCallbacks?.forEach(cb => cb())
        task.unregisterCleanup?.()
        return {
          ...task,
          status: 'completed' as const,
          notified: true,
          endTime: Date.now(),
          result: teammateResult,
          messages: task.messages?.length ? [task.messages.at(-1)!] : undefined,
          pendingUserMessages: [],
          inProgressToolUseIDs: undefined,
          abortController: undefined,
          unregisterCleanup: undefined,
          currentWorkAbortController: undefined,
          onIdleCallbacks: [],
        }
      },
      setAppState,
    )
    void evictTaskOutput(taskId)
    // Eagerly evict task from AppState since it's been consumed
    evictTerminalTask(taskId, setAppState)
    // notified:true pre-set → no XML notification → print.ts won't emit
    // the SDK task_notification. Close the task_started bookend directly.
    if (!alreadyTerminal) {
      emitTaskTerminatedSdk(taskId, 'completed', {
        toolUseId,
        summary: identity.agentId,
      })
    }
    unregisterPerfettoAgent(identity.agentId)
    return { success: true, messages: allMessages }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    logForDebugging(
      `[inProcessRunner] Agent ${identity.agentId} failed: ${errorMessage}`,
    )

    // Mark task as failed and notify any waiters
    let alreadyTerminal = false
    let toolUseId: string | undefined
    updateTaskState(
      taskId,
      task => {
        if (task.status !== 'running') {
          alreadyTerminal = true
          return task
        }
        toolUseId = task.toolUseId
        task.onIdleCallbacks?.forEach(cb => cb())
        task.unregisterCleanup?.()
        return {
          ...task,
          status: 'failed' as const,
          notified: true,
          error: errorMessage,
          isIdle: true,
          endTime: Date.now(),
          onIdleCallbacks: [],
          messages: task.messages?.length ? [task.messages.at(-1)!] : undefined,
          pendingUserMessages: [],
          inProgressToolUseIDs: undefined,
          abortController: undefined,
          unregisterCleanup: undefined,
          currentWorkAbortController: undefined,
        }
      },
      setAppState,
    )
    void evictTaskOutput(taskId)
    // Eagerly evict task from AppState since it's been consumed
    evictTerminalTask(taskId, setAppState)
    // notified:true pre-set → no XML notification → close SDK bookend directly.
    if (!alreadyTerminal) {
      emitTaskTerminatedSdk(taskId, 'failed', {
        toolUseId,
        summary: identity.agentId,
      })
    }
    if (currentAutonomyRunId) {
      await markAutonomyRunFailed(
        currentAutonomyRunId,
        errorMessage,
        currentAutonomyRootDir,
      )
    }

    // Send idle notification with failure via file-based mailbox
    await sendIdleNotification(
      identity.agentName,
      identity.color,
      identity.teamName,
      {
        idleReason: 'failed',
        completedStatus: 'failed',
        failureReason: errorMessage,
      },
    )

    unregisterPerfettoAgent(identity.agentId)
    return {
      success: false,
      error: errorMessage,
      messages: allMessages,
    }
  }
}

/**
 * Starts an in-process teammate in the background.
 *
 * This is the main entry point called after spawn. It starts the agent
 * execution loop in a fire-and-forget manner.
 *
 * @param config - Runner configuration
 */
export function startInProcessTeammate(config: InProcessRunnerConfig): void {
  // Extract agentId before the closure so the catch handler doesn't retain
  // the full config object (including toolUseContext) while the promise is
  // pending - which can be hours for a long-running teammate.
  const agentId = config.identity.agentId
  void runInProcessTeammate(config).catch(error => {
    logForDebugging(`[inProcessRunner] Unhandled error in ${agentId}: ${error}`)
  })
}
