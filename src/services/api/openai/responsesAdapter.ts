import { randomUUID } from 'crypto'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { normalizeOpenAIUsage, type AnthropicUsage } from '@ant/model-provider'
import { logForDebugging } from '../../../utils/debug.js'
import { sleep } from '../../../utils/sleep.js'
import {
  clearProviderRetryAt,
  getProviderRetryAt,
  setProviderRetryAt,
} from './providerRetryState.js'

const MAX_RESPONSES_REQUEST_ATTEMPTS = 10
const MAX_FAILOVER_PROVIDER_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 30_000
const DEFAULT_LONG_RETRY_DELAY_MS = 30 * 60 * 1000

function longRetryDelayMs(): number {
  const configured = Number(process.env.SOPHIA_API_LONG_RETRY_MS)
  return Number.isFinite(configured) && configured >= 1000
    ? Math.trunc(configured)
    : DEFAULT_LONG_RETRY_DELAY_MS
}

function getMaxResponsesRequestAttempts(params: ResponsesStreamParams): number {
  return (params.providers?.length ?? 0) > 1
    ? MAX_FAILOVER_PROVIDER_ATTEMPTS
    : MAX_RESPONSES_REQUEST_ATTEMPTS
}

type ResponsesStreamParams = {
  request: ResponsesRequest
  signal: AbortSignal
  fetchOverride?: typeof fetch
  providers?: ResponsesProviderEndpoint[]
}

export type ResponsesProviderEndpoint = {
  name?: string
  baseUrl: string
  apiKey?: string
}

class ResponsesAPIError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ResponsesAPIError'
  }
}

function longRetryEnabled(
  params: ResponsesStreamParams,
  error: unknown,
): boolean {
  return (
    params.fetchOverride === undefined &&
    process.env.SOPHIA_DISABLE_LONG_API_RETRY !== '1' &&
    !params.signal.aborted &&
    isRetryableTransportError(error)
  )
}

function retryWindowKey(params: ResponsesStreamParams): string {
  return (
    (params.providers ?? [])
      .map(provider => provider.baseUrl)
      .sort()
      .join('|') || 'default'
  )
}

async function waitForLongRetry(
  params: ResponsesStreamParams,
  error: unknown,
): Promise<void> {
  const key = retryWindowKey(params)
  const now = Date.now()
  const existingRetryAt = getProviderRetryAt(key)
  const retryAt =
    existingRetryAt && existingRetryAt > now
      ? existingRetryAt
      : now + longRetryDelayMs()
  setProviderRetryAt(key, retryAt)
  const delayMs = Math.max(0, retryAt - now)
  logForDebugging(
    `[OpenAI Responses] all providers temporarily unavailable; retrying in ${Math.ceil(delayMs / 60000)} minute(s): ${error instanceof Error ? error.message : String(error)}`,
  )
  await sleep(delayMs, params.signal, { throwOnAbort: true })
}

async function fetchResponsesWithLongRetry(
  params: ResponsesStreamParams,
): Promise<ResponsesFetchState> {
  while (true) {
    try {
      const retryAt = getProviderRetryAt(retryWindowKey(params))
      if (retryAt && retryAt > Date.now()) {
        await sleep(retryAt - Date.now(), params.signal, {
          throwOnAbort: true,
        })
      }
      const state = await fetchResponsesWithFailover(params, 0)
      clearProviderRetryAt(retryWindowKey(params))
      return state
    } catch (error) {
      if (!longRetryEnabled(params, error)) throw error
      await waitForLongRetry(params, error)
    }
  }
}

type ResponsesInputItem = Record<string, unknown>
type ResponsesTool = Record<string, unknown>
export type ResponsesReasoningEffort =
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

type ResponsesRequest = {
  model: string
  stream: true
  store: false
  input: ResponsesInputItem[]
  instructions?: string
  tools?: ResponsesTool[]
  tool_choice?: unknown
  reasoning?: { effort: ResponsesReasoningEffort }
  max_output_tokens?: number
  parallel_tool_calls?: boolean
  /** Sticky cache routing key, stable for the Sophia session. */
  prompt_cache_key: string
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function convertUserContent(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return textFromContent(content)
  const result: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      result.push({ type: 'input_text', text: record.text })
    } else if (record.type === 'image_url') {
      const imageUrl = record.image_url as Record<string, unknown> | undefined
      if (typeof imageUrl?.url === 'string') {
        result.push({ type: 'input_image', image_url: imageUrl.url })
      }
    }
  }
  return result.length > 0 ? result : textFromContent(content)
}

