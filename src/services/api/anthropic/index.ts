/**
 * Native Anthropic Messages provider path.
 *
 * Sophia's internal message representation is already Anthropic-shaped, so
 * this path needs no wire conversion: it streams BetaRawMessageStreamEvent
 * items straight from the API and shares assembly with the OpenAI path via
 * consumeAnthropicStream().
 *
 * Endpoint shape: provider profile `protocol: 'anthropic-messages'` with
 * `baseUrl` pointing at the API root (a trailing `/v1` is stripped).
 */
import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../../../types/message.js'
import type { Tools } from '../../../Tool.js'
import { getSessionId } from '../../../bootstrap/state.js'
import { consumeAnthropicStream } from '../shared/anthropicStream.js'
import { normalizeMessagesForAPI } from '../../../utils/messages.js'
import { toolToAPISchema } from '../../../utils/api.js'
import { logForDebugging } from '../../../utils/debug.js'
import { addToTotalSessionCost } from '../../../cost-tracker.js'
import { calculateUSDCost } from '../../../utils/modelCost.js'
import { resolveOpenAIMaxTokens } from '../openai/requestBody.js'
import { recordLLMObservation } from '../../../services/langfuse/tracing.js'
import {
  convertMessagesToLangfuse,
  convertOutputToLangfuse,
  convertToolsToLangfuse,
} from '../../../services/langfuse/convert.js'
import { getModelMaxOutputTokens } from '../../../utils/context.js'
import type { Options } from '../claude.js'
import { createAssistantAPIErrorMessage } from '../../../utils/messages.js'
import type { SDKAssistantMessageError } from '../../../entrypoints/agentSdkTypes.js'
import {
  DEFAULT_EFFORT_LEVEL,
  type EffortValue,
} from '../../../utils/effort.js'
import { getInitialSettings } from '../../../utils/settings/settings.js'
import { getProviderApiKey } from '../../../utils/providerCredentials.js'
import { getConfiguredProviderNameForModel } from '../../../utils/model/providers.js'
import type { ProviderProfiles } from '../../../utils/providerProfiles.js'

type AnthropicProviderEndpoint = {
  name?: string
  baseUrl?: string
  apiKey?: string
}

/**
 * Resolve the provider endpoint for a native Anthropic request. Falls back
 * to the ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY environment that
 * providerProfileToEnvironment installs for the main-role profile.
 */
export function resolveAnthropicProviderEndpoint(
  requestedProvider: string | undefined,
  model: string,
  settings = getInitialSettings(),
): AnthropicProviderEndpoint {
  const providers = (settings.providers ?? {}) as ProviderProfiles
  const configured = getConfiguredProviderNameForModel(model, settings)
  const name =
    requestedProvider && providers[requestedProvider]
      ? requestedProvider
      : (configured ?? requestedProvider)
  const profile = name ? providers[name] : undefined
  if (profile?.protocol === 'anthropic-messages') {
    return {
      name,
      baseUrl: profile.baseUrl,
      apiKey: name ? getProviderApiKey(name) : undefined,
    }
  }
  return { name }
}

function isAnthropicConvertibleMessage(
  msg: Message,
): msg is AssistantMessage | UserMessage {
  return msg.type === 'assistant' || msg.type === 'user'
}

function toAnthropicMessageParam(
  msg: AssistantMessage | UserMessage,
): BetaMessageParam {
  const content = msg.message.content
  return {
    role: msg.message.role,
    content:
      typeof content === 'string'
        ? [{ type: 'text' as const, text: content }]
        : (content as BetaMessageParam['content']),
  } as BetaMessageParam
}

function toAnthropicSystemBlocks(
  systemPrompt: SystemPrompt,
  enableCache: boolean,
): BetaTextBlockParam[] | undefined {
  const texts = systemPrompt.filter(t => t && t.length > 0)
  if (texts.length === 0) return undefined
  const blocks = texts.map(
    text => ({ type: 'text' as const, text }) as BetaTextBlockParam,
  )
  if (enableCache) {
    const last = blocks[blocks.length - 1]
    if (last) last.cache_control = { type: 'ephemeral' }
  }
  return blocks
}

/** Keep only custom tools the Messages API accepts (name + input_schema). */
export function isStandardAnthropicTool(t: unknown): t is BetaToolUnion {
  const rec = t as unknown as Record<string, unknown>
  return typeof rec.name === 'string' && 'input_schema' in rec
}

type AnthropicEffort = 'low' | 'medium' | 'high' | 'max'

function toAnthropicEffort(
  effortValue: EffortValue | undefined,
): AnthropicEffort {
  const v = process.env.SOPHIA_EFFORT_LEVEL?.toLowerCase() ?? effortValue
  if (typeof v === 'number') return 'high'
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'max') return v
  if (v === 'xhigh') return 'high'
  return DEFAULT_EFFORT_LEVEL === 'xhigh' ? 'high' : DEFAULT_EFFORT_LEVEL
}

