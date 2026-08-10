import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaRawMessageStreamEvent,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  getLastApiCompletionTimestamp,
  getSessionId,
  setLastApiCompletionTimestamp,
} from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/metadata.js'
import {
  adaptResponsesStreamToAnthropic,
  buildResponsesRequest,
  createResponsesStream,
} from '../services/api/openai/responsesAdapter.js'
import { formatOpenAIPromptCacheKey } from '../services/api/openai/openaiShared.js'
import type { LangfuseSpan } from '../services/langfuse/index.js'
import {
  resolveOpenAIModel,
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
} from '@ant/model-provider'
import { normalizeModelStringForAPI } from './model/model.js'

type MessageParam = Anthropic.MessageParam
type TextBlockParam = Anthropic.TextBlockParam
type Tool = Anthropic.Tool
type ToolChoice = Anthropic.ToolChoice
type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaJSONOutputFormat = Anthropic.Beta.Messages.BetaJSONOutputFormat
type BetaThinkingConfigParam = Anthropic.Beta.Messages.BetaThinkingConfigParam

export type SideQueryOptions = {
  /** Model to use for the query */
  model: string
  /**
   * System prompt - string or array of text blocks (will be prefixed with CLI attribution).
   *
   * The attribution header is always placed in its own TextBlockParam block to ensure
   * server-side parsing correctly extracts the cc_entrypoint value without including
   * system prompt content.
   */
  system?: string | TextBlockParam[]
  /** Messages to send (supports cache_control on content blocks) */
  messages: MessageParam[]
  /** Optional tools (supports both standard Tool[] and BetaToolUnion[] for custom tool types) */
  tools?: Tool[] | BetaToolUnion[]
  /** Optional tool choice (use { type: 'tool', name: 'x' } for forced output) */
  tool_choice?: ToolChoice
  /** Optional JSON output format for structured responses */
  output_format?: BetaJSONOutputFormat
  /** Max tokens (default: 1024) */
  max_tokens?: number
  /** Max retries (default: 2) */
  maxRetries?: number
  /** Abort signal */
  signal?: AbortSignal
  /** Skip CLI system prompt prefix (keeps attribution header for OAuth). For internal classifiers that provide their own prompt. */
  skipSystemPromptPrefix?: boolean
  /** Temperature override */
  temperature?: number
  /** Thinking budget (enables thinking), or `false` to send `{ type: 'disabled' }`. */
  thinking?: number | false
  /** Stop sequences — generation stops when any of these strings is emitted */
  stop_sequences?: string[]
  /** Attributes this call in tengu_api_success for COGS joining against reporting.sampling_calls. */
  querySource: QuerySource
  /** Parent Langfuse span to nest this side query under the main agent trace. */
  parentSpan?: LangfuseSpan | null
  /** When true, API failures are recorded as WARNING instead of ERROR in Langfuse.
   *  Use for optional/best-effort queries where failure is expected and handled gracefully. */
  optional?: boolean
}

/**
 * Extract system prompt text from the `system` option.
 */
function extractSystemText(system?: string | TextBlockParam[]): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  return system
    .filter((b): b is { type: 'text'; text: string } => 'text' in b && !!b.text)
    .map(b => b.text)
    .join('\n\n')
}

/**
 * Convert Anthropic MessageParam[] to a list of {role, content} objects
 * suitable for the OpenAI Responses adapter.
 */
function messageParamsToOpenAIRoleContent(
  messages: MessageParam[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const result: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter(
                (b): b is { type: 'text'; text: string } => b.type === 'text',
              )
              .map(b => b.text)
              .join('\n')
          : ''
    if (text) {
      result.push({ role: m.role as 'user' | 'assistant', content: text })
    }
  }
  return result
}

/**
 * Lightweight API wrapper for "side queries" outside the main conversation loop.
 *
 * Use this instead of direct client.beta.messages.create() calls to ensure
 * the same API-key provider routing as the main conversation loop.
 *
 * This handles:
 * - CLI system prompt prefix
 * - Proper betas for the model
 * - API metadata
 * - Model string normalization (strips [1m] suffix for API)
 * - OpenAI protocol routing
 *
 * @example
 * // Permission explainer
 * await sideQuery({ querySource: 'permission_explainer', model, system: SYSTEM_PROMPT, messages, tools, tool_choice })
 *
 * @example
 * // Session search
 * await sideQuery({ querySource: 'session_search', model, system: SEARCH_PROMPT, messages })
 *
 * @example
 * // Model validation
 * await sideQuery({ querySource: 'model_validation', model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] })
 */