function convertMessagesToResponsesInput(messages: unknown[]): {
  input: ResponsesInputItem[]
  instructions?: string
} {
  const input: ResponsesInputItem[] = []
  const instructions: string[] = []

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    const role = record.role

    if (role === 'system' || role === 'developer') {
      const text = textFromContent(record.content)
      if (text) instructions.push(text)
      continue
    }

    if (role === 'tool') {
      const callId = record.tool_call_id
      if (typeof callId === 'string') {
        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: textFromContent(record.content),
        })
      }
      continue
    }

    if (role === 'assistant') {
      const text = textFromContent(record.content)
      if (text) {
        input.push({ role: 'assistant', content: text })
      }
      const toolCalls = record.tool_calls
      if (Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          if (!toolCall || typeof toolCall !== 'object') continue
          const tc = toolCall as Record<string, unknown>
          const fn = tc.function as Record<string, unknown> | undefined
          const id = typeof tc.id === 'string' ? tc.id : undefined
          const name = typeof fn?.name === 'string' ? fn.name : undefined
          if (!id || !name) continue
          input.push({
            type: 'function_call',
            call_id: id,
            name,
            arguments: typeof fn?.arguments === 'string' ? fn.arguments : '{}',
          })
        }
      }
      continue
    }

    if (role === 'user') {
      input.push({
        role: 'user',
        content: convertUserContent(record.content),
      })
    }
  }

  return {
    input,
    instructions:
      instructions.length > 0 ? instructions.join('\n\n') : undefined,
  }
}

function convertToolsToResponses(tools: unknown[]): ResponsesTool[] {
  const result: ResponsesTool[] = []
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue
    const record = tool as Record<string, unknown>
    const fn = record.function as Record<string, unknown> | undefined
    const name = typeof fn?.name === 'string' ? fn.name : undefined
    if (!name) continue
    result.push({
      type: 'function',
      name,
      description: typeof fn?.description === 'string' ? fn.description : '',
      parameters:
        fn?.parameters && typeof fn.parameters === 'object'
          ? fn.parameters
          : { type: 'object', properties: {} },
      strict: false,
    })
  }
  return result
}

function convertToolChoiceToResponses(toolChoice: unknown): unknown {
  if (toolChoice === 'required') return 'required'
  if (toolChoice === 'auto') return 'auto'
  if (!toolChoice || typeof toolChoice !== 'object') return toolChoice
  const record = toolChoice as Record<string, unknown>
  const fn = record.function as Record<string, unknown> | undefined
  if (record.type === 'function' && typeof fn?.name === 'string') {
    return { type: 'function', name: fn.name }
  }
  return toolChoice
}

