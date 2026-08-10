import { describe, expect, test } from 'bun:test'
import {
  getConfiguredProviderModel,
  parseUserSpecifiedModel,
} from '../model.js'

const settings = {
  providers: {
    work: {
      protocol: 'openai-responses' as const,
      baseUrl: 'https://llm.example/v1',
    },
  },
  agentModels: {
    main: { model: 'custom-main', provider: 'work' },
    subagent: { model: 'custom-sub', provider: 'work' },
  },
}

describe('explicit provider model selection', () => {
  test('uses the model configured for each agent role', () => {
    expect(getConfiguredProviderModel(settings)).toBe('custom-main')
    expect(getConfiguredProviderModel(settings, 'fast')).toBe('custom-sub')
  })

  test('uses built-in defaults before provider onboarding', () => {
    expect(getConfiguredProviderModel({})).toBe('gpt-5.6-sol')
    expect(getConfiguredProviderModel({}, 'fast')).toBe('gpt-5.6-luna')
  })

  test('accepts any non-empty exact model ID', () => {
    expect(() => parseUserSpecifiedModel('  ')).toThrow(
      'Model ID cannot be empty',
    )
    expect(parseUserSpecifiedModel('custom-model')).toBe('custom-model')
  })
})
