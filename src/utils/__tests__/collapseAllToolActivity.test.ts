import { describe, expect, test } from 'bun:test'
import type { RenderableMessage } from '../../types/message.js'
import {
  collapseReadSearchGroups,
  compactActivityHint,
} from '../collapseReadSearch.js'

function toolUse(name: string, id: string, input: unknown): RenderableMessage {
  return {
    type: 'assistant',
    uuid: `assistant-${id}`,
    message: {
      id: `message-${id}`,
      role: 'assistant',
      model: 'test',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: 'tool_use', id, name, input }],
    },
  } as RenderableMessage
}

function result(id: string): RenderableMessage {
  return {
    type: 'user',
    uuid: `result-${id}`,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }],
    },
    toolUseResult: { stdout: 'ok' },
  } as RenderableMessage
}

const bashTool = {
  name: 'Bash',
  aliases: [],
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
}

describe('compact all tool activity', () => {
  test('groups commands and task checks into one activity summary', () => {
    const messages = [
      toolUse('Bash', 'bash-1', { command: 'git status' }),
      result('bash-1'),
      toolUse('TaskOutput', 'task-1', { task_id: 'job-1', block: false }),
      result('task-1'),
    ]
    const collapsed = collapseReadSearchGroups(messages, [bashTool] as never)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.type).toBe('collapsed_read_search')
    if (collapsed[0]?.type !== 'collapsed_read_search') return
    expect(collapsed[0].bashCount).toBe(1)
    expect(collapsed[0].taskCheckCount).toBe(1)
    expect(collapsed[0].messages).toHaveLength(4)
  })

  test('leaves unknown tools visible instead of swallowing plugin output', () => {
    const message = toolUse('UnknownPluginTool', 'plugin-1', {})
    expect(collapseReadSearchGroups([message], [bashTool] as never)).toEqual([
      message,
    ])
  })

  test('does not group internal tools with no visible activity name', () => {
    const use = toolUse('EnterPlanMode', 'plan-1', {})
    const toolResult = result('plan-1')
    const hiddenTool = {
      name: 'EnterPlanMode',
      aliases: [],
      userFacingName: () => '',
    }

    expect(
      collapseReadSearchGroups([use, toolResult], [
        bashTool,
        hiddenTool,
      ] as never),
    ).toEqual([use, toolResult])
  })

  test('keeps the latest activity detail to one short line', () => {
    const hint = compactActivityHint(`run tests\n${'x'.repeat(120)}`)
    expect(hint).not.toContain('\n')
    expect(hint.length).toBe(96)
    expect(hint.endsWith('…')).toBe(true)
  })

  test('prefers a concise bash description over the raw command', () => {
    const collapsed = collapseReadSearchGroups(
      [
        toolUse('Bash', 'bash-1', {
          command: `bun test ${'very-long-path/'.repeat(20)}`,
          description: 'Run focused tests',
        }),
      ],
      [bashTool] as never,
    )
    expect(collapsed[0]?.type).toBe('collapsed_read_search')
    if (collapsed[0]?.type !== 'collapsed_read_search') return
    expect(collapsed[0].latestDisplayHint).toBe('Run focused tests')
  })
})
