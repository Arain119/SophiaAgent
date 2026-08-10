import { describe, expect, test } from 'bun:test'
import {
  getAgentModelRoute,
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
      main: { model: 'custom-main', provider: 'work' },
      subagent: { model: 'custom-sub', provider: 'work' },
    },
  }

  test('resolves model routes and provider profiles by agent role', () => {
    expect(getAgentModelRoute(settings, 'main')).toEqual({
      model: 'custom-main',
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

  test('maps an explicit model into the compatibility environment', () => {
    const env = providerProfileToEnvironment(
      profiles.work,
      'key',
      'custom-main',
    )
    expect(env.OPENAI_BASE_URL).toBe('https://one.example/v1')
    expect(env.OPENAI_MODEL).toBe('custom-main')
    expect(env.OPENAI_API_KEY).toBe('key')
  })
})
