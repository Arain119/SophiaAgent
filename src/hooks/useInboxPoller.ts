import { randomUUID } from 'crypto'
import { useCallback, useEffect, useRef } from 'react'
import { useInterval } from 'usehooks-ts'
import { TEAMMATE_MESSAGE_TAG } from '../constants/xml.js'
import { useTerminalNotification } from '@anthropic/ink'
import { sendNotification } from '../services/notifier.js'
import {
  type AppState,
  useAppState,
  useAppStateStore,
  useSetAppState,
} from '../state/AppState.js'
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js'
import { logForDebugging } from '../utils/debug.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { isInsideTmux } from '../utils/swarm/backends/detection.js'
import {
  ensureBackendsRegistered,
  getBackendByType,
} from '../utils/swarm/backends/registry.js'
import type { PaneBackendType } from '../utils/swarm/backends/types.js'
import { removeTeammateFromTeamFile } from '../utils/swarm/teamHelpers.js'
import { unassignTeammateTasks } from '../utils/tasks.js'
import { getAgentName, isTeamLead, isTeammate } from '../utils/teammate.js'
import { isInProcessTeammate } from '../utils/teammateContext.js'
import {
  isSandboxPermissionRequest,
  isSandboxPermissionResponse,
  isShutdownApproved,
  isShutdownRequest,
  markMessagesAsRead,
  readUnreadMessages,
  type TeammateMessage,
} from '../utils/teammateMailbox.js'
import {
  hasSandboxPermissionCallback,
  processSandboxPermissionResponse,
} from './useSwarmPermissionPoller.js'

/**
 * Get the agent name to poll for messages.
 * - In-process teammates return undefined (they use waitForNextPromptOrShutdown instead)
 * - Process-based teammates use their SOPHIA_AGENT_NAME
 * - Team leads use their name from teamContext.teammates
 * - Standalone sessions return undefined
 */
function getAgentNameToPoll(appState: AppState): string | undefined {
  // In-process teammates should NOT use useInboxPoller - they have their own
  // polling mechanism via waitForNextPromptOrShutdown() in inProcessRunner.ts.
  // Using useInboxPoller would cause message routing issues since in-process
  // teammates share the same React context and AppState with the leader.
  //
  // Note: This can be called when the leader's REPL re-renders while an
  // in-process teammate's AsyncLocalStorage context is active (due to shared
  // setAppState). We return undefined to gracefully skip polling rather than
  // throwing, since this is a normal occurrence during concurrent execution.
  if (isInProcessTeammate()) {
    return undefined
  }
  if (isTeammate()) {
    return getAgentName()
  }
  // Team lead polls using their agent name (not ID)
  if (isTeamLead(appState.teamContext)) {
    const leadAgentId = appState.teamContext!.leadAgentId
    // Look up the lead's name from teammates map
    const leadName = appState.teamContext!.teammates[leadAgentId]?.name
    return leadName || 'team-lead'
  }
  return undefined
}

const INBOX_POLL_INTERVAL_MS = 1000

type Props = {
  enabled: boolean
  isLoading: boolean
  focusedInputDialog: string | undefined
  // Returns true if submission succeeded, false if rejected (e.g., query already running)
  // Dead code elimination: parameter named onSubmitMessage to avoid "teammate" string in external builds
  onSubmitMessage: (formatted: string) => boolean
}

/**
 * Polls the teammate inbox for new messages and submits them as turns.
 *
 * This hook:
 * 1. Polls every 1s for unread messages (teammates or team leads)
 * 2. When idle: submits messages immediately as a new turn
 * 3. When busy: queues messages in AppState.inbox for UI display, delivers when turn ends
 */
