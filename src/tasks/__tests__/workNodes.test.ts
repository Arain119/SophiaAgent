import { afterEach, describe, expect, test } from 'bun:test'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import {
  closeWorkNode,
  getBlackboardFacts,
  getWorkNode,
  openWorkNode,
  projectCompletedWorkNodes,
  recordWorkNodeInputTokens,
  recordWorkNodeMessage,
  renderBlackboardContext,
  renderCompletedWorkNode,
  resetWorkNodesForTest,
} from '../workNodes.js'

const memory = {
  outcome: 'Implemented <route> safely.',
  decisions: ['Keep the stable prefix.'],
  evidence: ['src/query.ts & tests'],
  verification: ['focused tests passed'],
  remainingWork: [],
}

afterEach(resetWorkNodesForTest)

function messages(): Array<UserMessage | AssistantMessage> {
  return [
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'agent-use',
            content: 'large result',
          },
          {
            type: 'tool_result',
            tool_use_id: 'read-use',
            content: 'read result',
          },
        ],
      },
    } as unknown as UserMessage,
  ]
}

describe('work nodes', () => {
  test('tracks lifecycle, context pressure, and blackboard facts', () => {
    openWorkNode({
      id: 'node-1',
      toolUseId: 'agent-use',
      goal: 'Inspect routing',
      owner: 'Explore',
    })
    recordWorkNodeInputTokens('node-1', 1_000)
    recordWorkNodeInputTokens('node-1', 1_450)
    recordWorkNodeMessage('node-1', {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'read-1',
            name: 'Read',
            input: { file_path: 'src/query.ts' },
          },
          {
            type: 'tool_use',
            id: 'edit-1',
            name: 'Edit',
            input: { file_path: 'src/query.ts' },
          },
        ],
      },
    } as unknown as AssistantMessage)
    expect(renderBlackboardContext()).toContain(
      'files=[read:src/query.ts, write:src/query.ts]',
    )
    closeWorkNode('node-1', 'completed', memory)

    expect(getWorkNode('node-1')).toMatchObject({
      status: 'completed',
      openedAtInputTokens: 1_000,
      currentInputTokens: 1_450,
      contextTokens: 450,
      fileClaims: [
        { path: 'src/query.ts', access: 'read' },
        { path: 'src/query.ts', access: 'write' },
      ],
    })
    expect(getBlackboardFacts().map(fact => fact.value)).toContain(
      'Keep the stable prefix.',
    )
    expect(renderBlackboardContext()).toContain('src/query.ts &amp; tests')
    expect(renderCompletedWorkNode(getWorkNode('node-1')!)).toContain(
      'Implemented &lt;route&gt; safely.',
    )
  })

  test('deduplicates repeated facts using the latest author', () => {
    openWorkNode({ id: 'node-1', goal: 'one', owner: 'Explore' })
    closeWorkNode('node-1', 'completed', memory)
    openWorkNode({ id: 'node-2', goal: 'two', owner: 'Explore' })
    closeWorkNode('node-2', 'completed', memory)

    const decision = getBlackboardFacts().find(
      fact => fact.value === 'Keep the stable prefix.',
    )
    expect(decision?.authorNodeId).toBe('node-2')
    expect(
      getBlackboardFacts().filter(
        fact => fact.value === 'Keep the stable prefix.',
      ),
    ).toHaveLength(1)
  })

  test('projects only matching terminal agent results without mutating input', () => {
    const original = messages()
    openWorkNode({
      id: 'node-1',
      toolUseId: 'agent-use',
      goal: 'Inspect routing',
      owner: 'Explore',
    })
    expect(projectCompletedWorkNodes(original)).toBe(original)

    closeWorkNode('node-1', 'failed', memory)
    const projected = projectCompletedWorkNodes(original)
    const blocks = (projected[0] as UserMessage).message.content
    if (!Array.isArray(blocks)) throw new Error('Expected tool result blocks')
    expect(projected).not.toBe(original)
    expect(blocks[0]).toMatchObject({
      tool_use_id: 'agent-use',
      is_error: true,
    })
    expect(JSON.stringify(blocks[0])).toContain('status=\\"failed\\"')
    expect(blocks[1]).toMatchObject({
      tool_use_id: 'read-use',
      content: 'read result',
    })
    const originalBlocks = (original[0] as UserMessage).message.content
    if (!Array.isArray(originalBlocks)) {
      throw new Error('Expected original tool result blocks')
    }
    expect((originalBlocks[0] as { content: string }).content).toBe(
      'large result',
    )
  })

  test('projects terminal background task notifications by task id', () => {
    openWorkNode({
      id: 'node-1',
      toolUseId: 'agent-use',
      goal: 'Inspect routing',
      owner: 'Explore',
    })
    closeWorkNode('node-1', 'completed', memory)
    const original = [
      {
        type: 'user',
        origin: { kind: 'task-notification' },
        message: {
          content: [
            {
              type: 'text',
              text: 'A background agent completed a task:\n<task-notification><task-id>node-1</task-id><result>large result</result></task-notification>',
            },
          ],
        },
      } as unknown as UserMessage,
    ]

    const projected = projectCompletedWorkNodes(original)
    expect(JSON.stringify(projected)).toContain('<completed_work_node')
    expect(JSON.stringify(projected)).not.toContain('large result')
  })
})
