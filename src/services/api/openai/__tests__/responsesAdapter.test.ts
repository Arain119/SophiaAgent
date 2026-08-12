import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildResponsesRequest,
  createResponsesStream,
  extractUsage,
  resolveLongRetryDelayMs,
} from '../responsesAdapter.js'
import { formatOpenAIPromptCacheKey } from '../openaiShared.js'
import { computeHitRate } from '../../../../utils/cacheStats.js'

const originalApiKey = process.env.OPENAI_API_KEY
const originalBaseUrl = process.env.OPENAI_BASE_URL

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalApiKey
  if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL
  else process.env.OPENAI_BASE_URL = originalBaseUrl
})

const responsesRequest = {
  model: 'gpt-5',
  stream: true as const,
  store: false as const,
  input: [],
  prompt_cache_key: 'sophia:test',
}

describe('long provider retry backoff', () => {
  test('grows exponentially from two minutes and caps at one hour', () => {
    expect(
      Array.from({ length: 8 }, (_, attempt) =>
        resolveLongRetryDelayMs(attempt),
      ),
    ).toEqual([
      120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000,
      3_600_000,
    ])
  })

  test('supports configured base and maximum delays', () => {
    expect(resolveLongRetryDelayMs(4, '1000', '10000')).toBe(10_000)
    expect(resolveLongRetryDelayMs(2, 'invalid', '300000')).toBe(300_000)
  })
})

function sseResponse(
  events: Array<Record<string, unknown>>,
  headers: HeadersInit = {},
): Response {
  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        ...Object.fromEntries(new Headers(headers)),
      },
    },
  )
}

async function collectStream(
  stream: AsyncIterable<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = []
  for await (const event of stream) events.push(event)
  return events
}

