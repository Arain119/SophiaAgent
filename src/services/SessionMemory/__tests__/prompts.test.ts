import { afterAll, describe, test, expect, mock, beforeEach } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Mock infrastructure ─────────────────────────────────────────────────────
// All mock.module calls must precede the import of the module under test.
// mock.module is process-global; mocks here must cover all exported names used
// transitively so sibling test files are not broken by an incomplete mock.
//
// To prevent cross-file pollution (skill prefetch / skillLearning smoke,
// model.test.ts, providers.test.ts), keep the mock surface ONLY for the
// names this suite actually exercises, and delegate to behavior that matches
// the real impl (e.g. isEnvTruthy parses '0'/'false'/'no'/'off' as falsy).
// A sentinel flag flipped in afterAll lets us scope the suite-specific
// override (mocked main-loop model, mocked effort level, fixed config dir).
let useMockForSessionMemory = true
afterAll(() => {
  useMockForSessionMemory = false
})

const mockGetMainLoopModel = mock(() => 'claude-opus-4-7')
const mockGetDisplayedEffortLevel = mock((): string => 'high')

const realIsEnvTruthy = (v: string | boolean | undefined): boolean => {
  if (!v) return false
  if (typeof v === 'boolean') return v
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase().trim())
}

// Inline a minimum env-driven default-Opus resolver so getDefaultOpusModel
// .test.ts (running in the same process) sees env-precedence semantics
// after this suite's flag flips off. Keep aligned with
// src/utils/model/model.ts getDefaultOpusModel().
function resolveDefaultOpusModelForTests(): string {
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL)
    return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  return 'claude-opus-4-7'
}

// Inline the real firstPartyNameToCanonical logic so its semantics survive
// even after this suite's mock wins the registration race. Pre-importing
// model.ts hangs the test process due to heavy transitive deps.
function realFirstPartyNameToCanonical(name: string): string {
  name = name.toLowerCase()
  if (name.includes('claude-opus-4-7')) return 'claude-opus-4-7'
  if (name.includes('claude-opus-4-6')) return 'claude-opus-4-6'
  if (name.includes('claude-opus-4-5')) return 'claude-opus-4-5'
  if (name.includes('claude-opus-4-1')) return 'claude-opus-4-1'
  if (name.includes('claude-opus-4')) return 'claude-opus-4'
  if (name.includes('claude-sonnet-4-6')) return 'claude-sonnet-4-6'
  if (name.includes('claude-sonnet-4-5')) return 'claude-sonnet-4-5'
  if (name.includes('claude-sonnet-4')) return 'claude-sonnet-4'
  if (name.includes('claude-haiku-4-5')) return 'claude-haiku-4-5'
  if (name.includes('claude-3-7-sonnet')) return 'claude-3-7-sonnet'
  if (name.includes('claude-3-5-sonnet')) return 'claude-3-5-sonnet'
  if (name.includes('claude-3-5-haiku')) return 'claude-3-5-haiku'
  if (name.includes('claude-3-opus')) return 'claude-3-opus'
  if (name.includes('claude-3-sonnet')) return 'claude-3-sonnet'
  if (name.includes('claude-3-haiku')) return 'claude-3-haiku'
  const m = name.match(/(claude-(\d+-\d+-)?\w+)/)
  if (m && m[1]) return m[1]
  return name
}

mock.module('src/services/promptRuntime-model-test-only.js', () => ({
  getMainLoopModel: mockGetMainLoopModel,
  getSmallFastModel: mock(() => 'claude-haiku'),
  getUserSpecifiedModelSetting: mock(() => undefined),
  getBestModel: mock(() => 'claude-opus-4-7'),
  getDefaultOpusModel: mock(() =>
    useMockForSessionMemory
      ? 'claude-opus-4-7'
      : resolveDefaultOpusModelForTests(),
  ),
  getDefaultSonnetModel: mock(() => 'claude-sonnet-4-6'),
  getDefaultHaikuModel: mock(() => 'claude-haiku-3-5'),
  getRuntimeMainLoopModel: mock(() => 'claude-opus-4-7'),
  getDefaultMainLoopModelSetting: mock(() => 'claude-opus-4-7'),
  getDefaultMainLoopModel: mock(() => 'claude-opus-4-7'),
  firstPartyNameToCanonical: mock((n: string) =>
    realFirstPartyNameToCanonical(n),
  ),
  getCanonicalName: mock((n: string) => n),
  getClaudeAiUserDefaultModelDescription: mock(() => ''),
  renderDefaultModelSetting: mock(() => ''),
  getOpusPricingSuffix: mock(() => ''),
  isOpus1mMergeEnabled: mock(() => false),
  renderModelSetting: mock((s: string) => s),
  getPublicModelDisplayName: mock(() => null),
  renderModelName: mock((n: string) => n),
  getPublicModelName: mock((n: string) => n),
  parseUserSpecifiedModel: mock((m: string) => m),
  resolveSkillModelOverride: mock(() => undefined),
  isLegacyModelRemapEnabled: mock(() => false),
  modelDisplayString: mock(() => ''),
  getMarketingNameForModel: mock(() => undefined),
  normalizeModelStringForAPI: mock((m: string) => m),
  isNonCustomOpusModel: mock(() => false),
}))

