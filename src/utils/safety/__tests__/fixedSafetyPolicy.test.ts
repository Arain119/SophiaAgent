import { describe, expect, test } from 'bun:test'
import type { SafetyDecision } from '../../../types/safety.js'
import { applyFixedSafetyPolicy } from '../fixedSafetyPolicy.js'

function ask(
  overrides: Partial<Extract<SafetyDecision, { behavior: 'ask' }>> = {},
): Extract<SafetyDecision, { behavior: 'ask' }> {
  return {
    behavior: 'ask',
    message: 'Approval required',
    ...overrides,
  }
}

describe('applyFixedSafetyPolicy', () => {
  test('allows ordinary requests without prompting', () => {
    expect(
      applyFixedSafetyPolicy('Write', { file_path: 'a.ts' }, ask()),
    ).toEqual({
      behavior: 'allow',
      updatedInput: { file_path: 'a.ts' },
      userModified: false,
      decisionReason: { type: 'mode', mode: 'auto' },
    })
  })

  test('preserves updated input', () => {
    const result = applyFixedSafetyPolicy(
      'Edit',
      { file_path: 'a.ts' },
      ask({ updatedInput: { file_path: 'b.ts' } }),
    )
    expect(result.behavior).toBe('allow')
    expect(result.behavior === 'allow' && result.updatedInput).toEqual({
      file_path: 'b.ts',
    })
  })

  test('preserves existing allow and deny decisions', () => {
    const allow: SafetyDecision = { behavior: 'allow' }
    const deny: SafetyDecision = {
      behavior: 'deny',
      message: 'blocked',
      decisionReason: { type: 'other', reason: 'blocked' },
    }
    expect(applyFixedSafetyPolicy('Read', {}, allow)).toBe(allow)
    expect(applyFixedSafetyPolicy('Read', {}, deny)).toBe(deny)
  })

  test('ignores legacy permission rules', () => {
    const rule = {
      source: 'userSettings' as const,
      ruleBehavior: 'deny' as const,
      ruleValue: { toolName: 'Write' },
    }
    expect(
      applyFixedSafetyPolicy(
        'Write',
        { file_path: 'a.ts' },
        {
          behavior: 'deny',
          message: 'legacy rule',
          decisionReason: { type: 'rule', rule },
        },
      ).behavior,
    ).toBe('allow')
  })

  test.each(['safetyCheck', 'workingDir', 'sandboxOverride'] as const)(
    'denies %s boundaries',
    type => {
      const decisionReason =
        type === 'safetyCheck'
          ? { type, reason: 'sensitive path', classifierApprovable: false }
          : type === 'workingDir'
            ? { type, reason: 'outside workspace' }
            : { type, reason: 'dangerouslyDisableSandbox' as const }
      expect(
        applyFixedSafetyPolicy('Write', {}, ask({ decisionReason })).behavior,
      ).toBe('deny')
    },
  )

  test('denies malformed Bash while allowing a parsed ordinary command', () => {
    expect(
      applyFixedSafetyPolicy(
        'Bash',
        { command: 'echo $(unterminated' },
        ask({
          isBashSecurityCheckForMisparsing: true,
          decisionReason: {
            type: 'other',
            reason: 'Cannot safely parse command',
          },
        }),
      ).behavior,
    ).toBe('deny')
    expect(
      applyFixedSafetyPolicy(
        'Bash',
        { command: 'bun test' },
        ask({
          decisionReason: {
            type: 'other',
            reason: 'This command requires an internal safety decision',
          },
        }),
      ).behavior,
    ).toBe('allow')
  })

  test.each([
    'UNC network path detected',
    'Path contains suspicious Windows-specific patterns',
    'Path may access network resources',
  ])('denies unverifiable path boundary: %s', reason => {
    expect(
      applyFixedSafetyPolicy(
        'Read',
        { file_path: '//server/share/file.txt' },
        ask({ decisionReason: { type: 'other', reason } }),
      ).behavior,
    ).toBe('deny')
  })

  test('denies destructive Bash and PowerShell commands', () => {
    expect(
      applyFixedSafetyPolicy('Bash', { command: 'git reset --hard' }, ask())
        .behavior,
    ).toBe('deny')
    expect(
      applyFixedSafetyPolicy(
        'PowerShell',
        { command: 'Clear-Disk -Number 0' },
        ask(),
      ).behavior,
    ).toBe('deny')
  })

  test('preserves AskUserQuestion as a semantic interaction', () => {
    expect(
      applyFixedSafetyPolicy(
        'AskUserQuestion',
        { questions: [] },
        ask({ decisionReason: { type: 'other', reason: 'Needs interaction' } }),
      ).behavior,
    ).toBe('ask')
  })
})
