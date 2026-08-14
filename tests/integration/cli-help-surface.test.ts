import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { getBuildFeatures } from '../../scripts/defines.ts'
import { CORE_COMMAND_NAMES, CORE_TOOL_NAMES } from '../../src/coreSurface.ts'

const mainSource = readFileSync(
  new URL('../../src/main.tsx', import.meta.url),
  'utf8',
)
const entrypointSource = readFileSync(
  new URL('../../src/entrypoints/cli.tsx', import.meta.url),
  'utf8',
)
const replSource = readFileSync(
  new URL('../../src/screens/REPL.tsx', import.meta.url),
  'utf8',
)
const providerSource = readFileSync(
  new URL('../../src/components/ProviderConfig.tsx', import.meta.url),
  'utf8',
)
const onboardingSource = readFileSync(
  new URL('../../src/components/Onboarding.tsx', import.meta.url),
  'utf8',
)
const configSource = readFileSync(
  new URL('../../src/utils/config.ts', import.meta.url),
  'utf8',
)
describe('CLI help surface', () => {
  test('ships one Core build without optional features', () => {
    expect(getBuildFeatures()).toEqual([])
  })

  test('does not expose legacy management commands or options', () => {
    for (const command of ['mcp', 'plugin', 'agents', 'doctor']) {
      expect(mainSource).not.toContain(`.command('${command}')`)
    }

    for (const declaration of [
      "'--agent <agent>'",
      "'--agents <json>'",
      "'--bare'",
      "'--betas <betas...>'",
      "'--file <specs...>'",
      "'--from-pr [value]'",
      "'--ide'",
      "'--max-budget-usd <amount>'",
      "'--mcp-config <configs...>'",
      "'--mcp-debug'",
      "'--plugin-dir <path>'",
      "'--setting-sources <sources>'",
      "'--settings <file-or-json>'",
      "'--strict-mcp-config'",
      "'--tmux'",
      "'--tools <tools...>'",
      "'-w, --worktree [name]'",
    ]) {
      expect(mainSource).not.toContain(declaration)
    }
  })

  test('removes unsupported autonomy and Weixin entrypoints', () => {
    expect(mainSource).not.toContain("program.command('autonomy')")
    expect(entrypointSource).not.toContain("args[0] === 'autonomy'")
    expect(entrypointSource).not.toContain("args[0] === 'weixin'")
  })

  test('ships browser automation as a normal Core tool', () => {
    expect(CORE_TOOL_NAMES).toContain('WebBrowser')
    expect(CORE_COMMAND_NAMES).not.toContain('browser')
  })

  test('uses Sophia Agent in visible CLI product copy', () => {
    expect(mainSource).toContain(".name('sophia')")
    expect(mainSource).toContain('Sophia Agent - starts an interactive session')
    const versionCopy = '$' + '{MACRO.VERSION} (Sophia Agent)'
    expect(mainSource).toContain(versionCopy)
    expect(entrypointSource).toContain(versionCopy)
    expect(mainSource).toContain("process.title = 'sophia'")
    expect(mainSource).not.toContain("process.title = 'claude'")
    expect(replSource).toContain(
      'import { MODEL_SPINNER_FRAME_MS, MODEL_SPINNER_FRAMES }',
    )
    expect(replSource).toContain(
      'setFrame(f => (f + 1) % MODEL_SPINNER_FRAMES.length)',
    )
    expect(replSource).toContain('MODEL_SPINNER_FRAME_MS')
    expect(replSource).not.toContain('TITLE_ANIMATION_FRAMES')
    expect(replSource).not.toContain('TITLE_STATIC_PREFIX')
  })

  test('removes direct-connect, ACP, and remote-control surfaces', () => {
    expect(mainSource).not.toContain(".command('open <sophia-url>')")
    expect(mainSource).not.toContain(".command('server')")
    expect(mainSource).not.toContain(".command('remote-control'")
    expect(entrypointSource).not.toContain('--acp')
    expect(entrypointSource).not.toContain("args[0] === 'remote-control'")
    expect(mainSource).not.toContain(".command('ssh <host> [dir]')")
  })

  test('does not expose permission controls', () => {
    expect(mainSource).not.toContain('--permission-mode')
    expect(mainSource).not.toContain('--dangerously-skip-permissions')
    expect(mainSource).not.toContain('--allow-dangerously-skip-permissions')
    expect(mainSource).not.toContain('--permission-prompt-tool')
    expect(mainSource).not.toContain('--allowed-tools')
    expect(mainSource).not.toContain('--disallowed-tools')
  })

  test('uses one Model command and no account login commands', () => {
    expect(CORE_COMMAND_NAMES).toContain('model')
    expect(CORE_COMMAND_NAMES).not.toContain('login')
    expect(CORE_COMMAND_NAMES).not.toContain('logout')
    expect(CORE_COMMAND_NAMES).not.toContain('auth')
    expect(mainSource).not.toContain(".command('auth')")
    expect(mainSource).not.toContain('cli/handlers/auth')
  })
  test('keeps provider management concise and protocol-neutral', () => {
    expect(providerSource).toContain('Providers')
    expect(providerSource).toContain('Provider details')
    expect(providerSource).toContain('Add provider')
    expect(providerSource).not.toMatch(/anthropic-messages|openai-completions/)
    expect(providerSource).not.toMatch(/Gemini|ChatGPT|OAuth/)
  })

  test('keeps only the reduced public command surface', () => {
    expect(CORE_COMMAND_NAMES).toEqual([
      'new',
      'resume',
      'effort',
      'usage',
      'model',
      'exit',
    ])
    for (const removed of [
      'clear',
      'config',
      'diff',
      'doctor',
      'init',
      'memory',
      'tasks',
    ]) {
      expect([...CORE_COMMAND_NAMES]).not.toContain(removed)
    }
  })

  test('uses automatic theme selection without an onboarding theme step', () => {
    expect(configSource).toContain("theme: 'auto'")
    expect(onboardingSource).not.toContain('ThemePicker')
    expect(onboardingSource).not.toContain("id: 'theme'")
  })
})
