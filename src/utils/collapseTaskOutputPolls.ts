import type { Message, RenderableMessage } from '../types/message.js'

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

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input?: { task_id?: unknown; block?: unknown }
}

function toolUseBlocks(message: Message | RenderableMessage): ToolUseBlock[] {
  const content =
    message.type === 'assistant' ? message.message?.content : undefined
  if (!Array.isArray(content)) {
    return []
  }
  return content.flatMap(block => {
    const candidate = block as {
      type?: string
      id?: string
      name?: string
      input?: { task_id?: unknown; block?: unknown }
    }
    return candidate.type === 'tool_use' &&
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string'
      ? [candidate as ToolUseBlock]
      : []
  })
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

function removableResultIds(message: Message | RenderableMessage): string[] {
  const content = message.type === 'user' ? message.message?.content : undefined
  if (!Array.isArray(content)) {
    return []
  }
  return content.flatMap(block => {
    if (
      typeof block !== 'string' &&
      block.type === 'tool_result' &&
      typeof block.tool_use_id === 'string' &&
      !block.is_error
    ) {
      return [block.tool_use_id]
    }
    return []
  })
}

function findStalePollIds(
  messages: ReadonlyArray<Message | RenderableMessage>,
): Set<string> {
  const removableResultIdsSet = new Set<string>()
  for (const message of messages) {
    for (const id of removableResultIds(message)) {
      removableResultIdsSet.add(id)
    }
  }

  const polls: Poll[] = []
  for (let index = 0; index < messages.length; index++) {
    for (const block of toolUseBlocks(messages[index]!)) {
      if (!TASK_OUTPUT_TOOL_NAMES.has(block.name)) continue
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
        hasRemovableResult: removableResultIdsSet.has(block.id),
      })
    }
  }

  const latestIndexByTask = new Map<string, number>()
  for (const poll of polls) latestIndexByTask.set(poll.taskId, poll.index)

  return new Set(
    polls
      .filter(
        poll =>
          poll.hasRemovableResult &&
          latestIndexByTask.get(poll.taskId) !== poll.index,
      )
      .map(poll => poll.toolUseId),
  )
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

  const hiddenToolUseIds = findStalePollIds(messages)
  if (hiddenToolUseIds.size === 0) return messages

  return messages.filter(message => {
    const use = toolUseBlock(message)
    if (use && hiddenToolUseIds.has(use.id)) return false
    const resultIds = removableResultIds(message)
    return !resultIds.some(id => hiddenToolUseIds.has(id))
  })
}

/** Removes stale successful poll pairs before messages enter the model context. */
export function compactTaskOutputPollsForAPI(messages: Message[]): Message[] {
  const staleIds = findStalePollIds(messages)
  if (staleIds.size === 0) return messages

  return messages.flatMap(message => {
    const originalContent =
      message.type === 'assistant' || message.type === 'user'
        ? message.message?.content
        : undefined
    if (
      (message.type !== 'assistant' && message.type !== 'user') ||
      !Array.isArray(originalContent)
    ) {
      return [message]
    }

    const content = originalContent.filter(block => {
      if (typeof block === 'string') return true
      if (block.type === 'tool_use') return !staleIds.has(block.id)
      if (block.type === 'tool_result') {
        return !staleIds.has(block.tool_use_id)
      }
      return true
    })
    if (content.length === originalContent.length) return [message]
    if (
      content.length === 0 ||
      (message.type === 'assistant' &&
        content.every(
          block =>
            typeof block !== 'string' &&
            (block.type === 'thinking' || block.type === 'redacted_thinking'),
        ))
    ) {
      return []
    }
    return [
      {
        ...message,
        message: { ...message.message!, content },
      } as Message,
    ]
  })
}