export async function sideQuery(opts: SideQueryOptions): Promise<BetaMessage> {
  return sideQueryViaResponsesCompatible(opts)
}

/**
 * Collect Anthropic stream events from the OpenAI Responses adapter into a
 * single BetaMessage for side-query callers (classifiers, explainers, etc.).
 */
async function collectAnthropicStreamToBetaMessage(
  stream: AsyncIterable<BetaRawMessageStreamEvent>,
  initialModel: string,
): Promise<BetaMessage> {
  let messageId = `msg_side_${Date.now()}`
  let model = initialModel
  let stopReason: BetaMessage['stop_reason'] = 'end_turn'
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const contentBlocks: Record<number, Record<string, unknown>> = {}

  for await (const event of stream) {
    switch (event.type) {
      case 'message_start': {
        messageId = event.message.id
        model = event.message.model || model
        if (event.message.usage) {
          usage = {
            input_tokens: event.message.usage.input_tokens ?? 0,
            output_tokens: event.message.usage.output_tokens ?? 0,
            cache_creation_input_tokens:
              event.message.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens:
              event.message.usage.cache_read_input_tokens ?? 0,
          }
        }
        break
      }
      case 'content_block_start': {
        const cb = event.content_block as unknown as Record<string, unknown>
        if (cb.type === 'tool_use') {
          contentBlocks[event.index] = { ...cb, input: '' }
        } else if (cb.type === 'text') {
          contentBlocks[event.index] = { ...cb, text: '' }
        } else if (cb.type === 'thinking') {
          contentBlocks[event.index] = {
            ...cb,
            thinking: '',
            signature: '',
          }
        } else {
          contentBlocks[event.index] = { ...cb }
        }
        break
      }
      case 'content_block_delta': {
        const block = contentBlocks[event.index]
        if (!block) break
        const delta = event.delta as {
          type: string
          text?: string
          partial_json?: string
          thinking?: string
          signature?: string
        }
        if (delta.type === 'text_delta') {
          block.text = String(block.text ?? '') + String(delta.text ?? '')
        } else if (delta.type === 'input_json_delta') {
          block.input =
            String(block.input ?? '') + String(delta.partial_json ?? '')
        } else if (delta.type === 'thinking_delta') {
          block.thinking =
            String(block.thinking ?? '') + String(delta.thinking ?? '')
        } else if (delta.type === 'signature_delta') {
          block.signature = delta.signature
        }
        break
      }
      case 'message_delta': {
        const delta = event.delta as {
          stop_reason?: BetaMessage['stop_reason']
        }
        if (delta.stop_reason != null) {
          stopReason = delta.stop_reason
        }
        const deltaUsage = (
          event as {
            usage?: {
              input_tokens?: number
              output_tokens?: number
              cache_creation_input_tokens?: number
              cache_read_input_tokens?: number
            }
          }
        ).usage
        if (deltaUsage) {
          if (typeof deltaUsage.input_tokens === 'number') {
            usage.input_tokens = deltaUsage.input_tokens
          }
          if (typeof deltaUsage.output_tokens === 'number') {
            usage.output_tokens = deltaUsage.output_tokens
          }
          if (
            typeof deltaUsage.cache_creation_input_tokens === 'number' &&
            deltaUsage.cache_creation_input_tokens > 0
          ) {
            usage.cache_creation_input_tokens =
              deltaUsage.cache_creation_input_tokens
          }
          if (
            typeof deltaUsage.cache_read_input_tokens === 'number' &&
            deltaUsage.cache_read_input_tokens > 0
          ) {
            usage.cache_read_input_tokens = deltaUsage.cache_read_input_tokens
          }
        }
        break
      }
      default:
        break
    }
  }

  const content = Object.keys(contentBlocks)
    .map(Number)
    .sort((a, b) => a - b)
    .map(index => {
      const block = contentBlocks[index]!
      if (block.type === 'tool_use') {
        const rawInput = block.input
        let parsed: unknown = {}
        if (typeof rawInput === 'string' && rawInput.length > 0) {
          try {
            parsed = JSON.parse(rawInput)
          } catch {
            parsed = {}
          }
        } else if (rawInput && typeof rawInput === 'object') {
          parsed = rawInput
        }
        return {
          type: 'tool_use' as const,
          id: String(block.id ?? `toolu_${index}`),
          name: String(block.name ?? ''),
          input: parsed,
        }
      }
      if (block.type === 'thinking') {
        return {
          type: 'thinking' as const,
          thinking: String(block.thinking ?? ''),
          signature: String(block.signature ?? ''),
        }
      }
      return {
        type: 'text' as const,
        text: String(block.text ?? ''),
      }
    })

  // Forced tool_choice classifiers care about tool_use blocks, not stop_reason
  // from the Responses adapter (which often reports end_turn even with tools).
  if (content.some(b => b.type === 'tool_use') && stopReason === 'end_turn') {
    stopReason = 'tool_use'
  }

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content: content as BetaMessage['content'],
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  } as BetaMessage
}
/**
 * OpenAI Responses side query.
 */
