import { describe, expect, test } from 'bun:test'
import {
  getSelectedResponsesProvider,
  resolveResponsesProviderName,
} from '../providerRouting.js'

const providers = {
  primary: {
    protocol: 'openai-responses' as const,
    baseUrl: 'https://primary.example/v1',
  },
  secondary: {
    protocol: 'openai-responses' as const,
    baseUrl: 'https://secondary.example/v1',
  },
}

describe('Responses provider routing', () => {
  test('uses only the provider selected for the agent route', () => {
    expect(
      getSelectedResponsesProvider(
        providers,
        'secondary',
        name => `${name}-key`,
      ),
    ).toEqual([
      {
        name: 'secondary',
        baseUrl: 'https://secondary.example/v1',
        apiKey: 'secondary-key',
        requiresApiKey: false,
      },
    ])
  })

  test('returns no endpoint for an unknown provider', () => {
    expect(
      getSelectedResponsesProvider(providers, 'missing', () => 'key'),
    ).toEqual([])
  })

  test('falls back to the model route when a generic provider is requested', () => {
    expect(resolveResponsesProviderName(providers, 'openai', 'primary')).toBe(
      'primary',
    )
  })

  test('preserves an explicitly configured provider', () => {
    expect(
      resolveResponsesProviderName(providers, 'secondary', 'primary'),
    ).toBe('secondary')
  })

  test('marks the official OpenAI endpoint as authenticated', () => {
    expect(
      getSelectedResponsesProvider(
        {
          openai: {
            protocol: 'openai-responses',
            baseUrl: 'https://api.openai.com/v1',
          },
        },
        'openai',
        () => undefined,
      ),
    ).toEqual([
      {
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: undefined,
        requiresApiKey: true,
      },
    ])
  })
})
