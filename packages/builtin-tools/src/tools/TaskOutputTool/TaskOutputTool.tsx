import React from 'react';
import { z } from 'zod/v4';
import { FallbackToolUseErrorMessage } from 'src/components/FallbackToolUseErrorMessage.js';
import { FallbackToolUseRejectedMessage } from 'src/components/FallbackToolUseRejectedMessage.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Box, Text } from '@anthropic/ink';
import type { TaskType } from 'src/Task.js';
import type { Tool } from 'src/Tool.js';
import { buildTool, type ToolDef } from 'src/Tool.js';
import type { LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import type { TaskState } from 'src/tasks/types.js';
import { AbortError } from 'src/utils/errors.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { extractTextContent } from 'src/utils/messages.js';
import { semanticBoolean } from 'src/utils/semanticBoolean.js';
import { sleep } from 'src/utils/sleep.js';
import { jsonParse } from 'src/utils/slowOperations.js';
import { countCharInString } from 'src/utils/stringUtils.js';
import { getTaskOutput } from 'src/utils/task/diskOutput.js';
import { markTaskResultConsumed } from 'src/utils/task/taskResultConsumption.js';
import { retrieveAgentResult } from 'src/tasks/LocalAgentTask/agentTerminalArtifacts.js';
import { formatTaskOutput } from 'src/utils/task/outputFormatting.js';
import type { ThemeName } from 'src/utils/theme.js';
import { AgentPromptDisplay, AgentResponseDisplay } from '../AgentTool/UI.js';
import BashToolResultMessage from '../BashTool/BashToolResultMessage.js';
import { TASK_OUTPUT_TOOL_NAME } from './constants.js';

const DEFAULT_RUNNING_MAX_CHARS = 4_000;
const DEFAULT_COMPLETED_MAX_CHARS = 20_000;
export const MAX_INTERACTIVE_WAIT_MS = 30_000;
const activeTaskWaits = new Map<string, Promise<TaskState | null>>();

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().describe('The task ID to get output from'),
    block: semanticBoolean(z.boolean().default(true)).describe('Whether to wait for completion'),
    timeout: z.number().min(0).max(600000).default(30000).describe('Max wait time in ms'),
    section: z.string().optional().describe('Optional result section heading to retrieve'),
    query: z.string().optional().describe('Optional case-insensitive keyword to search in the result'),
    max_chars: z
      .number()
      .int()
      .min(500)
      .max(100000)
      .optional()
      .describe('Maximum returned result characters; defaults to 4,000 while running and 20,000 when complete'),
  }),
);
type InputSchema = ReturnType<typeof inputSchema>;

type TaskOutputToolInput = z.infer<InputSchema>;

// Unified output type covering all task types
type TaskOutput = {
  task_id: string;
  task_type: TaskType;
  status: string;
  description: string;
  output: string;
  exitCode?: number | null;
  error?: string;
  // For agents
  prompt?: string;
  result?: string;
  resultFile?: string;
  resultIndexFile?: string;
  retrieval?: {
    mode: 'full' | 'section' | 'query';
    matchedSections: string[];
    matchedLines: number[];
  };
};

type TaskOutputToolOutput = {
  retrieval_status: 'success' | 'timeout' | 'not_ready';
  task: TaskOutput | null;
};

// Re-export Progress from centralized types to break import cycles
export type { TaskOutputProgress as Progress } from 'src/types/tools.js';

// Get output for any task type
async function getTaskOutputData(
  task: TaskState,
  retrieval: { section?: string; query?: string; maxChars?: number } = {},
): Promise<TaskOutput> {
  const maxChars = resolveTaskOutputMaxChars(task.status, retrieval.maxChars);
  let output: string;
  if (task.type === 'local_bash') {
    const bashTask = task as LocalShellTaskState;
    const taskOutputObj = bashTask.shellCommand?.taskOutput;
    output = await getTaskOutput(task.id, maxChars);
    if (!output && taskOutputObj && !taskOutputObj.stdoutToFile) {
      const stdout = await taskOutputObj.getStdout();
      const stderr = taskOutputObj.getStderr();
      output = [stdout, stderr].filter(Boolean).join('\n');
    }
  } else {
    output = await getTaskOutput(task.id, maxChars);
  }

  const baseOutput: TaskOutput = {
    task_id: task.id,
    task_type: task.type,
    status: task.status,
    description: task.description,
    output,
  };

  // Add type-specific fields
  if (task.type === 'local_bash') {
    const bashTask = task as LocalShellTaskState;
    return {
      ...baseOutput,
      exitCode: bashTask.result?.code ?? null,
    };
  }

  if (task.type === 'local_agent') {
    const agentTask = task as LocalAgentTaskState;
    // Prefer the clean final answer from the in-memory result over the raw
    // JSONL transcript on disk. The disk output is a symlink to the full
    // session transcript (every message, tool use, etc.), not just the
    // subagent's answer. The in-memory result contains only the final
    // assistant text content blocks.
    const cleanResult = agentTask.result ? extractTextContent(agentTask.result.content, '\n') : undefined;
    const selected = await retrieveAgentResult(task.id, retrieval);
    return {
      ...baseOutput,
      prompt: agentTask.prompt,
      result: selected?.content || cleanResult || output,
      output: selected?.content || cleanResult || output,
      error: agentTask.error,
      resultFile: agentTask.resultFile,
      resultIndexFile: agentTask.resultIndexFile,
      retrieval: selected
        ? {
            mode: selected.mode,
            matchedSections: selected.matchedSections,
            matchedLines: selected.matchedLines,
          }
        : undefined,
    };
  }

  return baseOutput;
}