async function sideQueryViaResponses(
  opts: SideQueryOptions,
  openaiModel: string,
  openaiMessages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>,
  openaiTools: unknown[] | undefined,
  openaiToolChoice: unknown,
): Promise<BetaMessage> {
  const start = Date.now()
  const request = buildResponsesRequest({
    model: openaiModel,
    messages: openaiMessages,
    tools: openaiTools ?? [],
    toolChoice: openaiToolChoice,
    maxOutputTokens: opts.max_tokens,
    promptCacheKey: formatOpenAIPromptCacheKey(getSessionId(), openaiModel),
  })

  const rawStream = await createResponsesStream({
    request,
    signal: opts.signal ?? new AbortController().signal,
  })
  const adapted = adaptResponsesStreamToAnthropic(rawStream, openaiModel)
  const betaMessage = await collectAnthropicStreamToBetaMessage(
    adapted,
    openaiModel,
  )

  const now = Date.now()
  const lastCompletion = getLastApiCompletionTimestamp()
  logEvent('tengu_api_success', {
    requestId:
      betaMessage.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      opts.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model:
      openaiModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    inputTokens: betaMessage.usage.input_tokens,
    outputTokens: betaMessage.usage.output_tokens,
    cachedInputTokens: betaMessage.usage.cache_read_input_tokens ?? 0,
    uncachedInputTokens: betaMessage.usage.input_tokens,
    durationMsIncludingRetries: now - start,
    timeSinceLastApiCallMs:
      lastCompletion !== null ? now - lastCompletion : undefined,
  })
  setLastApiCompletionTimestamp(now)

  return betaMessage
}

/**
 * OpenAI-compatible side query.
 * Both use the OpenAI SDK with different base URLs.
 *
 * Converts Anthropic-format params to OpenAI Chat Completions, sends a
 * non-streaming request, and wraps the response back into a BetaMessage
 * shape so callers remain provider-agnostic.
 *
 * Supports tools and tool_choice for structured output (e.g. yoloClassifier,
 * lightweight side queries).
 */
async function sideQueryViaResponsesCompatible(
  opts: SideQueryOptions,
): Promise<BetaMessage> {
  const normalizedModel = normalizeModelStringForAPI(opts.model)
  const openaiModel = resolveOpenAIModel(normalizedModel)
  const openaiMessages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }> = []
  const systemText = extractSystemText(opts.system)
  if (systemText) {
    openaiMessages.push({ role: 'system', content: systemText })
  }
  openaiMessages.push(...messageParamsToOpenAIRoleContent(opts.messages))

  const openaiTools =
    opts.tools && opts.tools.length > 0
      ? anthropicToolsToOpenAI(opts.tools as BetaToolUnion[])
      : undefined
  const openaiToolChoice = opts.tool_choice
    ? anthropicToolChoiceToOpenAI(opts.tool_choice)
    : undefined

  return sideQueryViaResponses(
    opts,
    openaiModel,
    openaiMessages,
    openaiTools,
    openaiToolChoice,
  )
}