export function useInboxPoller({
  enabled,
  isLoading,
  focusedInputDialog,
  onSubmitMessage,
}: Props): void {
  // Assign to original name for clarity within the function
  const onSubmitTeammateMessage = onSubmitMessage
  const store = useAppStateStore()
  const setAppState = useSetAppState()
  const inboxMessageCount = useAppState(s => s.inbox.messages.length)
  const terminal = useTerminalNotification()

  const poll = useCallback(async () => {
    if (!enabled) return

    // Use ref to avoid dependency on appState object (prevents infinite loop)
    const currentAppState = store.getState()
    const agentName = getAgentNameToPoll(currentAppState)
    if (!agentName) return

    const unread = await readUnreadMessages(
      agentName,
      currentAppState.teamContext?.teamName,
    )

    if (unread.length === 0) return

    logForDebugging(`[InboxPoller] Found ${unread.length} unread message(s)`)

    // Helper to mark messages as read in the inbox file.
    // Called after messages are successfully delivered or reliably queued.
    const markRead = () => {
      void markMessagesAsRead(agentName, currentAppState.teamContext?.teamName)
    }

    // Separate sandbox and lifecycle protocol messages from regular messages.
    const sandboxPermissionRequests: TeammateMessage[] = []
    const sandboxPermissionResponses: TeammateMessage[] = []
    const shutdownRequests: TeammateMessage[] = []
    const shutdownApprovals: TeammateMessage[] = []
    const regularMessages: TeammateMessage[] = []

    for (const m of unread) {
      const sandboxReq = isSandboxPermissionRequest(m.text)
      const sandboxResp = isSandboxPermissionResponse(m.text)
      const shutdownReq = isShutdownRequest(m.text)
      const shutdownApproval = isShutdownApproved(m.text)

      if (sandboxReq) {
        sandboxPermissionRequests.push(m)
      } else if (sandboxResp) {
        sandboxPermissionResponses.push(m)
      } else if (shutdownReq) {
        shutdownRequests.push(m)
      } else if (shutdownApproval) {
        shutdownApprovals.push(m)
      } else {
        regularMessages.push(m)
      }
    }

    // Handle sandbox permission requests (leader side) - add to workerSandboxPermissions queue
    if (
      sandboxPermissionRequests.length > 0 &&
      isTeamLead(currentAppState.teamContext)
    ) {
      logForDebugging(
        `[InboxPoller] Found ${sandboxPermissionRequests.length} sandbox permission request(s)`,
      )

      const newSandboxRequests: Array<{
        requestId: string
        workerId: string
        workerName: string
        workerColor?: string
        host: string
        createdAt: number
      }> = []

      for (const m of sandboxPermissionRequests) {
        const parsed = isSandboxPermissionRequest(m.text)
        if (!parsed) continue

        // Validate required nested fields to prevent crashes from malformed messages
        if (!parsed.hostPattern?.host) {
          logForDebugging(
            `[InboxPoller] Invalid sandbox permission request: missing hostPattern.host`,
          )
          continue
        }

        newSandboxRequests.push({
          requestId: parsed.requestId,
          workerId: parsed.workerId,
          workerName: parsed.workerName,
          workerColor: parsed.workerColor,
          host: parsed.hostPattern.host,
          createdAt: parsed.createdAt,
        })
      }

      if (newSandboxRequests.length > 0) {
        setAppState(prev => ({
          ...prev,
          workerSandboxPermissions: {
            ...prev.workerSandboxPermissions,
            queue: [
              ...prev.workerSandboxPermissions.queue,
              ...newSandboxRequests,
            ],
          },
        }))

        // Send desktop notification for the first new request
        const firstRequest = newSandboxRequests[0]
        if (firstRequest && !isLoading && !focusedInputDialog) {
          void sendNotification(
            {
              message: `${firstRequest.workerName} needs network access to ${firstRequest.host}`,
              notificationType: 'worker_permission_prompt',
            },
            terminal,
          )
        }
      }
    }

    // Handle sandbox permission responses (worker side) - invoke registered callbacks
    if (sandboxPermissionResponses.length > 0 && isTeammate()) {
      logForDebugging(
        `[InboxPoller] Found ${sandboxPermissionResponses.length} sandbox permission response(s)`,
      )

      for (const m of sandboxPermissionResponses) {
        const parsed = isSandboxPermissionResponse(m.text)
        if (!parsed) continue

        // Check if we have a registered callback for this request
        if (hasSandboxPermissionCallback(parsed.requestId)) {
          logForDebugging(
            `[InboxPoller] Processing sandbox permission response for ${parsed.requestId}: allow=${parsed.allow}`,
          )

          // Process the response using the exported function
          processSandboxPermissionResponse({
            requestId: parsed.requestId,
            host: parsed.host,
            allow: parsed.allow,
          })

          // Clear the pending sandbox request indicator
          setAppState(prev => ({
            ...prev,
            pendingSandboxRequest: null,
          }))
        }
      }
    }

    // Handle shutdown requests (teammate side) - preserve JSON for UI rendering
    if (shutdownRequests.length > 0 && isTeammate()) {
      logForDebugging(
        `[InboxPoller] Found ${shutdownRequests.length} shutdown request(s)`,
      )

      // Pass through shutdown requests - the UI component will render them nicely
      // and the model will receive instructions via the tool prompt documentation
      for (const m of shutdownRequests) {
        regularMessages.push(m)
      }
    }

    // Handle shutdown approvals (leader side) - kill the teammate's pane
    if (
      shutdownApprovals.length > 0 &&
      isTeamLead(currentAppState.teamContext)
    ) {
      logForDebugging(
        `[InboxPoller] Found ${shutdownApprovals.length} shutdown approval(s)`,
      )

      for (const m of shutdownApprovals) {
        const parsed = isShutdownApproved(m.text)
        if (!parsed) continue

        // Kill the pane if we have the info (pane-based teammates)
        if (parsed.paneId && parsed.backendType) {
          void (async () => {
            try {
              // Ensure backend classes are imported (no subprocess probes)
              await ensureBackendsRegistered()
              const insideTmux = await isInsideTmux()
              const backend = getBackendByType(
                parsed.backendType as PaneBackendType,
              )
              const success = await backend?.killPane(
                parsed.paneId!,
                !insideTmux,
              )
              logForDebugging(
                `[InboxPoller] Killed pane ${parsed.paneId} for ${parsed.from}: ${success}`,
              )
            } catch (error) {
              logForDebugging(
                `[InboxPoller] Failed to kill pane for ${parsed.from}: ${error}`,
              )
            }
          })()
        }

        // Remove the teammate from teamContext.teammates so the count is accurate
        const teammateToRemove = parsed.from
        if (teammateToRemove && currentAppState.teamContext?.teammates) {
          // Find the teammate ID by name
          const teammateId = Object.entries(
            currentAppState.teamContext.teammates,
          ).find(([, t]) => t.name === teammateToRemove)?.[0]

          if (teammateId) {
            // Remove from team file (leader owns team file mutations)
            const teamName = currentAppState.teamContext?.teamName
            if (teamName) {
              removeTeammateFromTeamFile(teamName, {
                agentId: teammateId,
                name: teammateToRemove,
              })
            }

            // Unassign tasks and build notification message
            const { notificationMessage } = teamName
              ? await unassignTeammateTasks(
                  teamName,
                  teammateId,
                  teammateToRemove,
                  'shutdown',
                )
              : { notificationMessage: `${teammateToRemove} has shut down.` }

            setAppState(prev => {
              if (!prev.teamContext?.teammates) return prev
              if (!(teammateId in prev.teamContext.teammates)) return prev
              const { [teammateId]: _, ...remainingTeammates } =
                prev.teamContext.teammates

              // Mark the teammate's task as completed so hasRunningTeammates
              // becomes false and the spinner stops. Without this, out-of-process
              // (tmux) teammate tasks stay status:'running' forever because
              // only in-process teammates have a runner that sets 'completed'.
              const updatedTasks = { ...prev.tasks }
              for (const [tid, task] of Object.entries(updatedTasks)) {
                if (
                  isInProcessTeammateTask(task) &&
                  task.identity.agentId === teammateId
                ) {
                  updatedTasks[tid] = {
                    ...task,
                    status: 'completed' as const,
                    endTime: Date.now(),
                  }
                }
              }

              return {
                ...prev,
                tasks: updatedTasks,
                teamContext: {
                  ...prev.teamContext,
                  teammates: remainingTeammates,
                },
                inbox: {
                  messages: [
                    ...prev.inbox.messages,
                    {
                      id: randomUUID(),
                      from: 'system',
                      text: jsonStringify({
                        type: 'teammate_terminated',
                        message: notificationMessage,
                      }),
                      timestamp: new Date().toISOString(),
                      status: 'pending' as const,
                    },
                  ],
                },
              }
            })
            logForDebugging(
              `[InboxPoller] Removed ${teammateToRemove} (${teammateId}) from teamContext`,
            )
          }
        }

        // Pass through for UI rendering - the component will render it nicely
        regularMessages.push(m)
      }
    }

    // Process regular teammate messages (existing logic)
    if (regularMessages.length === 0) {
      // No regular messages, but we may have processed non-regular messages
      // (permissions, shutdown requests, etc.) above — mark those as read.
      markRead()
      return
    }

    // Format messages with XML wrapper for Sophia Agent (include color if available)
    // Transform plan approval requests into model-readable instructions
    const formatted = regularMessages
      .map(m => {
        const colorAttr = m.color ? ` color="${m.color}"` : ''
        const summaryAttr = m.summary ? ` summary="${m.summary}"` : ''
        const messageContent = m.text

        return `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${colorAttr}${summaryAttr}>\n${messageContent}\n</${TEAMMATE_MESSAGE_TAG}>`
      })
      .join('\n\n')

    // Helper to queue messages in AppState for later delivery
    const queueMessages = () => {
      setAppState(prev => ({
        ...prev,
        inbox: {
          messages: [
            ...prev.inbox.messages,
            ...regularMessages.map(m => ({
              id: randomUUID(),
              from: m.from,
              text: m.text,
              timestamp: m.timestamp,
              status: 'pending' as const,
              color: m.color,
              summary: m.summary,
            })),
          ],
        },
      }))
    }

    if (!isLoading && !focusedInputDialog) {
      // IDLE: Submit as new turn immediately
      logForDebugging(`[InboxPoller] Session idle, submitting immediately`)
      const submitted = onSubmitTeammateMessage(formatted)
      if (!submitted) {
        // Submission rejected (query already running), queue for later
        logForDebugging(
          `[InboxPoller] Submission rejected, queuing for later delivery`,
        )
        queueMessages()
      }
    } else {
      // BUSY: Add to inbox queue for UI display + later delivery
      logForDebugging(`[InboxPoller] Session busy, queuing for later delivery`)
      queueMessages()
    }

    // Mark messages as read only after they have been successfully delivered
    // or reliably queued in AppState. This prevents permanent message loss
    // when the session is busy — if we crash before this point, the messages
    // will be re-read on the next poll cycle instead of being silently dropped.
    markRead()
  }, [
    enabled,
    isLoading,
    focusedInputDialog,
    onSubmitTeammateMessage,
    setAppState,
    terminal,
    store,
  ])

  // When session becomes idle, deliver any pending messages and clean up processed ones
  useEffect(() => {
    if (!enabled) return

    // Skip if busy or in a dialog
    if (isLoading || focusedInputDialog) {
      return
    }

    // Use ref to avoid dependency on appState object (prevents infinite loop)
    const currentAppState = store.getState()
    const agentName = getAgentNameToPoll(currentAppState)
    if (!agentName) return

    const pendingMessages = currentAppState.inbox.messages.filter(
      m => m.status === 'pending',
    )
    const processedMessages = currentAppState.inbox.messages.filter(
      m => m.status === 'processed',
    )

    // Clean up processed messages (they were already delivered mid-turn as attachments)
    if (processedMessages.length > 0) {
      logForDebugging(
        `[InboxPoller] Cleaning up ${processedMessages.length} processed message(s) that were delivered mid-turn`,
      )
      const processedIds = new Set(processedMessages.map(m => m.id))
      setAppState(prev => ({
        ...prev,
        inbox: {
          messages: prev.inbox.messages.filter(m => !processedIds.has(m.id)),
        },
      }))
    }

    // No pending messages to deliver
    if (pendingMessages.length === 0) return

    logForDebugging(
      `[InboxPoller] Session idle, delivering ${pendingMessages.length} pending message(s)`,
    )

    // Format messages with XML wrapper for Claude (include color if available)
    const formatted = pendingMessages
      .map(m => {
        const colorAttr = m.color ? ` color="${m.color}"` : ''
        const summaryAttr = m.summary ? ` summary="${m.summary}"` : ''
        return `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${colorAttr}${summaryAttr}>\n${m.text}\n</${TEAMMATE_MESSAGE_TAG}>`
      })
      .join('\n\n')

    // Try to submit - only clear messages if successful
    const submitted = onSubmitTeammateMessage(formatted)
    if (submitted) {
      // Clear the specific messages we just submitted by their IDs
      const submittedIds = new Set(pendingMessages.map(m => m.id))
      setAppState(prev => ({
        ...prev,
        inbox: {
          messages: prev.inbox.messages.filter(m => !submittedIds.has(m.id)),
        },
      }))
    } else {
      logForDebugging(
        `[InboxPoller] Submission rejected, keeping messages queued`,
      )
    }
  }, [
    enabled,
    isLoading,
    focusedInputDialog,
    onSubmitTeammateMessage,
    setAppState,
    inboxMessageCount,
    store,
  ])

  // Poll if running as a teammate or as a team lead
  const shouldPoll = enabled && !!getAgentNameToPoll(store.getState())
  useInterval(() => void poll(), shouldPoll ? INBOX_POLL_INTERVAL_MS : null)

  // Initial poll on mount (only once)
  const hasDoneInitialPollRef = useRef(false)
  useEffect(() => {
    if (!enabled) return
    if (hasDoneInitialPollRef.current) return
    // Use store.getState() to avoid dependency on appState object
    if (getAgentNameToPoll(store.getState())) {
      hasDoneInitialPollRef.current = true
      void poll()
    }
    // Note: poll uses store.getState() (not appState) so it won't re-run on appState changes
    // The ref guard is a safety measure to ensure initial poll only happens once
  }, [enabled, poll, store])
}
