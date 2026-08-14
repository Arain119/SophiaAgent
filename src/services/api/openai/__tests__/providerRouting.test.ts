import { describe, expect, test } from 'bun:test'
import { getSelectedResponsesProvider } from '../providerRouting.js'

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
      },
    ])
  })

  test('returns no endpoint for an unknown provider', () => {
    expect(
      getSelectedResponsesProvider(providers, 'missing', () => 'key'),
    ).toEqual([])
  })
})
