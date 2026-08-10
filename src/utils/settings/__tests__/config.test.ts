import { describe, expect, test } from 'bun:test'
import {
  SettingsSchema,
  EnvironmentVariablesSchema,
  SafetyRulesSchema,
  AllowedMcpServerEntrySchema,
  DeniedMcpServerEntrySchema,
  isMcpServerNameEntry,
  isMcpServerCommandEntry,
  isMcpServerUrlEntry,
  CUSTOMIZATION_SURFACES,
} from '../types'
import {
  SETTING_SOURCES,
  SOURCES,
  SOPHIA_SETTINGS_SCHEMA_URL,
  getSettingSourceName,
  getSourceDisplayName,
  getSettingSourceDisplayNameLowercase,
  getSettingSourceDisplayNameCapitalized,
  parseSettingSourcesFlag,
} from '../constants'
import {
  formatZodError,
  filterInvalidSafetyRules,
  validateSettingsFileContent,
} from '../validation'

// ─── Settings Schema Validation ──────────────────────────────────────────

describe('SettingsSchema', () => {
  test('accepts empty object', () => {
    const result = SettingsSchema().safeParse({})
    expect(result.success).toBe(true)
  })

  test('accepts exactly the five explicit effort levels', () => {
    for (const effortLevel of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(SettingsSchema().safeParse({ effortLevel }).success).toBe(true)
    }
    for (const effortLevel of ['auto', 'unset']) {
      expect(SettingsSchema().safeParse({ effortLevel }).success).toBe(false)
    }
  })

  test('rejects removed top-level model settings', () => {
    expect(SettingsSchema().safeParse({ model: 'sonnet' }).success).toBe(false)
    expect(
      SettingsSchema().safeParse({ apiProtocol: 'openai-responses' }).success,
    ).toBe(false)
    expect(
      SettingsSchema().safeParse({ availableModels: ['model-a'] }).success,
    ).toBe(false)
    expect(
      SettingsSchema().safeParse({
        modelOverrides: { 'model-a': 'model-b' },
      }).success,
    ).toBe(false)
  })

  test('accepts permissions block with allow rules', () => {
    const result = SettingsSchema().safeParse({
      permissions: { allow: ['Bash(npm install)'] },
    })
    expect(result.success).toBe(true)
  })

  test('accepts permissions block with deny rules', () => {
    const result = SettingsSchema().safeParse({
      permissions: { deny: ['Bash(rm -rf *)'] },
    })
    expect(result.success).toBe(true)
  })

  test('accepts env variables', () => {
    const result = SettingsSchema().safeParse({
      env: { FOO: 'bar', DEBUG: '1' },
    })
    expect(result.success).toBe(true)
  })

  test('accepts hooks configuration', () => {
    const result = SettingsSchema().safeParse({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo test' }],
          },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  test('accepts worktree settings', () => {
    const result = SettingsSchema().safeParse({
      worktree: {
        symlinkDirectories: ['node_modules', '.cache'],
        sparsePaths: ['src/'],
      },
    })
    expect(result.success).toBe(true)
  })

  test('accepts $schema field', () => {
    const result = SettingsSchema().safeParse({
      $schema: SOPHIA_SETTINGS_SCHEMA_URL,
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown keys in strict mode', () => {
    const result = SettingsSchema().safeParse({ unknownKey: 'value' })
    expect(result.success).toBe(false)
    if (result.success) {
      expect((result.data as any).unknownKey).toBe('value')
    }
  })

  test('coerces env var numbers to strings', () => {
    const result = EnvironmentVariablesSchema().safeParse({ PORT: 3000 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.PORT).toBe('3000')
    }
  })

  test('accepts boolean settings', () => {
    const result = SettingsSchema().safeParse({
      respectGitignore: false,
      disableAllHooks: true,
    })
    expect(result.success).toBe(true)
  })

  test('accepts cleanupPeriodDays', () => {
    const result = SettingsSchema().safeParse({ cleanupPeriodDays: 30 })
    expect(result.success).toBe(true)
  })

  test('rejects negative cleanupPeriodDays', () => {
    const result = SettingsSchema().safeParse({ cleanupPeriodDays: -1 })
    expect(result.success).toBe(false)
  })

  test('accepts statusLine configuration', () => {
    const result = SettingsSchema().safeParse({
      statusLine: { type: 'command', command: 'echo status' },
    })
    expect(result.success).toBe(true)
  })
})

// ─── Working Directory Schema ────────────────────────────────────────────

describe('SafetyRulesSchema', () => {
  test('accepts additionalDirectories', () => {
    const result = SafetyRulesSchema().safeParse({
      additionalDirectories: ['/tmp/extra'],
    })
    expect(result.success).toBe(true)
  })

  test('rejects removed ask rules', () => {
    const result = SafetyRulesSchema().safeParse({ ask: ['Bash'] })
    expect(result.success).toBe(false)
  })
})

// ─── AllowedMcpServerEntrySchema ────────────────────────────────────────

describe('AllowedMcpServerEntrySchema', () => {
  test('accepts serverName entry', () => {
    const result = AllowedMcpServerEntrySchema().safeParse({
      serverName: 'my-server',
    })
    expect(result.success).toBe(true)
  })

  test('accepts serverCommand entry', () => {
    const result = AllowedMcpServerEntrySchema().safeParse({
      serverCommand: ['npx', 'mcp-server'],
    })
    expect(result.success).toBe(true)
  })

  test('accepts serverUrl entry', () => {
    const result = AllowedMcpServerEntrySchema().safeParse({
      serverUrl: 'https://*.example.com/*',
    })
    expect(result.success).toBe(true)
  })

  test('rejects entry with no fields', () => {
    const result = AllowedMcpServerEntrySchema().safeParse({})
    expect(result.success).toBe(false)
  })

  test('rejects entry with multiple fields', () => {
    const result = AllowedMcpServerEntrySchema().safeParse({
      serverName: 'my-server',
      serverUrl: 'https://example.com',
    })
    expect(result.success).toBe(false)
  })

  test('rejects invalid serverName characters', () => {
    const result = AllowedMcpServerEntrySchema().safeParse({
      serverName: 'my server with spaces',
    })
    expect(result.success).toBe(false)
  })

  test('rejects empty serverCommand array', () => {
    const result = AllowedMcpServerEntrySchema().safeParse({
      serverCommand: [],
    })
    expect(result.success).toBe(false)
  })
})

// ─── Type guards ─────────────────────────────────────────────────────────

describe('MCP server entry type guards', () => {
  test('isMcpServerNameEntry identifies name entry', () => {
    expect(isMcpServerNameEntry({ serverName: 'test' })).toBe(true)
  })

  test('isMcpServerNameEntry rejects non-name entry', () => {
    expect(isMcpServerNameEntry({ serverUrl: 'https://example.com' })).toBe(
      false,
    )
  })

  test('isMcpServerCommandEntry identifies command entry', () => {
    expect(isMcpServerCommandEntry({ serverCommand: ['npx', 'srv'] })).toBe(
      true,
    )
  })

  test('isMcpServerCommandEntry rejects non-command entry', () => {
    expect(isMcpServerCommandEntry({ serverName: 'test' })).toBe(false)
  })

  test('isMcpServerUrlEntry identifies url entry', () => {
    expect(isMcpServerUrlEntry({ serverUrl: 'https://example.com' })).toBe(true)
  })

  test('isMcpServerUrlEntry rejects non-url entry', () => {
    expect(isMcpServerUrlEntry({ serverName: 'test' })).toBe(false)
  })
})

// ─── Constants ──────────────────────────────────────────────────────────

describe('SETTING_SOURCES', () => {
  test('contains all five sources in order', () => {
    expect(SETTING_SOURCES).toEqual([
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ])
  })
})

describe('SOURCES (editable)', () => {
  test('contains three editable sources', () => {
    expect(SOURCES).toEqual([
      'localSettings',
      'projectSettings',
      'userSettings',
    ])
  })
})

describe('CUSTOMIZATION_SURFACES', () => {
  test('contains expected surfaces', () => {
    expect(CUSTOMIZATION_SURFACES).toEqual(['skills', 'agents', 'hooks', 'mcp'])
  })
})

describe('getSettingSourceName', () => {
  test('maps userSettings to user', () => {
    expect(getSettingSourceName('userSettings')).toBe('user')
  })

  test('maps projectSettings to project', () => {
    expect(getSettingSourceName('projectSettings')).toBe('project')
  })

  test('maps localSettings to project, gitignored', () => {
    expect(getSettingSourceName('localSettings')).toBe('project, gitignored')
  })

  test('maps flagSettings to cli flag', () => {
    expect(getSettingSourceName('flagSettings')).toBe('cli flag')
  })

  test('maps policySettings to managed', () => {
    expect(getSettingSourceName('policySettings')).toBe('managed')
  })
})

describe('getSourceDisplayName', () => {
  test('maps userSettings to User', () => {
    expect(getSourceDisplayName('userSettings')).toBe('User')
  })

  test('maps plugin to Plugin', () => {
    expect(getSourceDisplayName('plugin')).toBe('Plugin')
  })

  test('maps built-in to Built-in', () => {
    expect(getSourceDisplayName('built-in')).toBe('Built-in')
  })
})

describe('getSettingSourceDisplayNameLowercase', () => {
  test('maps policySettings correctly', () => {
    expect(getSettingSourceDisplayNameLowercase('policySettings')).toBe(
      'enterprise managed settings',
    )
  })

  test('maps cliArg correctly', () => {
    expect(getSettingSourceDisplayNameLowercase('cliArg')).toBe('CLI argument')
  })

  test('maps session correctly', () => {
    expect(getSettingSourceDisplayNameLowercase('session')).toBe(
      'current session',
    )
  })
})

describe('getSettingSourceDisplayNameCapitalized', () => {
  test('maps userSettings correctly', () => {
    expect(getSettingSourceDisplayNameCapitalized('userSettings')).toBe(
      'User settings',
    )
  })

  test('maps command correctly', () => {
    expect(getSettingSourceDisplayNameCapitalized('command')).toBe(
      'Command configuration',
    )
  })
})

describe('parseSettingSourcesFlag', () => {
  test('parses comma-separated sources', () => {
    expect(parseSettingSourcesFlag('user,project,local')).toEqual([
      'userSettings',
      'projectSettings',
      'localSettings',
    ])
  })

  test('parses single source', () => {
    expect(parseSettingSourcesFlag('user')).toEqual(['userSettings'])
  })

  test('returns empty array for empty string', () => {
    expect(parseSettingSourcesFlag('')).toEqual([])
  })

  test('trims whitespace', () => {
    expect(parseSettingSourcesFlag('user , project')).toEqual([
      'userSettings',
      'projectSettings',
    ])
  })

  test('throws for invalid source name', () => {
    expect(() => parseSettingSourcesFlag('invalid')).toThrow(
      'Invalid setting source',
    )
  })
})

// ─── Validation ─────────────────────────────────────────────────────────

describe('filterInvalidSafetyRules', () => {
  test('returns empty for non-object input', () => {
    expect(filterInvalidSafetyRules(null, 'test.json')).toEqual([])
    expect(filterInvalidSafetyRules('string', 'test.json')).toEqual([])
  })

  test('returns empty when no permissions', () => {
    expect(filterInvalidSafetyRules({}, 'test.json')).toEqual([])
  })

  test('filters non-string rules and returns warnings', () => {
    const data = { permissions: { allow: ['Bash', 123, 'Read'] } }
    const warnings = filterInvalidSafetyRules(data, 'test.json')
    expect(warnings.length).toBe(1)
    expect(warnings[0]!.path).toBe('permissions.allow')
    expect((data.permissions as any).allow).toEqual(['Bash', 'Read'])
  })

  test('preserves valid rules', () => {
    const data = {
      permissions: { allow: ['Bash(npm install)', 'Read', 'Write'] },
    }
    const warnings = filterInvalidSafetyRules(data, 'test.json')
    expect(warnings).toEqual([])
    expect((data.permissions as any).allow).toEqual([
      'Bash(npm install)',
      'Read',
      'Write',
    ])
  })
})

describe('validateSettingsFileContent', () => {
  test('accepts valid JSON settings', () => {
    const result = validateSettingsFileContent('{"env": {"DEBUG": "1"}}')
    expect(result.isValid).toBe(true)
  })

  test('accepts empty object', () => {
    const result = validateSettingsFileContent('{}')
    expect(result.isValid).toBe(true)
  })

  test('rejects invalid JSON', () => {
    const result = validateSettingsFileContent('not json')
    expect(result.isValid).toBe(false)
    if (!result.isValid) {
      expect((result as any).error).toContain('Invalid JSON')
    }
  })

  test('rejects unknown keys in strict mode', () => {
    const result = validateSettingsFileContent('{"unknownField": true}')
    expect(result.isValid).toBe(false)
  })
})

describe('formatZodError', () => {
  test('formats invalid type error', () => {
    const result = SettingsSchema().safeParse({ effortLevel: 123 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = formatZodError(result.error, 'settings.json')
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]!.file).toBe('settings.json')
      expect(errors[0]!.path).toContain('effortLevel')
    }
  })
})

describe('named provider settings', () => {
  const profile = {
    protocol: 'openai-responses',
    baseUrl: 'https://llm.example/v1',
  } as const

  test('accepts multiple named Responses providers', () => {
    const result = SettingsSchema().safeParse({
      providers: {
        work: profile,
        local: {
          protocol: 'openai-responses',
          baseUrl: 'http://localhost:11434/v1',
        },
      },
      agentModels: {
        main: { model: 'main-model', provider: 'work' },
        subagent: { model: 'sub-model', provider: 'local' },
      },
    })
    expect(result.success).toBe(true)
  })

  test('rejects removed API protocols', () => {
    const result = SettingsSchema().safeParse({
      providers: {
        legacy: { ...profile, protocol: 'openai-completions' },
      },
      agentModels: {
        main: { model: 'main-model', provider: 'legacy' },
        subagent: { model: 'sub-model', provider: 'legacy' },
      },
    })
    expect(result.success).toBe(false)
  })

  test('requires both agent routes to reference configured profiles', () => {
    expect(
      SettingsSchema().safeParse({ providers: { work: profile } }).success,
    ).toBe(false)
    expect(
      SettingsSchema().safeParse({
        providers: { work: profile },
        agentModels: {
          main: { model: 'main-model', provider: 'missing' },
          subagent: { model: 'sub-model', provider: 'work' },
        },
      }).success,
    ).toBe(false)
  })

  test('rejects provider model fields without compatibility', () => {
    for (const models of [
      { fast: 'luna', deep: 'sol' },
      ['luna', 'terra', 'sol'],
    ]) {
      expect(
        SettingsSchema().safeParse({
          providers: {
            work: {
              ...profile,
              models,
            },
          },
          agentModels: {
            main: { model: 'main-model', provider: 'work' },
            subagent: { model: 'sub-model', provider: 'work' },
          },
        }).success,
      ).toBe(false)
    }

    expect(
      SettingsSchema().safeParse({
        providers: {
          work: {
            ...profile,
            model: 'terra',
          },
        },
        agentModels: {
          main: { model: 'main-model', provider: 'work' },
          subagent: { model: 'sub-model', provider: 'work' },
        },
      }).success,
    ).toBe(false)
  })
})
