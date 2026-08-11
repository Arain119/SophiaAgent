import { describe, expect, test } from 'bun:test'
import type { RenderableMessage } from '../../types/message.js'
import { collapseReadSearchGroups } from '../collapseReadSearch.js'

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
})
