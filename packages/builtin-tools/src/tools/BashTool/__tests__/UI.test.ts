import { describe, expect, test } from 'bun:test'
import { compactCommandDisplay, renderToolUseMessage } from '../UI.js'

describe('BashTool compact activity UI', () => {
  test('uses the concise description in the default view', () => {
    expect(
      renderToolUseMessage(
        {
          command: 'git status --short --branch',
          description: 'Check repository status',
        },
        { verbose: false, theme: 'dark' },
      ),
    ).toBe('Check repository status')
  })

  test('summarizes multiline commands instead of showing their body', () => {
    expect(compactCommandDisplay(`first line\n${'x'.repeat(120)}`)).toBe(
      'first (inline script)',
    )
  })

  test('summarizes a heredoc by executable instead of showing its body', () => {
    expect(
      compactCommandDisplay(
        "D:/anaconda3/python.exe - <<'PY'\nprint('detail')\nPY",
      ),
    ).toBe('python.exe (inline script)')
  })

  test('preserves the full command in verbose mode', () => {
    const command = 'first line\nsecond line'
    expect(
      renderToolUseMessage({ command }, { verbose: true, theme: 'dark' }),
    ).toBe(command)
  })
})