export function anthropicClientForEndpoint(
  endpoint: AnthropicProviderEndpoint,
  fetchOverride?: typeof fetch,
): Anthropic {
  return new Anthropic({
    apiKey: endpoint.apiKey ?? process.env.ANTHROPIC_API_KEY,
    // Anthropic SDK appends /v1/messages itself; accept a /v1-suffixed
    // baseUrl anyway since provider profiles for other protocols use it.
    baseURL:
      endpoint.baseUrl?.replace(/\/v1\/?$/, '') ??
      process.env.ANTHROPIC_BASE_URL,
    maxRetries: 2,
    ...(fetchOverride ? { fetch: fetchOverride } : {}),
  })
}

export function buildAnthropicRequestParams(params: {
  model: string
  messages: BetaMessageParam[]
  system?: BetaTextBlockParam[]
  tools?: BetaToolUnion[]
  toolChoice?: Options['toolChoice']
  maxTokens: number
  effortValue?: EffortValue
  outputFormat?: Options['outputFormat']
  metadataUserId?: string
}): Anthropic.Beta.Messages.MessageCreateParamsStreaming {
  const outputConfig: Anthropic.Beta.Messages.BetaOutputConfig = {
    effort: toAnthropicEffort(params.effortValue),
    ...(params.outputFormat ? { format: params.outputFormat } : {}),
  }
  return {
    model: params.model,
    messages: params.messages,
    ...(params.system ? { system: params.system } : {}),
    ...(params.tools?.length ? { tools: params.tools } : {}),
    ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
    max_tokens: params.maxTokens,
    stream: true,
    output_config: outputConfig,
    ...(params.metadataUserId
      ? { metadata: { user_id: params.metadataUserId } }
      : {}),
  } as Anthropic.Beta.Messages.MessageCreateParamsStreaming
}

export async function* queryModelAnthropic(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  try {
    const model = options.model
    const endpoint = resolveAnthropicProviderEndpoint(
      options.providerName,
      model,
    )
    const messagesForAPI = normalizeMessagesForAPI(messages, tools)

    const toolSchemas = await Promise.all(
      tools.map(tool =>
        toolToAPISchema(tool, {
          getToolSafetyContext: options.getToolSafetyContext,
          tools,
          agents: options.agents,
          allowedAgentTypes: options.allowedAgentTypes,
          model: options.model,
          deferLoading: false,
        }),
      ),
    )
    const standardTools = toolSchemas.filter(isStandardAnthropicTool)
    if (options.enablePromptCaching !== false && standardTools.length > 0) {
      const lastTool = standardTools[
        standardTools.length - 1
      ] as unknown as Record<string, unknown>
      lastTool.cache_control = { type: 'ephemeral' }
    }

    const apiMessages = messagesForAPI
      .filter(isAnthropicConvertibleMessage)
      .map(toAnthropicMessageParam)

    const { upperLimit } = getModelMaxOutputTokens(model)
    const maxTokens = resolveOpenAIMaxTokens(
      upperLimit,
      options.maxOutputTokensOverride,
    )

    const system = toAnthropicSystemBlocks(
      systemPrompt,
      options.enablePromptCaching !== false,
    )

    logForDebugging(
      `[Anthropic Messages] Calling model=${model}, provider=${endpoint.name ?? 'env'}, messages=${apiMessages.length}, tools=${standardTools.length}, effort=${toAnthropicEffort(options.effortValue)}`,
    )

    const client = anthropicClientForEndpoint(
      endpoint,
      options.fetchOverride as unknown as typeof fetch,
    )
    const request = buildAnthropicRequestParams({
      model,
      messages: apiMessages,
      system,
      tools: standardTools,
      toolChoice: options.toolChoice,
      maxTokens,
      effortValue: options.effortValue,
      outputFormat: options.outputFormat,
      metadataUserId: getSessionId(),
    })
    const stream = await client.beta.messages.create(request, { signal })

    yield* consumeAnthropicStream({
      stream,
      tools,
      agentId: options.agentId,
      maxTokens,
      recordUsage: u => {
        const costUSD = calculateUSDCost(model, u as unknown as BetaUsage)
        addToTotalSessionCost(costUSD, u as unknown as BetaUsage, options.model)
      },
      onStreamEnd: ({ collectedMessages, usage, ttftMs, start }) => {
        recordLLMObservation(options.langfuseTrace ?? null, {
          model,
          provider: 'anthropic',
          input: convertMessagesToLangfuse(apiMessages as never),
          output: convertOutputToLangfuse(collectedMessages),
          usage: {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
          },
          startTime: new Date(start),
          endTime: new Date(),
          completionStartTime:
            ttftMs > 0 ? new Date(start + ttftMs) : undefined,
          tools: convertToolsToLangfuse(toolSchemas as unknown[]),
        })
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logForDebugging(`[Anthropic Messages] Error: ${errorMessage}`, {
      level: 'error',
    })
    yield createAssistantAPIErrorMessage({
      content: `API Error: ${errorMessage}`,
      apiError: 'api_error',
      error: (error instanceof Error
        ? error
        : new Error(String(error))) as unknown as SDKAssistantMessageError,
    })
  }
}
