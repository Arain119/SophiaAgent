import { describe, expect, test } from 'bun:test'
import type { RenderableMessage } from '../../types/message.js'
import { collapseTaskOutputPolls } from '../collapseTaskOutputPolls.js'

function poll(taskId: string, toolUseId: string): RenderableMessage {
  return {
    type: 'assistant',
    uuid: `assistant-${toolUseId}`,
    message: {
      id: `message-${toolUseId}`,
      role: 'assistant',
      model: 'test',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'TaskOutput',
          input: { task_id: taskId, block: false },
        },
      ],
    },
  } as RenderableMessage
}

function result(toolUseId: string, isError = false): RenderableMessage {
  return {
    type: 'user',
    uuid: `result-${toolUseId}`,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'status',
          is_error: isError,
        },
      ],
    },
    toolUseResult: { retrieval_status: 'not_ready' },
  } as RenderableMessage
}

describe('collapseTaskOutputPolls', () => {
  test('keeps only the latest successful poll for each task', () => {
    const messages = [
      poll('task-a', 'a1'),
      result('a1'),
      poll('task-a', 'a2'),
      result('a2'),
    ]
    const collapsed = collapseTaskOutputPolls(messages, false)
    expect(collapsed.map(message => String(message.uuid))).toEqual([
      'assistant-a2',
      'result-a2',
    ])
  })

  test('does not merge polls from different tasks', () => {
    const messages = [
      poll('task-a', 'a1'),
      result('a1'),
      poll('task-b', 'b1'),
      result('b1'),
    ]
    expect(collapseTaskOutputPolls(messages, false)).toHaveLength(4)
  })

  test('keeps errors and unresolved calls while removing stale success', () => {
    const messages = [
      poll('task-a', 'a1'),
      result('a1', true),
      poll('task-a', 'a2'),
      result('a2'),
      poll('task-a', 'a3'),
    ]
    expect(
      collapseTaskOutputPolls(messages, false).map(message =>
        String(message.uuid),
      ),
    ).toEqual(['assistant-a1', 'result-a1', 'assistant-a3'])
  })

  test('keeps the complete transcript in verbose mode', () => {
    const messages = [
      poll('task-a', 'a1'),
      result('a1'),
      poll('task-a', 'a2'),
      result('a2'),
    ]
    expect(collapseTaskOutputPolls(messages, true)).toBe(messages)
  })
})