export function buildResponsesRequest(params: {
  model: string
  messages: unknown[]
  tools: unknown[]
  toolChoice: unknown
  reasoningEffort?: ResponsesReasoningEffort
  maxOutputTokens?: number
  /** Session-scoped key used for stable prompt-cache routing. */
  promptCacheKey: string
}): ResponsesRequest {
  const { input, instructions } = convertMessagesToResponsesInput(
    params.messages,
  )
  const tools = convertToolsToResponses(params.tools)
  return {
    model: params.model,
    stream: true,
    store: false,
    input,
    ...(instructions ? { instructions } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(params.toolChoice
      ? { tool_choice: convertToolChoiceToResponses(params.toolChoice) }
      : {}),
    ...(params.reasoningEffort
      ? { reasoning: { effort: params.reasoningEffort } }
      : {}),
    ...(params.maxOutputTokens !== undefined
      ? { max_output_tokens: params.maxOutputTokens }
      : {}),
    parallel_tool_calls: true,
    // Same Sophia session -> same key so OpenAI can sticky-route to a cache node.
    // Must not hash the full message list (would change every turn).
    prompt_cache_key: params.promptCacheKey,
  }
}

async function* parseSSE(
  response: Response,
): AsyncGenerator<Record<string, unknown>, void> {
  if (!response.body) {
    throw new Error('OpenAI Responses API response did not include a body')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let splitAt = buffer.indexOf('\n\n')
    while (splitAt >= 0) {
      const frame = buffer.slice(0, splitAt)
      buffer = buffer.slice(splitAt + 2)
      const data = frame
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (data && data !== '[DONE]') {
        const parsed = JSON.parse(data) as unknown
        if (parsed && typeof parsed === 'object') {
          yield parsed as Record<string, unknown>
        }
      }
      splitAt = buffer.indexOf('\n\n')
    }
  }
}

/**
 * Map OpenAI Responses usage → Anthropic-style mutually exclusive fields.
 *
 * OpenAI:  input_tokens is TOTAL input; cached_tokens ⊆ input_tokens;
 *          cache_write_tokens (GPT-5.6+) reports tokens written this turn.
 * Anthropic: input + cache_creation + cache_read are disjoint and sum to total.
 *
 * Without subtracting cached from input, the displayed hit rate becomes
 * cached/(total+cached) with a hard ceiling of 50%.
 */
export function extractUsage(
  response: Record<string, unknown> | undefined,
): AnthropicUsage {
  const usage = response?.usage as Record<string, unknown> | undefined
  const inputDetails = usage?.input_tokens_details as
    | Record<string, unknown>
    | undefined

  const totalInput =
    typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0
  const outputTokens =
    typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0

  const cachedRaw =
    typeof inputDetails?.cached_tokens === 'number'
      ? inputDetails.cached_tokens
      : 0
  const writeRaw =
    typeof inputDetails?.cache_write_tokens === 'number'
      ? inputDetails.cache_write_tokens
      : 0

  return normalizeOpenAIUsage({
    totalInputTokens: totalInput,
    outputTokens,
    cacheReadTokens: cachedRaw,
    cacheWriteTokens: writeRaw,
  })
}

function mapStopReason(response: Record<string, unknown> | undefined): string {
  if (response?.status === 'incomplete') return 'max_tokens'
  return 'end_turn'
}

function isRetryableResponseStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

function getRetryDelayMs(response: Response, attempt: number): number {
  const retryAfterMs = Number(response.headers.get('retry-after-ms'))
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS)
  }

  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
    }
    const retryAt = Date.parse(retryAfter)
    if (Number.isFinite(retryAt)) {
      return Math.min(Math.max(0, retryAt - Date.now()), MAX_RETRY_DELAY_MS)
    }
  }

  return Math.min(500 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
}

function compactErrorText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isRetryableErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('concurrency limit') ||
    normalized.includes('rate_limit') ||
    normalized.includes('rate limit') ||
    normalized.includes('overloaded') ||
    normalized.includes('temporarily unavailable') ||
    normalized.includes('upstream request failed') ||
    normalized.includes('bad gateway') ||
    normalized.includes('connection reset') ||
    normalized.includes('connection was closed') ||
    normalized.includes('econnreset') ||
    normalized.includes('fetch failed')
  )
}

function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof ResponsesAPIError) return error.retryable
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError' || error.message === 'user-cancel')
    return false
  const code = (error as Error & { code?: unknown }).code
  return (
    (typeof code === 'string' &&
      ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(code)) ||
    error instanceof TypeError ||
    isRetryableErrorMessage(error.message)
  )
}

function getErrorRecord(
  event: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (event.type === 'response.failed') {
    const response = event.response as Record<string, unknown> | undefined
    return response?.error as Record<string, unknown> | undefined
  }
  if (event.type === 'response.error' || event.type === 'error') {
    return event.error as Record<string, unknown> | undefined
  }
  return undefined
}

function getStreamError(
  event: Record<string, unknown>,
): ResponsesAPIError | undefined {
  if (
    event.type !== 'response.failed' &&
    event.type !== 'response.error' &&
    event.type !== 'error'
  ) {
    return undefined
  }

  const error = getErrorRecord(event)
  const rawMessage = compactErrorText(error?.message ?? event.message)
  const code = typeof error?.code === 'string' ? error.code : undefined
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof event.status === 'number'
        ? event.status
        : undefined
  const retryable =
    (status !== undefined && isRetryableResponseStatus(status)) ||
    isRetryableErrorMessage(`${code ?? ''} ${rawMessage}`)
  const message = rawMessage || 'Provider returned a failed Responses stream.'
  return new ResponsesAPIError(message, retryable, status, code)
}

