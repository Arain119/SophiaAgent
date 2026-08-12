import type { ContentItem, Message as MessageType } from 'src/types/message.js'

export function countToolUses(messages: MessageType[]): number {
  let count = 0
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const block of (message.message?.content as ContentItem[]) ?? []) {
      if (block.type === 'tool_use') count++
    }
  }
  return count
}

export function getTerminalAgentError(
  messages: MessageType[],
): string | undefined {
  const lastAssistant = messages.findLast(
    message => message.type === 'assistant',
  )
  if (!lastAssistant?.isApiErrorMessage) return undefined

  const content = ((lastAssistant.message?.content as ContentItem[]) ?? [])
    .filter(block => block.type === 'text')
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
  return (
    content ||
    (typeof lastAssistant.errorDetails === 'string'
      ? lastAssistant.errorDetails
      : 'Subagent API request failed')
  )
}

export function getLastToolUseName(message: MessageType): string | undefined {
  if (message.type !== 'assistant') return undefined
  const block = ((message.message?.content as ContentItem[]) ?? []).findLast(
    item => item.type === 'tool_use',
  )
  return block?.type === 'tool_use' ? block.name : undefined
}
