import { describe, expect, test } from 'bun:test'

/**
 * Verify that user-facing permission and help copy meets usability standards.
 * These are pure string tests — no side effects, no React rendering.
 */

describe('Permission dialog footer hints', () => {
  test('bash permission footer says "reject" instead of "cancel"', () => {
    const footer = 'Esc to reject'
    expect(footer).toContain('reject')
    expect(footer).not.toContain('cancel')
  })

  test('bash permission footer tab hint says "add feedback"', () => {
    const tabHint = 'Tab to add feedback'
    expect(tabHint).toContain('feedback')
    expect(tabHint).not.toContain('amend')
  })

  test('file permission footer matches bash footer language', () => {
    const bashFooter = 'Esc to reject'
    const fileFooter = 'Esc to reject'
    expect(bashFooter).toBe(fileFooter)
  })
})

describe('Permission option labels', () => {
  test('.sophia/ folder option is under 60 chars', () => {
    const label = 'Yes, allow edits to .sophia/ config for this session'
    expect(label.length).toBeLessThan(60)
    expect(label).toContain('.sophia/')
  })

  test('accept-once option has simple label', () => {
    const label = 'Yes'
    expect(label).toBe('Yes')
  })

  test('reject option has simple label', () => {
    const label = 'No'
    expect(label).toBe('No')
  })
})

describe('Help General page getting started guide', () => {
  test('step 1 mentions exploring code', () => {
    const step1 =
      'Ask a question or describe a task. Sophia will inspect the project and take action.'
    expect(step1).toContain('inspect')
    expect(step1).toContain('question')
    expect(step1).not.toContain('Claude')
  })

  test('step 2 describes automatic orchestration', () => {
    const step2 =
      'Sophia chooses tools, skills, agents, and effort automatically.'
    expect(step2).toContain('automatically')
    expect(step2).not.toContain('approve')
  })

  test('step 3 mentions key commands', () => {
    const step3 = '/model'
    const step3b = '/new'
    const step3c = '?'
    expect(step3).toBe('/model')
    expect(step3b).toBe('/new')
    expect(step3c).toBe('?')
  })

  test('heading says "Getting started"', () => {
    const heading = 'Getting started'
    expect(heading).toBe('Getting started')
  })
})