mock.module('src/services/promptRuntime.js', () => ({
  getPromptRuntime: () => ({
    model: mockGetMainLoopModel(),
    effort: mockGetDisplayedEffortLevel(),
    cwd: process.cwd(),
  }),
  getDisplayedEffortLevel: mockGetDisplayedEffortLevel as (
    _m: string,
    _e: unknown,
  ) => string,
  getEffortEnvOverride: mock(() => undefined),
  resolveAppliedEffort: mock(() => 'high'),
  getInitialEffortSetting: mock(() => undefined),
  parseEffortValue: mock(() => undefined),
  toPersistableEffort: mock(() => undefined),
  modelSupportsEffort: mock(() => true),
  modelSupportsMaxEffort: mock(() => true),
  modelSupportsXhighEffort: mock(() => false),
  isEffortLevel: mock(() => true),
  getEffortSuffix: mock(() => ''),
  convertEffortValueToLevel: mock(() => 'high'),
  getDefaultEffortForModel: mock(() => undefined),
  getEffortLevelDescription: mock(() => ''),
  getEffortValueDescription: mock(() => ''),
  getOpusDefaultEffortConfig: mock(() => ({
    enabled: true,
    dialogTitle: '',
    dialogDescription: '',
  })),
  resolvePickerEffortPersistence: mock(() => undefined),
  isValidNumericEffort: mock(() => false),
  EFFORT_LEVELS: ['low', 'medium', 'high', 'xhigh', 'max'],
}))

// Use REAL semantics for non-overridden envUtils exports — this mock is
// process-global, so envUtils.test.ts and other consumers running in the
// same process must see correct behavior.
const realIsEnvDefinedFalsy = (v: string | boolean | undefined): boolean => {
  if (v === undefined) return false
  if (typeof v === 'boolean') return !v
  if (!v) return false
  return ['0', 'false', 'no', 'off'].includes(v.toLowerCase().trim())
}
// Real getSophiaConfigHomeDir is memoized via lodash, so consumers may call
// `.cache.clear()` on it. Provide a no-op .cache stub.
const mockedGetClaudeConfigHomeDirSM: (() => string) & {
  cache: { clear: () => void; get: (k: unknown) => unknown }
} = Object.assign(
  () =>
    useMockForSessionMemory
      ? '/mock/home/.claude'
      : (process.env.SOPHIA_CONFIG_DIR ?? join(homedir(), '.sophia')).normalize(
          'NFC',
        ),
  { cache: { clear: () => {}, get: (_k: unknown) => undefined } },
)

