import { describe, expect, test } from 'bun:test'
import {
  getAgentModelRoute,
  getModelForService,
  getModelService,
  getProviderModelIds,
  getProviderModelTier,
  getProviderProfileForRole,
  providerProfileToEnvironment,
  PROVIDER_MODELS,
} from '../providerProfiles.js'

describe('provider profiles', () => {
  const profiles = {
    work: {
      protocol: 'openai-responses' as const,
      baseUrl: 'https://one.example/v1',
    },
  }
  const settings = {
    providers: profiles,
    agentModels: {
      main: { model: 'gpt-5.6-sol', provider: 'work' },
      subagent: { model: 'gpt-5.6-luna', provider: 'work' },
    },
  }

  test('resolves model routes and provider profiles by agent role', () => {
    expect(getAgentModelRoute(settings, 'main')).toEqual({
      model: 'gpt-5.6-sol',
      provider: 'work',
    })
    expect(getProviderProfileForRole(settings, 'subagent')).toEqual(
      profiles.work,
    )
    expect(getAgentModelRoute({ providers: profiles }, 'main')).toBeUndefined()
  })

  test('keeps built-in model IDs as initial defaults', () => {
    expect(getProviderModelIds()).toEqual(['gpt-5.6-luna', 'gpt-5.6-sol'])
    expect(getProviderModelTier(PROVIDER_MODELS.deep)).toBe('deep')
  })

  test('maps each service directly to its role-specific model', () => {
    expect(getModelForService('chatgpt', 'main')).toBe('gpt-5.6-sol')
    expect(getModelForService('chatgpt', 'subagent')).toBe('gpt-5.6-luna')
    expect(getModelForService('deepseek', 'main')).toBe('deepseek-v4-pro')
    expect(getModelForService('deepseek', 'subagent')).toBe('deepseek-v4-flash')
    expect(getModelService('deepseek-v4-pro')).toBe('deepseek')
    expect(getModelService('gpt-5.6-luna')).toBe('chatgpt')
    expect(getModelService('private-model')).toBeUndefined()
  })
  test('maps an explicit model into the compatibility environment', () => {
    const env = providerProfileToEnvironment(
      profiles.work,
      'key',
      'gpt-5.6-sol',
    )
    expect(env.OPENAI_BASE_URL).toBe('https://one.example/v1')
    expect(env.OPENAI_MODEL).toBe('gpt-5.6-sol')
    expect(env.OPENAI_API_KEY).toBe('key')
  })
})
