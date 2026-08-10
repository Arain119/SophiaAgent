import { afterEach, describe, expect, test } from 'bun:test'
import {
  prepareProviderConfiguration,
  removeProviderConfiguration,
  saveProviderConfiguration,
  type ProviderSettingsPatch,
  type SavedProviderSettings,
} from '../configuration.js'

const baseValues = {
  name: 'work',
  baseUrl: 'https://llm.example/v1/',
  apiKey: 'key',
}

const workProfile = {
  protocol: 'openai-responses' as const,
  baseUrl: 'https://one.example',
}

const backupProfile = {
  protocol: 'openai-responses' as const,
  baseUrl: 'https://two.example',
}

const routes = {
  main: { model: 'main-model', provider: 'work' },
  subagent: { model: 'sub-model', provider: 'work' },
}

describe('prepareProviderConfiguration', () => {
  test('creates a Responses provider without owning model selection', () => {
    const result = prepareProviderConfiguration(baseValues)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.name).toBe('work')
      expect(result.profile).toEqual({
        protocol: 'openai-responses',
        baseUrl: 'https://llm.example/v1',
      })
      expect(result.apiKey).toBe('key')
      expect(result.env.OPENAI_MODEL).toBeUndefined()
    }
  })

  test('requires a provider name and base URL', () => {
    for (const field of ['name', 'baseUrl'] as const) {
      expect(
        prepareProviderConfiguration({ ...baseValues, [field]: '' }),
      ).toBeInstanceOf(Error)
    }
  })

  test('requires an API key only for the official OpenAI endpoint', () => {
    expect(
      prepareProviderConfiguration({
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
      }),
    ).toBeInstanceOf(Error)
    expect(
      prepareProviderConfiguration({
        name: 'local',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
      }),
    ).not.toBeInstanceOf(Error)
  })
})

describe('named provider lifecycle', () => {
  let settings: SavedProviderSettings = {}
  let applied: ProviderSettingsPatch | undefined
  let appliedEnvironment: ProviderSettingsPatch['env'] | undefined
  let credentials: Record<string, string> = {}

  afterEach(() => {
    settings = {}
    applied = undefined
    appliedEnvironment = undefined
    credentials = {}
  })

  const dependencies = {
    getSettings: () => settings,
    updateSettings: (patch: ProviderSettingsPatch) => {
      const providers = { ...(settings.providers ?? {}) }
      if (patch.providers === undefined) {
        const { providers: _providersPatch, ...rest } = patch
        settings = { ...settings, ...rest, providers: undefined }
      } else {
        for (const [name, profile] of Object.entries(patch.providers)) {
          if (profile === undefined) delete providers[name]
          else providers[name] = profile
        }
        settings = { ...settings, ...patch, providers }
      }
      applied = patch
      return null
    },
    applyEnvironment: (patch: ProviderSettingsPatch['env']) => {
      appliedEnvironment = patch
    },
    getApiKey: (name: string) => credentials[name],
    updateApiKeys: (patch: Record<string, string | undefined>) => {
      for (const [name, apiKey] of Object.entries(patch)) {
        if (apiKey) credentials[name] = apiKey
        else delete credentials[name]
      }
      return null
    },
  }

  test('initializes routes on the first provider and preserves them on later additions', () => {
    expect(saveProviderConfiguration(baseValues, dependencies)).toBeNull()
    expect(
      saveProviderConfiguration(
        {
          ...baseValues,
          name: 'backup',
          baseUrl: 'https://backup.example/v1',
        },
        dependencies,
      ),
    ).toBeNull()

    expect(Object.keys(settings.providers ?? {})).toEqual(['work', 'backup'])
    expect(settings.agentModels).toEqual({
      main: { model: 'gpt-5.6-sol', provider: 'work' },
      subagent: { model: 'gpt-5.6-luna', provider: 'work' },
    })
    expect(appliedEnvironment?.OPENAI_BASE_URL).toBe('https://llm.example/v1')
    expect(appliedEnvironment?.OPENAI_MODEL).toBe('gpt-5.6-sol')
    expect(credentials).toEqual({ work: 'key', backup: 'key' })
  })

  test('rejects renaming a provider over an existing profile', () => {
    settings = {
      providers: { work: workProfile, backup: backupProfile },
      agentModels: routes,
    }

    const error = saveProviderConfiguration(
      { ...baseValues, name: 'backup' },
      dependencies,
      'work',
    )

    expect(error?.message).toContain('already exists')
    expect(settings.providers?.work).toEqual(workProfile)
    expect(settings.providers?.backup).toEqual(backupProfile)
  })

  test('updates model routes when a provider is renamed', () => {
    settings = {
      providers: { work: workProfile },
      agentModels: routes,
    }

    expect(
      saveProviderConfiguration(
        { ...baseValues, name: 'renamed' },
        dependencies,
        'work',
      ),
    ).toBeNull()
    expect(settings.providers?.work).toBeUndefined()
    expect(applied?.providers).toHaveProperty('work', undefined)
    expect(settings.agentModels?.main.provider).toBe('renamed')
    expect(settings.agentModels?.subagent.provider).toBe('renamed')
  })

  test('blocks removal while a model route uses the provider', () => {
    settings = {
      providers: { work: workProfile, backup: backupProfile },
      agentModels: routes,
    }

    expect(
      removeProviderConfiguration('work', dependencies)?.message,
    ).toContain('change it with /model first')
    expect(settings.providers?.work).toEqual(workProfile)
  })

  test('removes an unused provider without deleting the others', () => {
    settings = {
      providers: { work: workProfile, backup: backupProfile },
      agentModels: routes,
    }
    credentials = { work: 'work-key', backup: 'backup-key' }

    expect(removeProviderConfiguration('backup', dependencies)).toBeNull()
    expect(settings.providers?.backup).toBeUndefined()
    expect(applied?.providers).toHaveProperty('backup', undefined)
    expect(settings.providers?.work).toEqual(workProfile)
    expect(credentials).toEqual({ work: 'work-key' })
  })

  test('removes the final provider and clears model routes', () => {
    settings = {
      providers: { work: workProfile },
      agentModels: routes,
    }

    expect(removeProviderConfiguration('work', dependencies)).toBeNull()
    expect(settings.providers).toBeUndefined()
    expect(settings.agentModels).toBeUndefined()
  })

  test('keeps the stored key when an edited provider leaves API Key blank', () => {
    settings = {
      providers: { work: workProfile },
      agentModels: routes,
    }
    credentials = { work: 'stored-key' }

    expect(
      saveProviderConfiguration(
        { name: 'work', baseUrl: 'https://updated.example/v1', apiKey: '' },
        dependencies,
        'work',
      ),
    ).toBeNull()

    expect(credentials.work).toBe('stored-key')
    expect(appliedEnvironment?.OPENAI_API_KEY).toBe('stored-key')
  })
})
