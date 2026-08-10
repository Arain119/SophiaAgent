import { jsonParse } from '../../utils/slowOperations.js'
import {
  type IdleNotificationMessage,
  isIdleNotification,
} from '../../utils/teammateMailbox.js'
import { getShutdownMessageSummary } from './ShutdownMessage.js'
import { getTaskAssignmentSummary } from './TaskAssignmentMessage.js'

function getIdleNotificationSummary(msg: IdleNotificationMessage): string {
  const parts: string[] = ['Agent idle']
  if (msg.completedTaskId) {
    const status = msg.completedStatus || 'completed'
    parts.push(`Task ${msg.completedTaskId} ${status}`)
  }
  if (msg.summary) {
    parts.push(`Last DM: ${msg.summary}`)
  }
  return parts.join(' | ')
}

export function formatTeammateMessageContent(content: string): string {
  const shutdownSummary = getShutdownMessageSummary(content)
  if (shutdownSummary) return shutdownSummary

  const idleMsg = isIdleNotification(content)
  if (idleMsg) return getIdleNotificationSummary(idleMsg)

  const taskAssignmentSummary = getTaskAssignmentSummary(content)
  if (taskAssignmentSummary) return taskAssignmentSummary

  try {
    const parsed = jsonParse(content) as { type?: string; message?: string }
    if (parsed?.type === 'teammate_terminated' && parsed.message) {
      return parsed.message
    }
  } catch {
    // Plain-text teammate message.
  }

  return content
}