function isSemanticOutputEvent(event: Record<string, unknown>): boolean {
  if (
    event.type === 'response.output_text.delta' ||
    event.type === 'response.reasoning_text.delta' ||
    event.type === 'response.function_call_arguments.delta'
  ) {
    return true
  }
  if (event.type !== 'response.output_item.added') return false
  const item = event.item as Record<string, unknown> | undefined
  return item?.type === 'function_call' || item?.type === 'message'
}

function isTerminalResponseEvent(event: Record<string, unknown>): boolean {
  return (
    event.type === 'response.completed' || event.type === 'response.incomplete'
  )
}

async function readResponseBodyPrefix(
  response: Response,
  limit = 16_384,
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let result = ''
  try {
    while (result.length < limit) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value, { stream: true })
    }
    result += decoder.decode()
    return result.slice(0, limit)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function createHTTPError(response: Response): Promise<ResponsesAPIError> {
  const rawBody = await readResponseBodyPrefix(response).catch(() => '')
  let detail = ''
  if (rawBody.trim().startsWith('{')) {
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>
      const error = body.error as Record<string, unknown> | undefined
      detail = compactErrorText(error?.message ?? body.message)
    } catch {
      detail = compactErrorText(rawBody)
    }
  } else if (!/<(?:!doctype|html|head|body)\b/i.test(rawBody)) {
    detail = compactErrorText(rawBody)
  }

  const statusLabel = response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status)
  const message = `Provider request failed (HTTP ${statusLabel})${detail ? `: ${detail.slice(0, 300)}` : '.'}`
  return new ResponsesAPIError(
    message,
    isRetryableResponseStatus(response.status),
    response.status,
  )
}

type ResponsesFetchState = {
  response: Response
  attempt: number
  providerIndex: number
}