describe('createResponsesStream', () => {
  test('uses Bearer authentication for a configured API key', async () => {
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1/'
    process.env.OPENAI_API_KEY = 'test-key'
    let capturedUrl = ''
    let capturedHeaders = new Headers()
    const fetchOverride = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedUrl = String(input)
      capturedHeaders = new Headers(init?.headers)
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })

    expect(capturedUrl).toBe('https://api.openai.com/v1/responses')
    expect(capturedHeaders.get('Authorization')).toBe('Bearer test-key')
  })

  test('supports an unauthenticated self-hosted endpoint', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    delete process.env.OPENAI_API_KEY
    let capturedHeaders = new Headers()
    const fetchOverride = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedHeaders = new Headers(init?.headers)
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })

    expect(capturedHeaders.has('Authorization')).toBe(false)
  })

  test('retries transient gateway failures', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'Retry-After': '0' },
        })
      }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })

    expect(attempts).toBe(2)
  })

  test('does not retry permanent request errors', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      return new Response('bad request', { status: 400 })
    }) as unknown as typeof fetch

    await expect(
      createResponsesStream({
        request: responsesRequest,
        signal: new AbortController().signal,
        fetchOverride,
      }),
    ).rejects.toThrow('Provider request failed (HTTP 400): bad request')
    expect(attempts).toBe(1)
  })

  test('stops after ten total attempts', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      return new Response('still unavailable', {
        status: 503,
        headers: { 'Retry-After': '0' },
      })
    }) as unknown as typeof fetch

    await expect(
      createResponsesStream({
        request: responsesRequest,
        signal: new AbortController().signal,
        fetchOverride,
      }),
    ).rejects.toThrow('Provider request failed (HTTP 503): still unavailable')
    expect(attempts).toBe(10)
  })

  test('switches to the next configured provider after retry exhaustion', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const fetchOverride = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input)
      requests.push({
        url,
        authorization: new Headers(init?.headers).get('Authorization'),
      })
      if (url.startsWith('https://primary.example')) {
        return new Response('unavailable', {
          status: 503,
          headers: { 'Retry-After': '0' },
        })
      }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
      providers: [
        {
          name: 'primary',
          baseUrl: 'https://primary.example/v1',
          apiKey: 'primary-key',
        },
        {
          name: 'backup',
          baseUrl: 'https://backup.example/v1',
          apiKey: 'backup-key',
        },
      ],
    })

    expect(requests).toHaveLength(4)
    expect(requests.at(-1)).toEqual({
      url: 'https://backup.example/v1/responses',
      authorization: 'Bearer backup-key',
    })
  })

  test('does not leak the active provider key to an unauthenticated backup', async () => {
    process.env.OPENAI_API_KEY = 'active-environment-key'
    const authorizations: Array<string | null> = []
    const fetchOverride = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      authorizations.push(new Headers(init?.headers).get('Authorization'))
      if (String(input).startsWith('https://primary.example')) {
        return new Response('unavailable', {
          status: 503,
          headers: { 'Retry-After': '0' },
        })
      }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
      providers: [
        {
          name: 'primary',
          baseUrl: 'https://primary.example/v1',
          apiKey: 'primary-key',
        },
        { name: 'backup', baseUrl: 'http://backup.example/v1' },
      ],
    })

    expect(authorizations.at(-1)).toBeNull()
  })
  test('does not switch providers for permanent errors', async () => {
    const urls: string[] = []
    const fetchOverride = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response('unauthorized', { status: 401 })
    }) as unknown as typeof fetch

    await expect(
      createResponsesStream({
        request: responsesRequest,
        signal: new AbortController().signal,
        fetchOverride,
        providers: [
          { name: 'primary', baseUrl: 'https://primary.example/v1' },
          { name: 'backup', baseUrl: 'https://backup.example/v1' },
        ],
      }),
    ).rejects.toThrow('Provider request failed (HTTP 401): unauthorized')
    expect(urls).toEqual(['https://primary.example/v1/responses'])
  })
  test('retries a concurrency error received before stream output', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      if (attempts === 1) {
        return sseResponse(
          [
            {
              type: 'response.error',
              error: { message: 'Concurrency limit exceeded for account' },
            },
          ],
          { 'Retry-After': '0' },
        )
      }
      return sseResponse([
        {
          type: 'response.completed',
          response: { status: 'completed', usage: {} },
        },
      ])
    }) as unknown as typeof fetch

    const stream = await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })
    const events = await collectStream(stream)

    expect(attempts).toBe(2)
    expect(events.at(-1)?.type).toBe('response.completed')
  })

  test('retries an overloaded error received before stream output', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      if (attempts === 1) {
        return sseResponse(
          [
            {
              type: 'response.error',
              error: {
                message:
                  'Our servers are currently overloaded. Please try again later.',
              },
            },
          ],
          { 'Retry-After': '0' },
        )
      }
      return sseResponse([
        {
          type: 'response.completed',
          response: { status: 'completed', usage: {} },
        },
      ])
    }) as unknown as typeof fetch

    const stream = await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })
    const events = await collectStream(stream)

    expect(attempts).toBe(2)
    expect(events.at(-1)?.type).toBe('response.completed')
  })

  test('retries stream_read_error before semantic output', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      if (attempts === 1) {
        return sseResponse(
          [
            {
              type: 'response.error',
              error: {
                code: 'stream_read_error',
                message: 'stream_read_error',
              },
            },
          ],
          { 'Retry-After': '0' },
        )
      }
      return sseResponse([
        {
          type: 'response.completed',
          response: { status: 'completed', usage: {} },
        },
      ])
    }) as unknown as typeof fetch

    const stream = await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })
    const events = await collectStream(stream)

    expect(attempts).toBe(2)
    expect(events.at(-1)?.type).toBe('response.completed')
  })

  test('switches providers when a stream fails before semantic output', async () => {
    let primaryAttempts = 0
    const fetchOverride = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://primary.example')) {
        primaryAttempts += 1
        return sseResponse(
          [
            {
              type: 'response.error',
              error: { message: 'Upstream request failed' },
            },
          ],
          { 'Retry-After': '0' },
        )
      }
      return sseResponse([
        {
          type: 'response.completed',
          response: { status: 'completed', usage: {} },
        },
      ])
    }) as unknown as typeof fetch

    const stream = await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
      providers: [
        { name: 'primary', baseUrl: 'https://primary.example/v1' },
        { name: 'backup', baseUrl: 'https://backup.example/v1' },
      ],
    })

    const events = await collectStream(stream)
    expect(primaryAttempts).toBe(3)
    expect(events.at(-1)?.type).toBe('response.completed')
  })
  test('does not replay a stream after semantic output has started', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      return sseResponse([
        { type: 'response.output_text.delta', delta: 'partial' },
        {
          type: 'response.error',
          error: { message: 'Upstream request failed' },
        },
      ])
    }) as unknown as typeof fetch

    const stream = await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })

    await expect(collectStream(stream)).rejects.toThrow(
      'Upstream request failed',
    )
    expect(attempts).toBe(1)
  })

  test('does not replay stream_read_error after semantic output', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      return sseResponse([
        { type: 'response.output_text.delta', delta: 'partial' },
        {
          type: 'response.error',
          error: { code: 'stream_read_error', message: 'stream_read_error' },
        },
      ])
    }) as unknown as typeof fetch

    const stream = await createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })

    await expect(collectStream(stream)).rejects.toThrow('stream_read_error')
    expect(attempts).toBe(1)
  })

  test('does not expose an HTML gateway error body', async () => {
    let attempts = 0
    const fetchOverride = (async () => {
      attempts += 1
      return new Response(
        '<!DOCTYPE html><html><head><title>proxy | 502: Bad gateway</title></head></html>',
        {
          status: 502,
          headers: {
            'Content-Type': 'text/html',
            'Retry-After': '0',
          },
        },
      )
    }) as unknown as typeof fetch

    const request = createResponsesStream({
      request: responsesRequest,
      signal: new AbortController().signal,
      fetchOverride,
    })

    await expect(request).rejects.toThrow('Provider request failed (HTTP 502).')
    await expect(request).rejects.not.toThrow('<!DOCTYPE html>')
    expect(attempts).toBe(10)
  })
})

