import { afterEach, describe, expect, test } from 'bun:test'
import { unlink } from 'fs/promises'
import {
  buildAgentResultIndex,
  buildAgentTerminalMemory,
  buildFailedAgentTerminalMemory,
  createCompletedRunLedger,
  getRecordedTerminalMemories,
  getTaskResultIndexPath,
  getTaskResultPath,
  parseLatestAgentRunLedgers,
  persistAgentTerminalArtifacts,
  recordTerminalMemory,
  resetAgentTerminalArtifactsForTest,
  retrieveAgentResult,
} from '../agentTerminalArtifacts.js'

afterEach(resetAgentTerminalArtifactsForTest)

describe('agentTerminalArtifacts', () => {
  test('recognizes Chinese terminal-memory headings', () => {
    const memory = buildAgentTerminalMemory(
      '# 结果\n已修复连接。\n# 决策\n- 使用密钥\n# 证据\n- 日志正常\n# 验证\n- 测试通过\n# 剩余工作\n- 轮换旧密码',
    )
    expect(memory).toEqual({
      outcome: '已修复连接。',
      decisions: ['使用密钥'],
      evidence: ['日志正常'],
      verification: ['测试通过'],
      remainingWork: ['轮换旧密码'],
    })
  })
  test('extracts structured terminal sections', () => {
    const memory = buildAgentTerminalMemory(`# Outcome
Implemented routing.
# Decisions
- Exact forks inherit the main route.
# Verification
- bun test passed
# Remaining work
- Monitor cache hit rate`)
    expect(memory.outcome).toContain('Implemented routing')
    expect(memory.decisions).toEqual(['Exact forks inherit the main route.'])
    expect(memory.verification).toEqual(['bun test passed'])
    expect(memory.remainingWork).toEqual(['Monitor cache hit rate'])
  })

  test('salvages confirmed partial progress from a failed branch', () => {
    const memory = buildFailedAgentTerminalMemory('request timed out', [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Confirmed the routing entry point.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
          ],
        },
      } as unknown as import('../../../types/message.js').AssistantMessage,
    ])
    expect(memory.outcome).toContain('Partial progress before failure')
    expect(memory.evidence).toContain('Confirmed the routing entry point.')
    expect(memory.evidence).toContain('Executed tools before failure: Read')
    expect(memory.evidence).toContain('Failure: request timed out')
    expect(memory.remainingWork[0]).toContain('incomplete')
  })

  test('builds heading-based result index', () => {
    const index = buildAgentResultIndex(
      'task-1',
      '# Findings\nA\nB\n# Tests\nPassed',
    )
    expect(index.sections).toHaveLength(2)
    expect(index.sections[0]).toMatchObject({
      heading: 'Findings',
      startLine: 1,
      endLine: 3,
    })
    expect(index.sections[1]!.excerpt).toContain('Passed')
  })

  test('retains terminal memories independently of task eviction', () => {
    const memory = buildAgentTerminalMemory('Completed the task.')
    recordTerminalMemory('task-1', memory)
    expect(getRecordedTerminalMemories()).toEqual([
      { taskId: 'task-1', memory },
    ])
  })

  test('records route, usage, and cache hit rate in the completed ledger', () => {
    const memory = buildAgentTerminalMemory('Completed.')
    const ledger = createCompletedRunLedger(
      {
        taskId: 'task-1',
        agentType: 'Explore',
        description: 'inspect routes',
        model: 'main-model',
        provider: 'main-provider',
        effort: 'high',
        isExactContext: true,
        startTime: 1,
      },
      {
        agentId: 'task-1',
        agentType: 'Explore',
        content: [{ type: 'text', text: 'Completed.' }],
        totalDurationMs: 500,
        totalTokens: 150,
        totalToolUseCount: 3,
        usage: {
          input_tokens: 20,
          output_tokens: 30,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 60,
          server_tool_use: null,
          service_tier: null,
          cache_creation: null,
        },
      },
      memory,
    )
    expect(ledger).toMatchObject({
      model: 'main-model',
      provider: 'main-provider',
      effort: 'high',
      isExactContext: true,
      cacheHitRate: 0.6,
      toolUses: 3,
    })
  })

  test('retrieves a result by section and keyword context', async () => {
    const taskId = `retrieval-${Date.now()}`
    const text = [
      '# Findings',
      'The cache route is stable.',
      'Evidence line.',
      '# Verification',
      'Targeted tests passed.',
      'Full suite passed.',
    ].join('\n')
    await persistAgentTerminalArtifacts(taskId, text)
    try {
      const section = await retrieveAgentResult(taskId, {
        section: 'verification',
      })
      expect(section).toMatchObject({
        mode: 'section',
        matchedSections: ['Verification'],
        matchedLines: [4, 6],
      })
      expect(section!.content).toContain('Targeted tests passed')
      expect(section!.content).not.toContain('cache route')

      const query = await retrieveAgentResult(taskId, { query: 'cache route' })
      expect(query!.mode).toBe('query')
      expect(query!.matchedLines).toEqual([2])
      expect(query!.matchedSections).toEqual(['Findings'])
    } finally {
      await Promise.all([
        unlink(getTaskResultPath(taskId)),
        unlink(getTaskResultIndexPath(taskId)),
      ])
    }
  })

  test('restores the latest ledger snapshot and ignores a partial tail', () => {
    const running = {
      taskId: 'task-restore',
      agentType: 'Explore',
      description: 'inspect',
      isExactContext: false,
      status: 'running' as const,
      startTime: 1,
    }
    const completed = {
      ...running,
      status: 'completed' as const,
      endTime: 2,
      consumedAt: 3,
    }
    const ledgers = parseLatestAgentRunLedgers(
      `${JSON.stringify(running)}\n${JSON.stringify(completed)}\n{"partial":`,
    )
    expect(ledgers).toEqual([completed])
  })
})
