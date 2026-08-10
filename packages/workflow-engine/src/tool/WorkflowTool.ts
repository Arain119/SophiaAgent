import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod/v4'
import { WORKFLOW_DIR_NAME, WORKFLOW_TOOL_NAME } from '../constants.js'
import { resolveNamedWorkflow } from '../engine/namedWorkflows.js'
import { runWorkflow } from '../engine/runWorkflow.js'
import { parseScript } from '../engine/script.js'
import { containsPath, sanitizeWorkflowName } from '../engine/paths.js'
import type { WorkflowPorts } from '../ports.js'
import type { WorkflowRunResult } from '../types.js'
import { workflowInputSchema, type WorkflowInput } from './schema.js'
import { persistInlineScript } from './persistInline.js'

/** Self-contained tool descriptor (core wiring wraps it with buildTool). Zero core-layer dependencies. */
export type WorkflowToolDescriptor = {
  name: string
  inputSchema: z.ZodType<WorkflowInput>
  isEnabled: () => boolean
  isReadOnly: (input: WorkflowInput) => boolean
  description: () => Promise<string>
  prompt: () => Promise<string>
  renderToolUseMessage: (input: Partial<WorkflowInput>) => string
  call: (
    input: WorkflowInput,
    context: unknown,
    canUseTool: unknown,
    parentMessage: unknown,
    onProgress?: unknown,
  ) => Promise<{ data: { output: string } }>
  mapToolResultToToolResultBlockParam: (
    data: { output: string },
    toolUseId: string,
  ) => {
    tool_use_id: string
    type: 'tool_result'
    content: Array<{ type: 'text'; text: string }>
  }
}

const WORKFLOW_TOOL_PROMPT = `Use the Workflow tool when you judge that deterministic orchestration of multiple dependent or parallel subagents is the best way to complete the task. Prefer a single Agent for one bounded delegation and direct tools for simple work. This choice is yours; do not ask the user which execution mechanism to use. The script runs in the background, returns a run_id immediately, and reports live state through execution-state snapshots.

Provide the script inline via "script", or reference a named workflow via "name" (resolved from .sophia/workflows/), or an existing file via "scriptPath". Pass "args" as a real JSON value (object/array/string), not a stringified string.

Use "resumeFromRunId" to resume a prior run — completed agent() calls replay from the journal instantly.

Concurrency: default is 3 (hard ceiling 16). Omit maxConcurrency for ordinary workflows. Set it yourself when the task has enough independent work to justify more concurrency, while avoiding wasteful fan-out.

Script execution model (common pitfalls — getting these wrong is the #1 cause of script errors): the script is the body of \`new AsyncFunction\` — NOT an ESM module, and TypeScript is NOT transpiled. Therefore:
- Do NOT use \`import\` — \`agent\`, \`parallel\`, \`pipeline\`, \`phase\`, \`log\`, \`workflow\`, \`args\`, and \`budget\` are injected as parameters; reference them directly.
- Do NOT use TS type annotations, \`interface\`, \`enum\`, \`as\`, or generics — the engine does not transpile, so even a .ts file with type syntax fails to parse.
- Keep EXACTLY ONE \`export const meta = {...}\` (plain literal) and remove every other \`export\` / \`export default\`.
- Return the result with a top-level \`return\`.
Prefer .js / .mjs.`

