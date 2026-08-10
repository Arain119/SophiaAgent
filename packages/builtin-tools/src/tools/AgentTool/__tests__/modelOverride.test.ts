import { describe, expect, test } from 'bun:test'
import { inputSchema } from '../AgentTool.js'

describe('AgentTool model override', () => {
  const baseInput = {
    description: 'research API',
    prompt: 'Inspect the API implementation.',
    subagent_type: 'worker',
    effort: 'medium' as const,
  }

  test('does not expose subagent model selection', () => {
    expect(inputSchema().safeParse(baseInput).success).toBe(true)
    expect('model' in inputSchema().shape).toBe(false)
  })
  test('requires and accepts all five subagent effort levels', () => {
    const { effort: _effort, ...withoutEffort } = baseInput
    expect(inputSchema().safeParse(withoutEffort).success).toBe(false)
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(inputSchema().safeParse({ ...baseInput, effort }).success).toBe(
        true,
      )
    }
  })

  test('rejects invalid subagent effort values', () => {
    for (const effort of ['auto', 'ultracode', 'maximum', 100]) {
      expect(inputSchema().safeParse({ ...baseInput, effort }).success).toBe(
        false,
      )
    }
  })
})
