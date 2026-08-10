import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'

describe('dependency security overrides', () => {
  test('mcpb can load patched inquirer prompts from its package context', async () => {
    const mcpbRequire = createRequire(import.meta.resolve('@anthropic-ai/mcpb'))
    const promptsPath = mcpbRequire.resolve('@inquirer/prompts')
    const prompts = (await import(promptsPath)) as {
      input?: unknown
      select?: unknown
    }
    expect(typeof prompts.input).toBe('function')
    expect(typeof prompts.select).toBe('function')
  })
})