async function fetchResponses(
  params: ResponsesStreamParams,
  firstAttempt: number,
  providerIndex: number,
): Promise<ResponsesFetchState> {
  const endpoint = params.providers?.[providerIndex]
  const apiKey = (
    endpoint ? endpoint.apiKey : process.env.OPENAI_API_KEY
  )?.trim()
  const baseUrl = (
    endpoint?.baseUrl ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1'
  ).replace(/\/+$/, '')
  const fetchFn = params.fetchOverride ?? (globalThis.fetch as typeof fetch)
  const headers: Record<string, string> = {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  const body = JSON.stringify(params.request)
  const maxAttempts = getMaxResponsesRequestAttempts(params)

  for (let attempt = firstAttempt; attempt <= maxAttempts; attempt += 1) {
    params.signal.throwIfAborted()
    let response: Response
    try {
      response = await fetchFn(`${baseUrl}/responses`, {
        method: 'POST',
        headers,
        body,
        signal: params.signal,
      })
    } catch (error) {
      if (!isRetryableTransportError(error) || attempt === maxAttempts) {
        throw error
      }
      const retryDelayMs = Math.min(
        500 * 2 ** (attempt - 1),
        MAX_RETRY_DELAY_MS,
      )
      logForDebugging(
        `[OpenAI Responses] retrying transport error, attempt=${attempt + 1}/${MAX_RESPONSES_REQUEST_ATTEMPTS}, delay_ms=${retryDelayMs}`,
      )
      await sleep(retryDelayMs, params.signal, { throwOnAbort: true })
      continue
    }

    if (response.ok) return { response, attempt, providerIndex }
    const retryDelayMs = getRetryDelayMs(response, attempt)
    const responseError = await createHTTPError(response)
    if (!responseError.retryable || attempt === maxAttempts) {
      throw responseError
    }

    logForDebugging(
      `[OpenAI Responses] retrying status=${response.status}, attempt=${attempt + 1}/${MAX_RESPONSES_REQUEST_ATTEMPTS}, delay_ms=${retryDelayMs}`,
    )
    await sleep(retryDelayMs, params.signal, { throwOnAbort: true })
  }

  throw new ResponsesAPIError(
    'Provider request failed without receiving a response.',
    false,
  )
}

async function fetchResponsesWithFailover(
  params: ResponsesStreamParams,
  firstProviderIndex: number,
): Promise<ResponsesFetchState> {
  let lastError: unknown
  const providerCount = params.providers?.length ?? 0
  for (
    let providerIndex = firstProviderIndex;
    providerIndex < providerCount;
    providerIndex++
  ) {
    try {
      return await fetchResponses(params, 1, providerIndex)
    } catch (error) {
      lastError = error
      if (!isRetryableTransportError(error)) throw error
      const nextProvider = params.providers?.[providerIndex + 1]
      if (nextProvider) {
        logForDebugging(
          `[OpenAI Responses] provider failed, switching to ${nextProvider.name ?? 'next provider'}`,
        )
      }
    }
  }
  throw lastError ?? new Error('No provider endpoint available')
}
async function* streamResponsesWithRetry(
  params: ResponsesStreamParams,
  initialState: ResponsesFetchState,
): AsyncGenerator<Record<string, unknown>, void> {
  let state = initialState
  while (true) {
    let outputStarted = false
    let completed = false
    try {
      for await (const event of parseSSE(state.response)) {
        const streamError = getStreamError(event)
        if (streamError) throw streamError
        if (isSemanticOutputEvent(event)) outputStarted = true
        if (isTerminalResponseEvent(event)) completed = true
        yield event
      }
      if (!completed) {
        throw new ResponsesAPIError(
          'Provider closed the Responses stream before completion.',
          true,
        )
      }
      return
    } catch (error) {
      if (
        outputStarted ||
        params.signal.aborted ||
        !isRetryableTransportError(error)
      ) {
        throw error
      }
      if (state.attempt === getMaxResponsesRequestAttempts(params)) {
        const nextProviderIndex = state.providerIndex + 1
        if (nextProviderIndex >= (params.providers?.length ?? 0)) {
          if (!longRetryEnabled(params, error)) throw error
          await state.response.body?.cancel().catch(() => undefined)
          await waitForLongRetry(params, error)
          state = await fetchResponsesWithLongRetry(params)
          continue
        }
        await state.response.body?.cancel().catch(() => undefined)
        logForDebugging(
          `[OpenAI Responses] stream failed, switching to ${params.providers?.[nextProviderIndex]?.name ?? 'next provider'}`,
        )
        state = await fetchResponsesWithFailover(params, nextProviderIndex)
        continue
      }

      const retryDelayMs = getRetryDelayMs(state.response, state.attempt)
      logForDebugging(
        `[OpenAI Responses] retrying stream error, attempt=${state.attempt + 1}/${MAX_RESPONSES_REQUEST_ATTEMPTS}, delay_ms=${retryDelayMs}`,
      )
      await state.response.body?.cancel().catch(() => undefined)
      await sleep(retryDelayMs, params.signal, { throwOnAbort: true })
      state = await fetchResponses(
        params,
        state.attempt + 1,
        state.providerIndex,
      )
    }
  }
}

export async function* adaptResponsesStreamToAnthropic(
  stream: AsyncIterable<Record<string, unknown>>,
  model: string,
): AsyncGenerator<BetaRawMessageStreamEvent, void> {
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const toolBlocks = new Map<
    number,
    { contentIndex: number; open: boolean; name: string; id: string }
  >()
  let started = false
  let currentContentIndex = -1
  let textBlockOpen = false
  let thinkingBlockOpen = false

  const ensureStarted = async function* () {
    if (started) return
    started = true
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    } as unknown as BetaRawMessageStreamEvent
  }

  for await (const event of stream) {
    for await (const startedEvent of ensureStarted()) yield startedEvent
    const type = event.type

    if (type === 'response.output_text.delta') {
      if (!textBlockOpen) {
        if (thinkingBlockOpen) {
          yield {
            type: 'content_block_stop',
            index: currentContentIndex,
          } as BetaRawMessageStreamEvent
          thinkingBlockOpen = false
        }
        currentContentIndex++
        textBlockOpen = true
        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: { type: 'text', text: '' },
        } as BetaRawMessageStreamEvent
      }
      yield {
        type: 'content_block_delta',
        index: currentContentIndex,
        delta: { type: 'text_delta', text: String(event.delta ?? '') },
      } as BetaRawMessageStreamEvent
      continue
    }

    if (type === 'response.reasoning_text.delta') {
      if (!thinkingBlockOpen) {
        if (textBlockOpen) {
          yield {
            type: 'content_block_stop',
            index: currentContentIndex,
          } as BetaRawMessageStreamEvent
          textBlockOpen = false
        }
        currentContentIndex++
        thinkingBlockOpen = true
        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        } as BetaRawMessageStreamEvent
      }
      yield {
        type: 'content_block_delta',
        index: currentContentIndex,
        delta: { type: 'thinking_delta', thinking: String(event.delta ?? '') },
      } as BetaRawMessageStreamEvent
      continue
    }

    if (type === 'response.output_item.added') {
      const item = event.item as Record<string, unknown> | undefined
      const outputIndex =
        typeof event.output_index === 'number' ? event.output_index : -1
      if (item?.type === 'function_call' && outputIndex >= 0) {
        if (textBlockOpen) {
          yield {
            type: 'content_block_stop',
            index: currentContentIndex,
          } as BetaRawMessageStreamEvent
          textBlockOpen = false
        }
        if (thinkingBlockOpen) {
          yield {
            type: 'content_block_stop',
            index: currentContentIndex,
          } as BetaRawMessageStreamEvent
          thinkingBlockOpen = false
        }
        currentContentIndex++
        const id = String(item.call_id ?? item.id ?? `call_${outputIndex}`)
        const name = String(item.name ?? '')
        toolBlocks.set(outputIndex, {
          contentIndex: currentContentIndex,
          open: true,
          name,
          id,
        })
        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: { type: 'tool_use', id, name, input: {} },
        } as BetaRawMessageStreamEvent
      }
      continue
    }

    if (type === 'response.function_call_arguments.delta') {
      const outputIndex =
        typeof event.output_index === 'number' ? event.output_index : -1
      const block = toolBlocks.get(outputIndex)
      if (block) {
        yield {
          type: 'content_block_delta',
          index: block.contentIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: String(event.delta ?? ''),
          },
        } as BetaRawMessageStreamEvent
      }
      continue
    }

    if (type === 'response.output_item.done') {
      const outputIndex =
        typeof event.output_index === 'number' ? event.output_index : -1
      const block = toolBlocks.get(outputIndex)
      if (block?.open) {
        yield {
          type: 'content_block_stop',
          index: block.contentIndex,
        } as BetaRawMessageStreamEvent
        block.open = false
      }
      continue
    }

    const streamError = getStreamError(event)
    if (streamError) throw streamError

    if (type === 'response.completed' || type === 'response.incomplete') {
      if (textBlockOpen) {
        yield {
          type: 'content_block_stop',
          index: currentContentIndex,
        } as BetaRawMessageStreamEvent
        textBlockOpen = false
      }
      if (thinkingBlockOpen) {
        yield {
          type: 'content_block_stop',
          index: currentContentIndex,
        } as BetaRawMessageStreamEvent
        thinkingBlockOpen = false
      }
      const response = event.response as Record<string, unknown> | undefined
      yield {
        type: 'message_delta',
        delta: { stop_reason: mapStopReason(response), stop_sequence: null },
        usage: extractUsage(response),
      } as unknown as BetaRawMessageStreamEvent
      yield { type: 'message_stop' } as BetaRawMessageStreamEvent
    }
  }
}

export async function createResponsesStream(
  params: ResponsesStreamParams,
): Promise<AsyncIterable<Record<string, unknown>>> {
  const body = JSON.stringify(params.request)
  logForDebugging(
    `[OpenAI Responses] request bytes=${Buffer.byteLength(body, 'utf8')}, input_items=${params.request.input.length}, instructions_chars=${params.request.instructions?.length ?? 0}, tools=${params.request.tools?.length ?? 0}, max_output_tokens=${params.request.max_output_tokens ?? 'unset'}`,
  )
  const providers = params.providers?.length
    ? params.providers
    : [
        {
          baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
          apiKey: process.env.OPENAI_API_KEY,
        },
      ]
  const requestParams = { ...params, providers }
  const initialState = await fetchResponsesWithLongRetry(requestParams)
  return streamResponsesWithRetry(requestParams, initialState)
}
