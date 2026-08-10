import { describe, expect, test } from 'bun:test'
import { getAgentModel, getDefaultSubagentModel } from '../agent.js'

describe('getAgentModel', () => {
  test('uses the configured subagent model', () => {
    const settings = {
      providers: {
        work: {
          protocol: 'openai-responses' as const,
          baseUrl: 'https://llm.example/v1',
        },
      },
      agentModels: {
        main: { model: 'main-model', provider: 'work' },
        subagent: { model: 'sub-model', provider: 'work' },
      },
    }
    expect(getDefaultSubagentModel(settings)).toBe('sub-model')
    expect(getAgentModel(settings)).toBe('sub-model')
  })

  test('uses Luna before provider onboarding', () => {
    expect(getDefaultSubagentModel({})).toBe('gpt-5.6-luna')
  })
})
