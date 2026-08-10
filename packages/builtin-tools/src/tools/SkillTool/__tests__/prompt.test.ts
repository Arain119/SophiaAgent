import { describe, expect, test } from 'bun:test'
import { getPrompt } from '../prompt.js'

describe('Skill tool prompt', () => {
  test('describes task-based automatic selection', () => {
    const prompt = getPrompt()

    expect(prompt).toContain('Describe the task, not a skill name')
    expect(prompt).toContain('audited GitHub skills')
    expect(prompt).toContain('pins the selected repository commit')
    expect(prompt).toContain('frontend works but its visual quality')
  })

  test('does not advertise direct slash invocation', () => {
    const prompt = getPrompt()

    expect(prompt).not.toContain('/skill-name')
    expect(prompt).not.toContain('skill: "pdf"')
  })
})