describe('buildResponsesRequest', () => {
  const promptCacheKey = formatOpenAIPromptCacheKey(
    'session-abc-123',
    'gpt-5.6-sol',
    '',
  )

  test('includes max reasoning effort for Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'max',
      promptCacheKey,
    })

    expect(request.reasoning).toEqual({ effort: 'max' })
  })

  test('includes reasoning effort for Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'xhigh',
      promptCacheKey,
    })

    expect(request.reasoning).toEqual({ effort: 'xhigh' })
  })

  test('omits max_output_tokens when no output limit is configured', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey,
    }) as Record<string, unknown>

    expect('max_output_tokens' in request).toBe(false)
  })

  test('includes max_output_tokens when an output limit is configured', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      maxOutputTokens: 8192,
      promptCacheKey,
    })

    expect(request.max_output_tokens).toBe(8192)
  })

  test('includes stable prompt_cache_key for session-sticky cache routing', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey,
    })

    expect(request.prompt_cache_key).toBe(
      'sophia:v1:gpt-5.6-sol:811c9dc5:88ce9025f8a9c60e5e93',
    )
  })

  test('prompt_cache_key is stable across turns (not derived from messages)', () => {
    const key = formatOpenAIPromptCacheKey('same-session')
    const turn1 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'first' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })
    const turn2 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
      ],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })

    expect(turn1.prompt_cache_key).toBe(turn2.prompt_cache_key)
    expect(turn1.prompt_cache_key).toBe(
      'sophia:v1:unknown:811c9dc5:24ed905418b8aefac304',
    )
  })
})

describe('extractUsage (OpenAI Responses → Anthropic usage)', () => {
  test('subtracts cached_tokens so hit rate uses OpenAI total as denominator', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 20_000 },
      },
    })

    expect(usage).toEqual({
      input_tokens: 10_000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 20_000,
    })

    // Was 40% under the double-count bug; rounded display is 67%.
    const hitRate = computeHitRate(usage)
    expect(hitRate).toBe(67)
  })

  test('full cache hit can report 100% (not capped at 50%)', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 30_000 },
      },
    })

    expect(usage.input_tokens).toBe(0)
    expect(usage.cache_read_input_tokens).toBe(30_000)
    expect(computeHitRate(usage)).toBe(100)
  })

  test('maps cache_write_tokens to cache_creation without double-counting total', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 10_000,
        output_tokens: 10,
        input_tokens_details: {
          cached_tokens: 6_000,
          cache_write_tokens: 2_000,
        },
      },
    })

    expect(usage).toEqual({
      input_tokens: 2_000,
      output_tokens: 10,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 6_000,
    })
    // segments sum to OpenAI total
    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(10_000)
    expect(computeHitRate(usage)).toBeCloseTo(60, 5)
  })

  test('clamps overlapping write/read that exceed total input', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 5_000,
        output_tokens: 0,
        input_tokens_details: {
          cached_tokens: 4_000,
          cache_write_tokens: 4_000,
        },
      },
    })

    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(5_000)
    expect(usage.cache_read_input_tokens).toBe(4_000)
    expect(usage.cache_creation_input_tokens).toBe(1_000)
    expect(usage.input_tokens).toBe(0)
  })
})