export function resolveTaskOutputMaxChars(status: string, requested?: number): number {
  if (requested !== undefined) return requested;
  return status === 'running' || status === 'pending' ? DEFAULT_RUNNING_MAX_CHARS : DEFAULT_COMPLETED_MAX_CHARS;
}

export function getTaskWaitPollDelay(elapsedMs: number): number {
  if (elapsedMs < 1_000) return 250;
  if (elapsedMs < 5_000) return 500;
  return 1_000;
}

export function resolveInteractiveWaitTimeout(timeoutMs: number): number {
  return Math.min(timeoutMs, MAX_INTERACTIVE_WAIT_MS);
}

function raceTaskWaitWithAbort(
  wait: Promise<TaskState | null>,
  abortController?: AbortController,
): Promise<TaskState | null> {
  if (!abortController) return wait;
  if (abortController.signal.aborted) return Promise.reject(new AbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AbortError());
    abortController.signal.addEventListener('abort', onAbort, { once: true });
    wait.then(
      value => {
        abortController.signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        abortController.signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

// Wait for task to complete
export async function waitForTaskCompletion(
  taskId: string,
  getAppState: () => { tasks?: Record<string, TaskState> },
  timeoutMs: number,
  abortController?: AbortController,
  subscribeAppState?: (listener: () => void) => () => void,
): Promise<TaskState | null> {
  const existing = activeTaskWaits.get(taskId);
  if (existing) return raceTaskWaitWithAbort(existing, abortController);

  const wait = waitForTaskCompletionUnshared(taskId, getAppState, timeoutMs, subscribeAppState);
  activeTaskWaits.set(taskId, wait);
  void wait.finally(() => {
    if (activeTaskWaits.get(taskId) === wait) activeTaskWaits.delete(taskId);
  });
  return raceTaskWaitWithAbort(wait, abortController);
}

async function waitForTaskCompletionUnshared(
  taskId: string,
  getAppState: () => { tasks?: Record<string, TaskState> },
  timeoutMs: number,
  subscribeAppState?: (listener: () => void) => () => void,
): Promise<TaskState | null> {
  const startTime = Date.now();

  const getTask = () => (getAppState().tasks?.[taskId] as TaskState | undefined) ?? null;
  const isComplete = (task: TaskState | null) => !task || (task.status !== 'running' && task.status !== 'pending');

  if (subscribeAppState) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};
      const finish = () => {
        if (settled) return;
        const task = getTask();
        if (!isComplete(task) && Date.now() - startTime < timeoutMs) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        unsubscribe();
        resolve(task);
      };
      unsubscribe = subscribeAppState(finish);
      timeout = setTimeout(finish, timeoutMs);
      finish();
    });
  }

  while (Date.now() - startTime < timeoutMs) {
    const state = getAppState();
    const task = state.tasks?.[taskId] as TaskState | undefined;

    if (!task) {
      return null;
    }

    if (task.status !== 'running' && task.status !== 'pending') {
      return task;
    }

    const elapsedMs = Date.now() - startTime;
    await sleep(Math.min(getTaskWaitPollDelay(elapsedMs), timeoutMs - elapsedMs));
  }

  // Timeout - return current state
  const finalState = getAppState();
  return (finalState.tasks?.[taskId] as TaskState) ?? null;
}

