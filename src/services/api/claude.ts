import type { ClientOptions } from '@anthropic-ai/sdk'
import { APIUserAbortError } from '@anthropic-ai/sdk/error'
import type {
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaJSONOutputFormat,
  BetaMessageDeltaUsage,
  BetaRequestDocumentBlock,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { NonNullableUsage } from '@ant/model-provider'
import type { AgentDefinition } from '@sophia-agent/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { Notification } from '../../context/notifications.js'
import type { QuerySource } from '../../constants/querySource.js'
import { API_MAX_MEDIA_PER_REQUEST } from '../../constants/apiLimits.js'
import type { AgentId } from '../../types/ids.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../../types/message.js'
import {
  getEmptyToolSafetyContext,
  type QueryChainTracking,
  type ToolSafetyContext,
  type Tools,
} from '../../Tool.js'
import type { EffortValue } from '../../utils/effort.js'
import {
  createUserMessage,
  ensureToolResultPairing,
  normalizeMessagesForAPI,
  stripAdvisorBlocks,
  stripCallerFieldFromAssistantMessage,
  stripToolReferenceBlocksFromUserMessage,
} from '../../utils/messages.js'
import { projectCompletedWorkNodes } from '../../tasks/workNodes.js'
import { getSmallFastModel } from '../../utils/model/model.js'
import { queryCheckpoint } from '../../utils/queryProfiler.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import {
  CAPPED_DEFAULT_MAX_TOKENS,
  getModelMaxOutputTokens,
} from '../../utils/context.js'
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js'
import type { LangfuseSpan } from '../langfuse/index.js'
import { withStreamingVCR, withVCR } from '../vcr.js'

export type Options = {
  getToolSafetyContext: () => Promise<ToolSafetyContext>
  model: string
  providerName?: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  agentId?: AgentId
  outputFormat?: BetaJSONOutputFormat
  advisorModel?: string
  addNotification?: (notification: Notification) => void
  taskBudget?: { total: number; remaining?: number }
  langfuseTrace?: LangfuseSpan | null
}

export function getCacheControl(_options?: unknown): { type: 'ephemeral' } {
  return { type: 'ephemeral' }
}

export async function queryModelWithoutStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<AssistantMessage> {
  let assistantMessage: AssistantMessage | undefined
  for await (const message of withStreamingVCR(messages, async function* () {
    yield* queryModel(
      messages,
      systemPrompt,
      thinkingConfig,
      tools,
      signal,
      options,
    )
  })) {
    if (message.type === 'assistant') {
      assistantMessage = message as AssistantMessage
    }
  }

  if (assistantMessage) return assistantMessage
  if (signal.aborted) throw new APIUserAbortError()
  throw new Error('No assistant message found')
}

export async function* queryModelWithStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  yield* withStreamingVCR(messages, async function* () {
    yield* queryModel(
      messages,
      systemPrompt,
      thinkingConfig,
      tools,
      signal,
      options,
    )
  })
}

async function* queryModel(
  messages: Message[],
  systemPrompt: SystemPrompt,
  _thinkingConfig: ThinkingConfig,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  queryCheckpoint('query_message_normalization_start')
  let normalized = normalizeMessagesForAPI(messages, tools).map(message => {
    if (message.type === 'user') {
      return stripToolReferenceBlocksFromUserMessage(message)
    }
    if (message.type === 'assistant') {
      return stripCallerFieldFromAssistantMessage(message)
    }
    return message
  })
  normalized = ensureToolResultPairing(normalized)
  normalized = projectCompletedWorkNodes(normalized)
  normalized = stripAdvisorBlocks(normalized)
  normalized = stripExcessMediaItems(normalized, API_MAX_MEDIA_PER_REQUEST)
  queryCheckpoint('query_message_normalization_end')

  const { queryModelOpenAI } = await import('./openai/index.js')
  yield* queryModelOpenAI(normalized, systemPrompt, tools, signal, options)
}

function isMedia(
  block: BetaContentBlockParam,
): block is BetaImageBlockParam | BetaRequestDocumentBlock {
  return block.type === 'image' || block.type === 'document'
}

function isToolResult(
  block: BetaContentBlockParam,
): block is BetaToolResultBlockParam {
  return block.type === 'tool_result'
}

export function stripExcessMediaItems(
  messages: (UserMessage | AssistantMessage)[],
  limit: number,
): (UserMessage | AssistantMessage)[] {
  let toRemove = 0
  for (const message of messages) {
    if (!Array.isArray(message.message.content)) continue
    for (const block of message.message.content) {
      if (isMedia(block)) toRemove++
      if (isToolResult(block) && Array.isArray(block.content)) {
        for (const nested of block.content) {
          if (isMedia(nested as BetaContentBlockParam)) toRemove++
        }
      }
    }
  }

  toRemove -= limit
  if (toRemove <= 0) return messages

  return messages.map(message => {
    if (toRemove <= 0 || !Array.isArray(message.message.content)) {
      return message
    }

    const original = message.message.content
    const content = original
      .map(block => {
        if (!isToolResult(block) || !Array.isArray(block.content)) return block
        const nested = block.content.filter(item => {
          if (toRemove > 0 && isMedia(item as BetaContentBlockParam)) {
            toRemove--
            return false
          }
          return true
        })
        return nested.length === block.content.length
          ? block
          : { ...block, content: nested }
      })
      .filter(block => {
        if (toRemove > 0 && isMedia(block)) {
          toRemove--
          return false
        }
        return true
      })

    return content.length === original.length
      ? message
      : { ...message, message: { ...message.message, content } }
  }) as (UserMessage | AssistantMessage)[]
}

