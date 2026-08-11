import type { RenderableMessage } from '../types/message.js'

const TASK_OUTPUT_TOOL_NAMES = new Set([
  'TaskOutput',
  'AgentOutputTool',
  'BashOutputTool',
])

type Poll = {
  index: number
  taskId: string
  toolUseId: string
  hasRemovableResult: boolean
}

function toolUseBlock(message: RenderableMessage):
  | {
      type: 'tool_use'
      id: string
      name: string
      input?: { task_id?: unknown; block?: unknown }
    }
  | undefined {
  if (message.type !== 'assistant' || !Array.isArray(message.message.content)) {
    return undefined
  }
  const block = message.message.content[0] as {
    type?: string
    id?: string
    name?: string
    input?: { task_id?: unknown; block?: unknown }
  }
  if (
    block.type !== 'tool_use' ||
    typeof block.id !== 'string' ||
    typeof block.name !== 'string'
  ) {
    return undefined
  }
  return block as {
    type: 'tool_use'
    id: string
    name: string
    input?: { task_id?: unknown; block?: unknown }
  }
}

function removableResultId(message: RenderableMessage): string | undefined {
  if (message.type !== 'user' || !Array.isArray(message.message.content)) {
    return undefined
  }
  if (message.message.content.length !== 1) return undefined
  const block = message.message.content[0] as {
    type?: string
    tool_use_id?: string
    is_error?: boolean
  }
  if (
    block.type !== 'tool_result' ||
    typeof block.tool_use_id !== 'string' ||
    block.is_error
  ) {
    return undefined
  }
  return block.tool_use_id
}

/**
 * Keeps only the latest successful non-blocking status check for each task.
 * The transcript passes verbose=true and remains a complete event log.
 */
export function collapseTaskOutputPolls(
  messages: RenderableMessage[],
  verbose: boolean,
): RenderableMessage[] {
  if (verbose) return messages

  const removableResultIds = new Set<string>()
  for (const message of messages) {
    const id = removableResultId(message)
    if (id) removableResultIds.add(id)
  }

  const polls: Poll[] = []
  for (let index = 0; index < messages.length; index++) {
    const block = toolUseBlock(messages[index]!)
    if (!block || !TASK_OUTPUT_TOOL_NAMES.has(block.name)) continue
    if (
      block.input?.block !== false ||
      typeof block.input.task_id !== 'string'
    ) {
      continue
    }
    polls.push({
      index,
      taskId: block.input.task_id,
      toolUseId: block.id,
      hasRemovableResult: removableResultIds.has(block.id),
    })
  }

  const latestIndexByTask = new Map<string, number>()
  for (const poll of polls) latestIndexByTask.set(poll.taskId, poll.index)

  const hiddenToolUseIds = new Set(
    polls
      .filter(
        poll =>
          poll.hasRemovableResult &&
          latestIndexByTask.get(poll.taskId) !== poll.index,
      )
      .map(poll => poll.toolUseId),
  )
  if (hiddenToolUseIds.size === 0) return messages

  return messages.filter(message => {
    const use = toolUseBlock(message)
    if (use && hiddenToolUseIds.has(use.id)) return false
    const resultId = removableResultId(message)
    return !resultId || !hiddenToolUseIds.has(resultId)
  })
}
