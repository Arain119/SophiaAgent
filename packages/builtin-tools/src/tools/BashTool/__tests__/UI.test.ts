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

  test('collapses multiline commands to one bounded line', () => {
    const output = compactCommandDisplay(`first line\n${'x'.repeat(120)}`)
    expect(output).not.toContain('\n')
    expect(output.length).toBe(96)
    expect(output.endsWith('…')).toBe(true)
  })

  test('preserves the full command in verbose mode', () => {
    const command = 'first line\nsecond line'
    expect(
      renderToolUseMessage({ command }, { verbose: true, theme: 'dark' }),
    ).toBe(command)
  })
})
