import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { buildTool, type ToolDef, type ToolResult } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getMcpToolsCommandsAndResources } from 'src/services/mcp/client.js'
import {
  filterMcpServersByPolicy,
  getMcpServerSignature,
} from 'src/services/mcp/config.js'
import { getMcpPrefix } from 'src/services/mcp/mcpStringUtils.js'
import { findAutoMcpCandidates } from 'src/services/mcp/autoRegistry.js'
import { commandBelongsToServer } from 'src/services/mcp/utils.js'
import { z } from 'zod/v4'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'
import { AUTO_MCP_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'
import { type AutoMcpDependencies, runAutoMcp } from './runner.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    task: z
      .string()
      .min(1)
      .max(2_000)
      .describe('Describe the missing external capability and target system.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    serverName: z.string().optional(),
    title: z.string().optional(),
    transport: z.enum(['http', 'sse', 'npm']).optional(),
    tools: z.array(z.string()).optional(),
    requirements: z.array(z.string()).optional(),
    reason: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const defaultDependencies: AutoMcpDependencies = {
  discover: findAutoMcpCandidates,
  connect: getMcpToolsCommandsAndResources,
  filterPolicy: filterMcpServersByPolicy,
  getServerSignature: getMcpServerSignature,
  getToolPrefix: getMcpPrefix,
  commandBelongsToServer,
}

export const AutoMcpTool = buildTool({
  name: AUTO_MCP_TOOL_NAME,
  maxResultSizeChars: 20_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Finds and temporarily connects the best MCP server for a missing external capability'
  },
  async prompt() {
    return getPrompt()
  },
  userFacingName() {
    return 'MCP'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  async validateInput({
    task,
  }): Promise<
    { result: true } | { result: false; message: string; errorCode: number }
  > {
    return task.trim()
      ? { result: true }
      : { result: false, message: 'Task description is required', errorCode: 1 }
  },
  async checkSafety(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call({ task }, context): Promise<ToolResult<Output>> {
    return runAutoMcp(task, context, defaultDependencies)
  },
  mapToolResultToToolResultBlockParam(result, toolUseID): ToolResultBlockParam {
    const content = result.success
      ? `Connected ${result.serverName ?? 'MCP server'} with ${result.tools?.length ?? 0} tools.`
      : result.requirements?.length
        ? `MCP setup required: ${result.requirements.join(', ')}`
        : (result.reason ?? 'No MCP server was connected.')
    return { type: 'tool_result', tool_use_id: toolUseID, content }
  },
} satisfies ToolDef<InputSchema, Output>)
