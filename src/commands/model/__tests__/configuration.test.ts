import { describe, expect, test } from 'bun:test'
import {
  saveModelConfiguration,
  type ModelSettingsPatch,
  type SavedModelSettings,
} from '../configuration.js'

const profile = {
  protocol: 'openai-responses' as const,
  baseUrl: 'https://llm.example/v1',
}

describe('saveModelConfiguration', () => {
  test('updates one role without changing the other', () => {
    let settings: SavedModelSettings = {
      providers: { work: profile, backup: profile },
      agentModels: {
        main: { model: 'gpt-5.6-sol', provider: 'work' },
        subagent: { model: 'gpt-5.6-luna', provider: 'work' },
      },
    }
    let environmentRoute: { model: string; provider: string } | undefined
    const dependencies = {
      getSettings: () => settings,
      updateSettings: (patch: ModelSettingsPatch) => {
        settings = { ...settings, ...patch }
        return null
      },
      applyMainEnvironment: (route: { model: string; provider: string }) => {
        environmentRoute = route
      },
    }

    expect(
      saveModelConfiguration(
        'main',
        { model: 'deepseek-v4-pro', provider: 'backup' },
        dependencies,
      ),
    ).toBeNull()
    expect(settings.agentModels?.main).toEqual({
      model: 'deepseek-v4-pro',
      provider: 'backup',
    })
    expect(settings.agentModels?.subagent.model).toBe('gpt-5.6-luna')
    expect(environmentRoute).toEqual({
      model: 'deepseek-v4-pro',
      provider: 'backup',
    })
  })

  test('rejects empty models and unknown providers', () => {
    const settings: SavedModelSettings = {
      providers: { work: profile },
      agentModels: {
        main: { model: 'gpt-5.6-sol', provider: 'work' },
        subagent: { model: 'gpt-5.6-luna', provider: 'work' },
      },
    }
    const dependencies = {
      getSettings: () => settings,
      updateSettings: () => null,
      applyMainEnvironment: () => {},
    }

    expect(
      saveModelConfiguration(
        'main',
        { model: '', provider: 'work' },
        dependencies,
      )?.message,
    ).toBe('Model ID is required')
    expect(
      saveModelConfiguration(
        'main',
        { model: 'private-model', provider: 'work' },
        dependencies,
      )?.message,
    ).toBe('Unsupported Mainagent model')
    expect(
      saveModelConfiguration(
        'subagent',
        { model: 'deepseek-v4-flash', provider: 'missing' },
        dependencies,
      )?.message,
    ).toContain("Provider 'missing' does not exist")
  })
})