export const TaskOutputTool: Tool<InputSchema, TaskOutputToolOutput> = buildTool({
  name: TASK_OUTPUT_TOOL_NAME,
  maxResultSizeChars: 100_000,
  // Backwards-compatible aliases for renamed tools
  aliases: ['AgentOutputTool', 'BashOutputTool'],

  userFacingName(input) {
    return input?.block === false ? 'Check task' : 'Wait for task';
  },

  get inputSchema(): InputSchema {
    return inputSchema();
  },

  async description() {
    return 'Retrieve task status or a focused section of a completed agent result';
  },

  isConcurrencySafe(_input) {
    return this.isReadOnly?.(_input) ?? false;
  },

  isEnabled() {
    return process.env.USER_TYPE !== 'ant';
  },

  isReadOnly(_input) {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.task_id;
  },

  async prompt() {
    return `Retrieves output from a running or completed task (background shell, agent, or remote session).
- Takes a task_id parameter identifying the task
- For completed agent tasks, use section to retrieve a named heading or query to retrieve matching lines with context
- section takes precedence when it matches; query is used otherwise
- Use max_chars to bound the returned context
- Use block=true (default) for one short event-driven wait (at most 30 seconds)
- Use block=false for non-blocking check of current status
- After a wait times out, continue independent work and rely on the task-completion notification; do not poll
- Use a non-blocking check only when current status changes your next action
- Task IDs can be found using the /tasks command
- Read the result file directly only when full raw access is needed`;
  },

  async validateInput({ task_id }, { getAppState }) {
    if (!task_id) {
      return {
        result: false,
        message: 'Task ID is required',
        errorCode: 1,
      };
    }

    const appState = getAppState();
    const task = appState.tasks?.[task_id] as TaskState | undefined;

    if (!task) {
      return {
        result: false,
        message: `No task found with ID: ${task_id}`,
        errorCode: 2,
      };
    }

    return { result: true };
  },

  async call(input: TaskOutputToolInput, toolUseContext, _canUseTool, _parentMessage, onProgress) {
    const { task_id, block, timeout, section, query, max_chars } = input;
    const retrieval = { section, query, maxChars: max_chars };

    const appState = toolUseContext.getAppState();
    const task = appState.tasks?.[task_id] as TaskState | undefined;

    if (!task) {
      throw new Error(`No task found with ID: ${task_id}`);
    }

    if (!block) {
      // Non-blocking: return current state
      if (task.status !== 'running' && task.status !== 'pending') {
        markTaskResultConsumed(task_id, toolUseContext);
        return {
          data: {
            retrieval_status: 'success' as const,
            task: await getTaskOutputData(task, retrieval),
          },
        };
      }
      return {
        data: {
          retrieval_status: 'not_ready' as const,
          task: await getTaskOutputData(task, retrieval),
        },
      };
    }

    // Blocking: wait for completion
    if (onProgress) {
      onProgress({
        toolUseID: `task-output-waiting-${Date.now()}`,
        data: {
          type: 'waiting_for_task',
          taskDescription: task.description,
          taskType: task.type,
        },
      });
    }

    const completedTask = await waitForTaskCompletion(
      task_id,
      toolUseContext.getAppState,
      resolveInteractiveWaitTimeout(timeout),
      toolUseContext.abortController,
      toolUseContext.subscribeAppState,
    );

    if (!completedTask) {
      return {
        data: {
          retrieval_status: 'timeout' as const,
          task: null,
        },
      };
    }

    if (completedTask.status === 'running' || completedTask.status === 'pending') {
      return {
        data: {
          retrieval_status: 'timeout' as const,
          task: await getTaskOutputData(completedTask, retrieval),
        },
      };
    }

    markTaskResultConsumed(task_id, toolUseContext);

    return {
      data: {
        retrieval_status: 'success' as const,
        task: await getTaskOutputData(completedTask, retrieval),
      },
    };
  },

  mapToolResultToToolResultBlockParam(data, toolUseID) {
    const parts: string[] = [];

    parts.push(`<retrieval_status>${data.retrieval_status}</retrieval_status>`);

    if (data.task) {
      parts.push(`<task_id>${data.task.task_id}</task_id>`);
      parts.push(`<task_type>${data.task.task_type}</task_type>`);
      parts.push(`<status>${data.task.status}</status>`);

      if (data.task.exitCode !== undefined && data.task.exitCode !== null) {
        parts.push(`<exit_code>${data.task.exitCode}</exit_code>`);
      }

      if (data.task.output?.trim()) {
        const { content } = formatTaskOutput(data.task.output, data.task.task_id, data.task.resultFile);
        parts.push(`<output>\n${content.trimEnd()}\n</output>`);
      }

      if (data.task.resultIndexFile) {
        parts.push(`<result_index_file>${data.task.resultIndexFile}</result_index_file>`);
      }
      if (data.task.retrieval) {
        parts.push(
          `<retrieval mode="${data.task.retrieval.mode}"><matched_sections>${data.task.retrieval.matchedSections.join(', ')}</matched_sections><matched_lines>${data.task.retrieval.matchedLines.join(',')}</matched_lines></retrieval>`,
        );
      }

      if (data.task.error) {
        parts.push(`<error>${data.task.error}</error>`);
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: parts.join('\n\n'),
    };
  },

  renderToolUseMessage() {
    return '';
  },

  renderToolUseTag(input) {
    if (!input.task_id) {
      return null;
    }
    return <Text dimColor> {input.task_id}</Text>;
  },

  renderToolUseProgressMessage(progressMessages) {
    const lastProgress = progressMessages[progressMessages.length - 1];
    const progressData = lastProgress?.data as { taskDescription?: string; taskType?: string } | undefined;

    return (
      <Box flexDirection="column">
        {progressData?.taskDescription && <Text>&nbsp;&nbsp;{progressData.taskDescription}</Text>}
        <Text>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Waiting for task <Text dimColor>(esc to give additional instructions)</Text>
        </Text>
      </Box>
    );
  },

  renderToolResultMessage(content, _, { verbose, theme }) {
    return <TaskOutputResultDisplay content={content} verbose={verbose} theme={theme} />;
  },

  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />;
  },

  renderToolUseErrorMessage(result, { verbose }) {
    return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
  },
} satisfies ToolDef<InputSchema, TaskOutputToolOutput>);