export function createWorkflowTool(
  ports: WorkflowPorts,
): WorkflowToolDescriptor {
  return {
    name: WORKFLOW_TOOL_NAME,
    inputSchema: workflowInputSchema,
    // No per-session runtime opt-in gate here: the "ultracode is on for the
    // session" signal is injected by the harness (claude.ai/client), not held
    // in any repo state. This Core tool is always enabled when present.
    isEnabled: () => true,
    isReadOnly: () => false,

    async description() {
      return 'Execute a workflow script that orchestrates multiple subagents to complete a task'
    },

    async prompt() {
      return WORKFLOW_TOOL_PROMPT
    },

    renderToolUseMessage(input) {
      if (input.resumeFromRunId)
        return `Workflow resume: ${input.resumeFromRunId}`
      const id =
        input.name ?? input.scriptPath ?? (input.script ? 'inline' : 'unknown')
      return `Workflow: ${id}`
    },

    async call(input, context, canUseTool, parentMessage) {
      const host = ports.hostFactory({ context, canUseTool, parentMessage })

      // Resolve the script source
      let script: string
      let workflowFile: string | undefined
      try {
        const resolved = await resolveScriptSource(input, host.cwd)
        script = resolved.script
        workflowFile = resolved.workflowFile
      } catch (e) {
        return { data: { output: `Error: ${(e as Error).message}` } }
      }

      // Quick validation (meta + syntax): on failure return an error to the model directly, do not enter the background
      try {
        parseScript(script)
      } catch (e) {
        return {
          data: {
            output: `Error: script validation failed: ${(e as Error).message}`,
          },
        }
      }

      const workflowName = input.name ?? input.title ?? 'workflow'
      const { runId, signal } = ports.taskRegistrar.register(
        {
          workflowName,
          ...(workflowFile ? { workflowFile } : {}),
          ...(input.description ? { summary: input.description } : {}),
          ...(host.toolUseId ? { toolUseId: host.toolUseId } : {}),
          ...(input.resumeFromRunId ? { runId: input.resumeFromRunId } : {}),
        },
        host.handle,
      )

      // Inline entry: persist the script to the run directory and return a reusable path (the
      // inline -> persist -> edit -> resubmit-as-scriptPath iteration loop promised by the ultracode skill).
      // On write failure degrade to a placeholder + warn, do not abort the run (script is already in memory).
      if (!workflowFile && input.script) {
        try {
          workflowFile = await persistInlineScript(
            input.script,
            runId,
            host.cwd,
          )
        } catch (e) {
          ports.logger.warn?.(
            `inline script persist failed: ${(e as Error).message}`,
          )
        }
      }

      // Detached execution
      void runWorkflow({
        script,
        ...(input.args !== undefined
          ? { args: normalizeArgs(input.args) }
          : {}),
        runId,
        workflowName,
        ports,
        host: host.handle,
        signal,
        cwd: host.cwd,
        budgetTotal: host.budgetTotal,
        ...(input.maxConcurrency !== undefined
          ? { maxConcurrency: input.maxConcurrency }
          : {}),
        ...(input.resumeFromRunId ? { resume: true } : {}),
      })
        .then(result => onFinish(ports, result, runId))
        .catch(e => ports.taskRegistrar.fail(runId, (e as Error).message))

      const scriptPath = workflowFile ?? `<inline run ${runId}>`
      return {
        data: {
          output: [
            'Workflow started (running in the background).',
            `run_id: ${runId}`,
            `workflow: ${workflowName}`,
            `script: ${scriptPath}`,
            '',
            'Live progress is supplied automatically in execution-state snapshots. You will also be notified on completion.',
          ].join('\n'),
        },
      }
    },

    mapToolResultToToolResultBlockParam(data, toolUseId) {
      return {
        tool_use_id: toolUseId,
        type: 'tool_result',
        content: [{ type: 'text', text: data.output }],
      }
    },
  }
}

function onFinish(
  ports: WorkflowPorts,
  result: WorkflowRunResult,
  runId: string,
): void {
  if (result.status === 'completed') {
    const summary =
      result.returnValue == null
        ? '(no return value)'
        : formatValue(result.returnValue)
    ports.taskRegistrar.complete(runId, summary)
  } else if (result.status === 'failed') {
    ports.taskRegistrar.fail(runId, result.error ?? 'workflow failed')
  } else {
    ports.taskRegistrar.kill(runId)
  }
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 500)
  try {
    return JSON.stringify(v).slice(0, 500)
  } catch {
    return String(v)
  }
}

/**
 * Defensively normalize args: under the legacy `z.string()` contract the model may send a stringified JSON object.
 * Only normalize when the string JSON.parses to an object/array; plain strings, numbers, etc. are preserved as-is.
 */
function normalizeArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return raw
  } catch {
    return raw
  }
}

async function resolveScriptSource(
  input: WorkflowInput,
  cwd: string,
): Promise<{ script: string; workflowFile?: string }> {
  if (input.script) return { script: input.script }
  if (input.scriptPath) {
    const resolved = resolve(cwd, input.scriptPath)
    if (!containsPath(cwd, resolved)) {
      throw new Error(
        `scriptPath "${input.scriptPath}" is out of bounds (after resolve, ${resolved} is not within cwd ${cwd})`,
      )
    }
    return {
      script: await readFile(resolved, 'utf-8'),
      workflowFile: resolved,
    }
  }
  if (input.name) {
    if (sanitizeWorkflowName(input.name) === null) {
      throw new Error(
        `Named workflow name "${input.name}" is invalid (contains path separators or is . / ..)`,
      )
    }
    const found = await resolveNamedWorkflow(
      join(cwd, WORKFLOW_DIR_NAME),
      input.name,
    )
    if (!found) {
      throw new Error(
        `Named workflow "${input.name}" not found (looked in ${WORKFLOW_DIR_NAME}/)`,
      )
    }
    return { script: found.content, workflowFile: found.path }
  }
  throw new Error('One of script, name, or scriptPath must be provided')
}
