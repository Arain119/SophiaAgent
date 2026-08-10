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
        main: { model: 'main-model', provider: 'work' },
        subagent: { model: 'sub-model', provider: 'work' },
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
        { model: 'new-main', provider: 'backup' },
        dependencies,
      ),
    ).toBeNull()
    expect(settings.agentModels?.main).toEqual({
      model: 'new-main',
      provider: 'backup',
    })
    expect(settings.agentModels?.subagent.model).toBe('sub-model')
    expect(environmentRoute).toEqual({ model: 'new-main', provider: 'backup' })
  })

  test('rejects empty models and unknown providers', () => {
    const settings: SavedModelSettings = {
      providers: { work: profile },
      agentModels: {
        main: { model: 'main-model', provider: 'work' },
        subagent: { model: 'sub-model', provider: 'work' },
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
        'subagent',
        { model: 'model', provider: 'missing' },
        dependencies,
      )?.message,
    ).toContain("Provider 'missing' does not exist")
  })
})