function TaskOutputResultDisplay({
  content,
  verbose = false,
  theme,
}: {
  content: string | TaskOutputToolOutput;
  verbose?: boolean;
  theme: ThemeName;
}): React.ReactNode {
  const result: TaskOutputToolOutput = typeof content === 'string' ? jsonParse(content) : content;

  if (!result.task) {
    return (
      <MessageResponse>
        <Text dimColor>No task output available</Text>
      </MessageResponse>
    );
  }

  const { task } = result;

  if (result.retrieval_status === 'not_ready' || result.retrieval_status === 'timeout') {
    const progress = summarizeRunningTaskOutput(task.output);
    return (
      <MessageResponse>
        <Text dimColor>
          Running
          {result.retrieval_status === 'timeout' && ' · check timed out'}
          {progress && <> \u00b7 {progress}</>}
        </Text>
      </MessageResponse>
    );
  }

  // For shell tasks, render like BashToolResultMessage
  if (task.task_type === 'local_bash') {
    const bashOut = {
      stdout: task.output,
      stderr: '',
      isImage: false,
      dangerouslyDisableSandbox: true,
      returnCodeInterpretation: task.error,
    };
    return <BashToolResultMessage content={bashOut} verbose={verbose} />;
  }

  // For agent tasks, render with prompt/response display
  if (task.task_type === 'local_agent') {
    const lineCount = task.result ? countCharInString(task.result, '\n') + 1 : 0;

    if (result.retrieval_status === 'success') {
      if (verbose) {
        return (
          <Box flexDirection="column">
            <Text>
              {task.description} ({lineCount} lines)
            </Text>
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {task.prompt && <AgentPromptDisplay prompt={task.prompt} theme={theme} dim />}
              {task.result && (
                <Box marginTop={1}>
                  <AgentResponseDisplay content={[{ type: 'text', text: task.result }]} theme={theme} />
                </Box>
              )}
              {task.error && (
                <Box flexDirection="column" marginTop={1}>
                  <Text color="error" bold>
                    Error:
                  </Text>
                  <Box paddingLeft={2}>
                    <Text color="error">{task.error}</Text>
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        );
      }
      return (
        <MessageResponse>
          <Text dimColor>Read output</Text>
        </MessageResponse>
      );
    }

    return (
      <MessageResponse>
        <Text dimColor>Task not ready</Text>
      </MessageResponse>
    );
  }

  // Default rendering
  return (
    <Box flexDirection="column">
      <Text>
        &nbsp;&nbsp;{task.description} [{task.status}]
      </Text>
      {task.output && (
        <Box paddingLeft={4}>
          <Text>{task.output.slice(0, 500)}</Text>
        </Box>
      )}
    </Box>
  );
}

export function summarizeRunningTaskOutput(output: string): string | null {
  const lines = output
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  const latest = lines.at(-1);
  if (!latest) {
    return null;
  }

  const maxLatestLength = 120;
  const clipped = latest.length > maxLatestLength ? `${latest.slice(0, maxLatestLength - 1)}…` : latest;
  return lines.length === 1 ? clipped : `${clipped} · ${lines.length.toLocaleString()} lines`;
}

export default TaskOutputTool;