export function updateUsage(
  usage: Readonly<NonNullableUsage>,
  partUsage: BetaMessageDeltaUsage | undefined,
): NonNullableUsage {
  if (!partUsage) return { ...usage }
  return {
    input_tokens:
      partUsage.input_tokens !== null && partUsage.input_tokens > 0
        ? partUsage.input_tokens
        : usage.input_tokens,
    cache_creation_input_tokens:
      partUsage.cache_creation_input_tokens !== null &&
      partUsage.cache_creation_input_tokens > 0
        ? partUsage.cache_creation_input_tokens
        : usage.cache_creation_input_tokens,
    cache_read_input_tokens:
      partUsage.cache_read_input_tokens !== null &&
      partUsage.cache_read_input_tokens > 0
        ? partUsage.cache_read_input_tokens
        : usage.cache_read_input_tokens,
    output_tokens: partUsage.output_tokens ?? usage.output_tokens,
    server_tool_use: {
      web_search_requests:
        partUsage.server_tool_use?.web_search_requests ??
        usage.server_tool_use.web_search_requests,
      web_fetch_requests:
        partUsage.server_tool_use?.web_fetch_requests ??
        usage.server_tool_use.web_fetch_requests,
    },
    service_tier: usage.service_tier,
    cache_creation: {
      ephemeral_1h_input_tokens:
        (partUsage as BetaUsage).cache_creation?.ephemeral_1h_input_tokens ??
        usage.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        (partUsage as BetaUsage).cache_creation?.ephemeral_5m_input_tokens ??
        usage.cache_creation.ephemeral_5m_input_tokens,
    },
    inference_geo: usage.inference_geo,
    iterations: partUsage.iterations ?? usage.iterations,
    speed: (partUsage as BetaUsage).speed ?? usage.speed,
  }
}

export function accumulateUsage(
  total: Readonly<NonNullableUsage>,
  current: Readonly<NonNullableUsage>,
): NonNullableUsage {
  return {
    input_tokens: total.input_tokens + current.input_tokens,
    cache_creation_input_tokens:
      total.cache_creation_input_tokens + current.cache_creation_input_tokens,
    cache_read_input_tokens:
      total.cache_read_input_tokens + current.cache_read_input_tokens,
    output_tokens: total.output_tokens + current.output_tokens,
    server_tool_use: {
      web_search_requests:
        total.server_tool_use.web_search_requests +
        current.server_tool_use.web_search_requests,
      web_fetch_requests:
        total.server_tool_use.web_fetch_requests +
        current.server_tool_use.web_fetch_requests,
    },
    service_tier: current.service_tier,
    cache_creation: {
      ephemeral_1h_input_tokens:
        total.cache_creation.ephemeral_1h_input_tokens +
        current.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        total.cache_creation.ephemeral_5m_input_tokens +
        current.cache_creation.ephemeral_5m_input_tokens,
    },
    inference_geo: current.inference_geo,
    iterations: current.iterations,
    speed: current.speed,
  }
}

type FastModelOptions = Omit<Options, 'model' | 'getToolSafetyContext'>

export async function queryFastModel({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: FastModelOptions
}): Promise<AssistantMessage> {
  const result = await withVCR(
    [createUserMessage({ content: userPrompt })],
    async () => [
      await queryModelWithoutStreaming({
        messages: [createUserMessage({ content: userPrompt })],
        systemPrompt,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal,
        options: {
          ...options,
          model: getSmallFastModel(),
          outputFormat,
          getToolSafetyContext: async () => getEmptyToolSafetyContext(),
        },
      }),
    ],
  )
  return result[0] as AssistantMessage
}

type QueryWithModelOptions = Omit<Options, 'getToolSafetyContext'>

export async function queryWithModel({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: QueryWithModelOptions
}): Promise<AssistantMessage> {
  const result = await withVCR(
    [createUserMessage({ content: userPrompt })],
    async () => [
      await queryModelWithoutStreaming({
        messages: [createUserMessage({ content: userPrompt })],
        systemPrompt,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal,
        options: {
          ...options,
          outputFormat,
          getToolSafetyContext: async () => getEmptyToolSafetyContext(),
        },
      }),
    ],
  )
  return result[0] as AssistantMessage
}

export function getMaxOutputTokensForModel(model: string): number {
  const limits = getModelMaxOutputTokens(model)
  const result = validateBoundedIntEnvVar(
    'SOPHIA_MAX_OUTPUT_TOKENS',
    process.env.SOPHIA_MAX_OUTPUT_TOKENS,
    Math.min(limits.default, CAPPED_DEFAULT_MAX_TOKENS),
    limits.upperLimit,
  )
  return result.effective
}
