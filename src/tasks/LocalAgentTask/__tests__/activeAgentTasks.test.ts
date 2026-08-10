import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAgentTaskFingerprint,
  releaseActiveAgentTask,
  reserveActiveAgentTask,
  resetActiveAgentTasksForTest,
} from '../activeAgentTasks.js'

afterEach(() => {
  resetActiveAgentTasksForTest()
})

describe('activeAgentTasks', () => {
  test('normalizes whitespace and case for duplicate detection', () => {
    expect(getAgentTaskFingerprint('Explore', 'Inspect   API\nRoutes')).toBe(
      getAgentTaskFingerprint('explore', ' inspect api routes '),
    )
  })

  test('rejects an identical active task and allows it after release', () => {
    expect(
      reserveActiveAgentTask('agent-1', 'Explore', 'Inspect API routes'),
    ).toBeUndefined()
    expect(
      reserveActiveAgentTask('agent-2', 'explore', ' inspect  api routes '),
    ).toBe('agent-1')

    releaseActiveAgentTask('agent-1')
    expect(
      reserveActiveAgentTask('agent-2', 'Explore', 'Inspect API routes'),
    ).toBeUndefined()
  })

  test('allows differentiated prompts and agent types', () => {
    expect(
      reserveActiveAgentTask('agent-1', 'Explore', 'Inspect API routes'),
    ).toBeUndefined()
    expect(
      reserveActiveAgentTask('agent-2', 'Explore', 'Review API route tests'),
    ).toBeUndefined()
    expect(
      reserveActiveAgentTask('agent-3', 'verification', 'Inspect API routes'),
    ).toBeUndefined()
  })
})
