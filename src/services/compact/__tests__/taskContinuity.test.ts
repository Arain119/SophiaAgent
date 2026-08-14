import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../../Tool.js'
import type { TaskState } from '../../../tasks/types.js'
import { createAsyncAgentAttachmentsIfNeeded } from '../compact.js'

function task(overrides: Partial<TaskState> & Pick<TaskState, 'id' | 'type'>) {
  return {
    status: 'running',
    description: `${overrides.type} task`,
    startTime: 1,
    outputFile: `/tmp/${overrides.id}`,
    outputOffset: 0,
    notified: false,
    ...overrides,
  } as TaskState
}

describe('post-compact task continuity', () => {
  test('restores every actionable background task type including pending tasks', async () => {
    const tasks = {
      agent: task({
        id: 'agent',
        type: 'local_agent',
        agentId: 'agent',
        retrieved: false,
        progress: {
          summary: 'agent progress',
          toolUseCount: 1,
          tokenCount: 10,
        },
      }),
      shell: task({ id: 'shell', type: 'local_bash', status: 'pending' }),
      workflow: task({
        id: 'workflow',
        type: 'local_workflow',
        summary: 'workflow progress',
      }),
      teammate: task({
        id: 'teammate',
        type: 'in_process_teammate',
        identity: {
          agentId: 'worker@team',
          agentName: 'worker',
          teamName: 'team',
          parentSessionId: 'session',
        },
        progress: {
          summary: 'teammate progress',
          toolUseCount: 1,
          tokenCount: 10,
        },
      }),
    }
    const context = {
      getAppState: () => ({ tasks }),
    } as unknown as ToolUseContext

    const attachments = await createAsyncAgentAttachmentsIfNeeded(context)
    const restored = attachments.map(message => message.attachment)

    expect(restored.map(item => item.type)).toEqual([
      'task_status',
      'task_status',
      'task_status',
      'task_status',
    ])
    expect(
      restored.map(item =>
        item.type === 'task_status' ? [item.taskId, item.taskType] : null,
      ),
    ).toEqual([
      ['agent', 'local_agent'],
      ['shell', 'local_bash'],
      ['workflow', 'local_workflow'],
      ['teammate', 'in_process_teammate'],
    ])
  })

  test('does not restore the current agent or consumed terminal tasks', async () => {
    const tasks = {
      current: task({
        id: 'current',
        type: 'local_agent',
        agentId: 'current-agent',
        retrieved: false,
      }),
      consumed: task({
        id: 'consumed',
        type: 'local_bash',
        status: 'completed',
        notified: true,
      }),
    }
    const context = {
      agentId: 'current-agent',
      getAppState: () => ({ tasks }),
    } as unknown as ToolUseContext

    expect(await createAsyncAgentAttachmentsIfNeeded(context)).toEqual([])
  })
})