mock.module('src/utils/envUtils.js', () => ({
  getSophiaConfigHomeDir: mockedGetClaudeConfigHomeDirSM,
  isEnvTruthy: realIsEnvTruthy,
  getEnvBool: () => false,
  getEnvNumber: () => undefined,
  getTeamsDir: () =>
    join(
      useMockForSessionMemory
        ? '/mock/home/.claude'
        : (process.env.SOPHIA_CONFIG_DIR ?? join(homedir(), '.sophia')),
      'teams',
    ),
  hasNodeOption: (flag: string) => {
    const opts = process.env.NODE_OPTIONS
    return !!opts && opts.split(/\s+/).includes(flag)
  },
  isEnvDefinedFalsy: realIsEnvDefinedFalsy,
  isBareMode: () =>
    realIsEnvTruthy(process.env.SOPHIA_SIMPLE) ||
    process.argv.includes('--bare'),
  parseEnvVars: (rawEnvArgs: string[] | undefined) => {
    const parsed: Record<string, string> = {}
    if (rawEnvArgs) {
      for (const envStr of rawEnvArgs) {
        const [key, ...valueParts] = envStr.split('=')
        if (!key || valueParts.length === 0) {
          throw new Error(
            `Invalid environment variable format: ${envStr}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
          )
        }
        parsed[key] = valueParts.join('=')
      }
    }
    return parsed
  },
  shouldMaintainProjectWorkingDir: () =>
    realIsEnvTruthy(process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR),
  isRunningOnHomespace: () =>
    process.env.USER_TYPE === 'ant' &&
    realIsEnvTruthy(process.env.COO_RUNNING_ON_HOMESPACE),
  isInProtectedNamespace: () => false,
}))

mock.module('src/utils/log.js', () => ({
  logError: mock(() => {}),
  getLogDisplayTitle: mock(() => ''),
  dateToFilename: mock((d: Date) => d.toISOString()),
  attachErrorLogSink: mock(() => {}),
  getInMemoryErrors: mock(() => []),
  loadErrorLogs: mock(async () => []),
  getErrorLogByIndex: mock(async () => null),
  logMCPError: mock(() => {}),
  logMCPDebug: mock(() => {}),
  captureAPIRequest: mock(() => {}),
  _resetErrorLogForTesting: mock(() => {}),
}))

mock.module('src/services/tokenEstimation.js', () => ({
  roughTokenCountEstimation: mock((s: string) => Math.ceil(s.length / 4)),
  countTokens: mock(async () => 0),
}))

mock.module('src/utils/errors.js', () => ({
  getErrnoCode: mock((e: unknown) => (e as NodeJS.ErrnoException)?.code),
  toError: mock((e: unknown) =>
    e instanceof Error ? e : new Error(String(e)),
  ),
}))

// Mock fs/promises so loadSessionMemoryPrompt() and loadSessionMemoryTemplate()
// return our controlled templates. Once afterAll flips
// useMockForSessionMemory off, readFile delegates to the real impl so
// sibling tests in the same process (skill prefetch, skillLearning smoke)
// still see real disk reads. We must list every export the prefetch /
// skillLearning paths use so this process-global mock doesn't strip names
// to undefined.
//
// Instead of pre-importing node:fs/promises (which can interact poorly
// with bun:test mock processing), use require() at mock-factory-call time
// to fetch the real module lazily.
const mockReadFileFsPromises = mock(
  async (_path: string, _opts?: unknown): Promise<string> => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  },
)

mock.module('fs/promises', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require('node:fs/promises') as Record<string, unknown>
  return {
    ...real,
    readFile: ((path: unknown, opts?: unknown) => {
      if (useMockForSessionMemory) {
        return mockReadFileFsPromises(path as string, opts)
      }
      return (real.readFile as (...a: unknown[]) => unknown)(
        path as string,
        opts,
      )
    }) as typeof real.readFile,
  }
})

// ── Import module under test (after all mock.module calls) ──────────────────
import {
  buildSessionMemoryUpdatePrompt,
  DEFAULT_SESSION_MEMORY_TEMPLATE,
} from '../prompts.js'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('buildSessionMemoryUpdatePrompt – dynamic variable substitution', () => {
  beforeEach(() => {
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')
    mockGetDisplayedEffortLevel.mockReturnValue('high')
    // Default: ENOENT so the built-in default prompt is used
    mockReadFileFsPromises.mockImplementation(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
  })

  test('substitutes {{CLAUDE_MODEL}} with the current model', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return 'Model: {{CLAUDE_MODEL}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('Model: claude-opus-4-7')
    expect(result).not.toContain('{{CLAUDE_MODEL}}')
  })

  test('substitutes {{CLAUDE_EFFORT}} with the current effort level', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return 'Effort: {{CLAUDE_EFFORT}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetDisplayedEffortLevel.mockReturnValue('high')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('Effort: high')
    expect(result).not.toContain('{{CLAUDE_EFFORT}}')
  })

  test('substitutes {{CLAUDE_CWD}} with process.cwd()', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md')) return 'CWD: {{CLAUDE_CWD}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain(`CWD: ${process.cwd()}`)
    expect(result).not.toContain('{{CLAUDE_CWD}}')
  })

  test('substitutes all three dynamic variables in one template', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return 'effort={{CLAUDE_EFFORT}} model={{CLAUDE_MODEL}} cwd={{CLAUDE_CWD}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-sonnet-4-6')
    mockGetDisplayedEffortLevel.mockReturnValue('medium')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('effort=medium')
    expect(result).toContain('model=claude-sonnet-4-6')
    expect(result).toContain(`cwd=${process.cwd()}`)
  })

  test('leaves unknown template variables unchanged', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return '{{UNKNOWN_VAR}} {{CLAUDE_MODEL}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-opus-4-7')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('{{UNKNOWN_VAR}}')
    expect(result).toContain('claude-opus-4-7')
  })

  test('existing substitution variables still work alongside new ones', async () => {
    mockReadFileFsPromises.mockImplementation(async (path: string) => {
      if ((path as string).includes('prompt.md'))
        return '{{notesPath}} effort={{CLAUDE_EFFORT}} model={{CLAUDE_MODEL}}'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockGetMainLoopModel.mockReturnValue('claude-haiku')
    mockGetDisplayedEffortLevel.mockReturnValue('low')

    const result = await buildSessionMemoryUpdatePrompt('notes', '/notes.md')
    expect(result).toContain('/notes.md')
    expect(result).toContain('effort=low')
    expect(result).toContain('model=claude-haiku')
  })

  test('uses a compact terminal-state template without instruction lines', () => {
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE).toContain('# Active Tasks')
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE).toContain('# Completed Outcomes')
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE).toContain(
      '# Evidence and Verification',
    )
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE).not.toContain('# Worklog')
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE).not.toMatch(/^_/m)
  })

  test('normalizes old memory into the current template', async () => {
    const result = await buildSessionMemoryUpdatePrompt(
      '# Worklog\n- obsolete chronology',
      '/notes.md',
    )
    expect(result).toContain('<memory_template>')
    expect(result).toContain('# Blockers and Next Actions')
    expect(result).toContain('remove obsolete headers')
  })

  test('includes structured terminal task memories', async () => {
    const result = await buildSessionMemoryUpdatePrompt(
      'notes',
      '/notes.md',
      '[{"taskId":"task-1","memory":{"outcome":"Tests passed"}}]',
    )
    expect(result).toContain('<terminal_task_memories>')
    expect(result).toContain('Tests passed')
  })
})
