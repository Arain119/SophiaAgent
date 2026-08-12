import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { RunProgress } from '../../workflow/progress/store.js'
import {
  createExecutionSnapshot,
  type ExecutionSnapshot,
  formatExecutionStatus,
} from '../executionSnapshot.js'
import {
  openWorkNode,
  recordWorkNodeInputTokens,
  resetWorkNodesForTest,
} from '../../tasks/workNodes.js'

afterEach(resetWorkNodesForTest)

function stateWithTasks(
  tasks: Record<string, LocalAgentTaskState | LocalWorkflowTaskState>,
): AppState {
  return { tasks } as unknown as AppState
}

describe('createExecutionSnapshot', () => {
  test('omits the snapshot when no work is active', () => {
    expect(createExecutionSnapshot(stateWithTasks({}), [])).toBeNull()
  })
  test('surfaces live agent progress and excludes terminal tasks', () => {
    const running = {
      id: 'a-running',
      type: 'local_agent',
      status: 'running',
      description: 'Review API changes',
      startTime: 1_000,
      outputFile: '/tmp/a-running',
      agentId: 'a-running',
      prompt: 'review',
      agentType: 'reviewer',
      retrieved: false,
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
      isBackgrounded: true,
      pendingMessages: [],
      retain: false,
      diskLoaded: false,
      notified: false,
      outputOffset: 0,
      progress: {
        toolUseCount: 4,
        tokenCount: 900,
        summary: 'Checking provider boundaries',
        lastActivity: { toolName: 'Read', input: {} },
      },
    } as unknown as LocalAgentTaskState
    const completed = {
      ...running,
      id: 'a-completed',
      status: 'completed',
    } as unknown as LocalAgentTaskState
    openWorkNode({
      id: 'a-running',
      goal: 'Review API changes',
      owner: 'reviewer',
    })
    recordWorkNodeInputTokens('a-running', 2_000)
    recordWorkNodeInputTokens('a-running', 2_750)

    const snapshot = createExecutionSnapshot(
      stateWithTasks({ running, completed }),
      [],
      11_000,
    )
    if (!snapshot) throw new Error('Expected an active execution snapshot')

    expect(snapshot.activeCount).toBe(1)
    expect(snapshot.tasks[0]).toMatchObject({
      id: 'a-running',
      detail: 'agent=reviewer',
      summary: 'Checking provider boundaries',
      activity: 'Read',
      toolCount: 4,
      tokenCount: 900,
      workNodeId: 'a-running',
      workNodeContextTokens: 750,
      elapsedMs: 10_000,
    })
  })

  test('correlates workflow phases and child agents by run id', () => {
    const workflow = {
      id: 'w-task',
      type: 'local_workflow',
      status: 'running',
      description: 'Implementation workflow',
      startTime: 2_000,
      outputFile: '/tmp/w-task',
      outputOffset: 0,
      notified: false,
      runId: 'run-42',
      workflowName: 'implementation',
      workflowFile: '/repo/workflow.js',
    } as LocalWorkflowTaskState
    const run = {
      runId: 'run-42',
      workflowName: 'implementation',
      status: 'running',
      phases: [{ title: 'verify', status: 'running' }],
      declaredPhases: ['verify'],
      currentPhase: 'verify',
      agents: [
        {
          id: 7,
          label: 'test runner',
          phase: 'verify',
          status: 'running',
          toolCount: 3,
        },
      ],
      agentCount: 1,
      startedAt: 2_000,
      updatedAt: 3_000,
    } as RunProgress

    const snapshot = createExecutionSnapshot(
      stateWithTasks({ workflow }),
      [run],
      12_000,
    )
    if (!snapshot) throw new Error('Expected a workflow execution snapshot')

    expect(snapshot.tasks[0]).toMatchObject({
      workflowRunId: 'run-42',
      workflowPhase: 'verify',
      workflowAgents: [
        {
          id: '7',
          label: 'test runner',
          status: 'running',
          toolCount: 3,
        },
      ],
    })
  })

  test('formats one compact real-time status line', () => {
    const snapshot: ExecutionSnapshot = {
      type: 'execution_snapshot',
      activeCount: 2,
      omittedCount: 0,
      tasks: [
        {
          id: 'task-1',
          type: 'local_agent',
          status: 'running',
          description: 'Release verification',
          outputFile: '/tmp/task-1',
          activity: 'Running isolated tests',
          elapsedMs: 3_661_000,
        },
      ],
    }
    expect(formatExecutionStatus(snapshot)).toBe(
      'running · Running isolated tests · 1h1m · 2 active',
    )
    expect(formatExecutionStatus(snapshot, 40)?.length).toBeLessThanOrEqual(40)
  })
})
