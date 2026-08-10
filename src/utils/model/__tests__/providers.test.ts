import { describe, expect, test } from 'bun:test'
import {
  getAPIProvider,
  getConfiguredAPIProvider,
  getConfiguredProviderName,
  getConfiguredProviderNameForModel,
} from '../providers.js'

function profile() {
  return {
    protocol: 'openai-responses' as const,
    baseUrl: 'https://llm.example/v1',
  }
}

describe('getAPIProvider', () => {
  const settings = {
    providers: { first: profile(), work: profile() },
    agentModels: {
      main: { model: 'main-model', provider: 'work' },
      subagent: { model: 'sub-model', provider: 'first' },
    },
  }

  test('uses the provider configured for each agent role', () => {
    expect(getConfiguredAPIProvider(settings)).toBe('openai-responses')
    expect(getAPIProvider(settings)).toBe('openai-responses')
    expect(getConfiguredProviderName('main', settings)).toBe('work')
    expect(getConfiguredProviderName('subagent', settings)).toBe('first')
  })

  test('infers auxiliary request routing from the configured model', () => {
    expect(getConfiguredProviderNameForModel('sub-model', settings)).toBe(
      'first',
    )
    expect(getConfiguredProviderNameForModel('main-model', settings)).toBe(
      'work',
    )
  })

  test('defaults runtime protocol before /model exists', () => {
    expect(getConfiguredAPIProvider({})).toBeUndefined()
    expect(getAPIProvider({})).toBe('openai-responses')
  })
})
