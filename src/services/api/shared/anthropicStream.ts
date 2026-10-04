/**
 * Shared consumer for an Anthropic Messages-formatted stream
 * (BetaRawMessageStreamEvent items). Both the OpenAI Responses path (which
 * adapts OpenAI SSE into this shape) and the native Anthropic Messages path
 * feed their streams through this so assembly, cost tracking and error
 * reporting behave identically.
 */
import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  AssistantMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import type { AgentId } from '../../../types/ids.js'
import type { Tools } from '../../../Tool.js'
import {
  createAssistantAPIErrorMessage,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import { updateOpenAIUsage } from '../openai/openaiShared.js'
import { randomUUID } from 'crypto'

export type StreamUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export type StreamConsumptionResult = {
  collectedMessages: AssistantMessage[]
  usage: StreamUsage
  ttftMs: number
  start: number
}

export type ConsumeAnthropicStreamParams = {
  stream: AsyncIterable<BetaRawMessageStreamEvent>
  tools: Tools
  agentId: AgentId | undefined
  maxTokens: number
  /** Called at message_stop with the accumulated usage (cost tracking). */
  recordUsage?: (usage: StreamUsage) => void
  /** Called when the stream ends (e.g. Langfuse observation hook). */
  onStreamEnd?: (result: StreamConsumptionResult) => void
}

/**
 * Assemble the final AssistantMessage (and optional max_tokens error) from
 * accumulated stream state.
 */
export function assembleFinalAssistantOutputs(params: {
  partialMessage: BetaMessage | null
  contentBlocks: Record<number, Record<string, unknown>>
  tools: Tools
  agentId: string | undefined
  usage: StreamUsage
  stopReason: string | null
  maxTokens: number
}): (AssistantMessage | SystemAPIErrorMessage)[] {
  const {
    partialMessage,
    contentBlocks,
    tools,
    agentId,
    usage,
    stopReason,
    maxTokens,
  } = params
  const outputs: (AssistantMessage | SystemAPIErrorMessage)[] = []

  const allBlocks = Object.keys(contentBlocks)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => contentBlocks[Number(k)])
    .filter(Boolean)

  if (allBlocks.length > 0 && partialMessage) {
    outputs.push({
      message: {
        ...partialMessage,
        content: normalizeContentFromAPI(
          allBlocks as unknown as BetaMessage['content'],
          tools,
          agentId as AgentId | undefined,
        ),
        usage,
        stop_reason: stopReason,
        stop_sequence: null,
      } as AssistantMessage['message'],
      requestId: undefined,
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
    } as AssistantMessage)
  }

  if (stopReason === 'max_tokens') {
    outputs.push(
      createAssistantAPIErrorMessage({
        content:
          `Output truncated: response exceeded the ${maxTokens} token limit. ` +
          `Set OPENAI_MAX_TOKENS or SOPHIA_MAX_OUTPUT_TOKENS to override.`,
        apiError: 'max_output_tokens',
        error: 'max_output_tokens',
      }),
    )
  }

  return outputs
}

export async function* consumeAnthropicStream(
  params: ConsumeAnthropicStreamParams,
): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage> {
  const { stream, tools, agentId, maxTokens, recordUsage, onStreamEnd } = params

  const contentBlocks: Record<number, Record<string, unknown>> = {}
  const collectedMessages: AssistantMessage[] = []
  let partialMessage: BetaMessage | null = null
  let stopReason: string | null = null
  let usage: StreamUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  let ttftMs = 0
  const start = Date.now()

  for await (const event of stream) {
    switch (event.type) {
      case 'message_start': {
        partialMessage = event.message
        ttftMs = Date.now() - start
        if (event.message.usage) {
          usage = {
            ...usage,
            ...(event.message.usage as unknown as StreamUsage),
          }
        }
        break
      }
      case 'content_block_start': {
        const idx = event.index
        const cb = event.content_block
        if (cb.type === 'tool_use') {
          contentBlocks[idx] = { ...cb, input: '' }
        } else if (cb.type === 'text') {
          contentBlocks[idx] = { ...cb, text: '' }
        } else if (cb.type === 'thinking') {
          contentBlocks[idx] = { ...cb, thinking: '', signature: '' }
        } else {
          contentBlocks[idx] = { ...cb }
        }
        break
      }
      case 'content_block_delta': {
        const idx = event.index
        const delta = event.delta
        const block = contentBlocks[idx]
        if (!block) break
        if (delta.type === 'text_delta') {
          block.text = ((block.text as string | undefined) || '') + delta.text
        } else if (delta.type === 'input_json_delta') {
          block.input =
            ((block.input as string | undefined) || '') + delta.partial_json
        } else if (delta.type === 'thinking_delta') {
          block.thinking =
            ((block.thinking as string | undefined) || '') + delta.thinking
        } else if (delta.type === 'signature_delta') {
          block.signature = delta.signature
        }
        break
      }
      case 'content_block_stop': {
        // Block accumulation is complete; assembly happens at message_stop.
        break
      }
      case 'message_delta': {
        const deltaUsage = event.usage
        if (deltaUsage) {
          usage = updateOpenAIUsage(
            usage,
            deltaUsage as unknown as Parameters<typeof updateOpenAIUsage>[1],
          )
        }
        if (event.delta.stop_reason != null) {
          stopReason = event.delta.stop_reason
        }
        break
      }
      case 'message_stop': {
        if (partialMessage) {
          for (const output of assembleFinalAssistantOutputs({
            partialMessage,
            contentBlocks,
            tools,
            agentId,
            usage,
            stopReason,
            maxTokens,
          })) {
            if (output.type === 'assistant') {
              collectedMessages.push(output)
            }
            yield output
          }
          partialMessage = null
        }
        if (usage.input_tokens + usage.output_tokens > 0) {
          recordUsage?.(usage)
        }
        break
      }
    }

    yield {
      type: 'stream_event',
      event,
      ...(event.type === 'message_start' ? { ttftMs } : undefined),
    } as StreamEvent
  }

  onStreamEnd?.({ collectedMessages, usage, ttftMs, start })

  // Safety: if stream ended without message_stop, assemble and yield whatever
  // we have.
  if (partialMessage) {
    for (const output of assembleFinalAssistantOutputs({
      partialMessage,
      contentBlocks,
      tools,
      agentId,
      usage,
      stopReason,
      maxTokens,
    })) {
      yield output
    }
  }
}
