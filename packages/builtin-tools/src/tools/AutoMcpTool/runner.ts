import uniqBy from 'lodash-es/uniqBy.js'
import type { Tool, ToolResult, ToolUseContext } from 'src/Tool.js'
import type {
  AutoMcpCandidate,
  AutoMcpCandidates,
} from 'src/services/mcp/autoRegistry.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from 'src/services/mcp/types.js'
import type { Command } from 'src/types/command.js'

export type AutoMcpOutput = {
  success: boolean
  serverName?: string
  title?: string
  transport?: 'http' | 'sse' | 'npm'
  tools?: string[]
  requirements?: string[]
  reason?: string
}

export type ConnectionResult = {
  client: MCPServerConnection
  tools: Tool[]
  commands: Command[]
  resources?: ServerResource[]
}

export type AutoMcpDependencies = {
  discover(task: string): Promise<AutoMcpCandidates>
  connect(
    callback: (result: ConnectionResult) => void,
    configs: Record<string, ScopedMcpServerConfig>,
  ): Promise<void>
  filterPolicy(configs: Record<string, ScopedMcpServerConfig>): {
    allowed: Record<string, ScopedMcpServerConfig>
    blocked: string[]
  }
  getServerSignature(config: ScopedMcpServerConfig): string | null | undefined
  getToolPrefix(serverName: string): string
  commandBelongsToServer(command: Command, serverName: string): boolean
}

function connectedServerForCandidate(
  context: ToolUseContext,
  candidate: AutoMcpCandidate,
  dependencies: AutoMcpDependencies,
): ConnectionResult | null {
  if (!candidate.config) return null
  const signature = dependencies.getServerSignature(candidate.config)
  if (!signature) return null
  const state = context.getAppState().mcp
  const client = state.clients.find(
    item =>
      item.type === 'connected' &&
      dependencies.getServerSignature(item.config) === signature,
  )
  if (!client) return null
  const prefix = dependencies.getToolPrefix(client.name)
  return {
    client,
    tools: state.tools.filter(tool => tool.name.startsWith(prefix)),
    commands: state.commands.filter(command =>
      dependencies.commandBelongsToServer(command, client.name),
    ),
    resources: state.resources[client.name],
  }
}

function mergeConnectionIntoContext(
  context: ToolUseContext,
  result: ConnectionResult,
  dependencies: AutoMcpDependencies,
): void {
  context.setAppState(previous => {
    const existingClient = previous.mcp.clients.find(
      item => item.name === result.client.name,
    )
    const clients = existingClient
      ? previous.mcp.clients.map(item =>
          item.name === result.client.name ? result.client : item,
        )
      : [...previous.mcp.clients, result.client]
    const prefix = dependencies.getToolPrefix(result.client.name)
    const tools = uniqBy(
      [
        ...previous.mcp.tools.filter(tool => !tool.name.startsWith(prefix)),
        ...result.tools,
      ],
      'name',
    )
    const commands = uniqBy(
      [
        ...previous.mcp.commands.filter(
          command =>
            !dependencies.commandBelongsToServer(command, result.client.name),
        ),
        ...result.commands,
      ],
      'name',
    )
    const resources = result.resources
      ? { ...previous.mcp.resources, [result.client.name]: result.resources }
      : previous.mcp.resources
    return {
      ...previous,
      mcp: { ...previous.mcp, clients, tools, commands, resources },
    }
  })
}

function addConnectionToContext(
  context: ToolUseContext,
  result: ConnectionResult,
): ToolUseContext {
  return {
    ...context,
    options: {
      ...context.options,
      tools: uniqBy([...context.options.tools, ...result.tools], 'name'),
      commands: uniqBy(
        [...context.options.commands, ...result.commands],
        'name',
      ),
      mcpClients: uniqBy(
        [...context.options.mcpClients, result.client],
        'name',
      ),
      mcpResources: result.resources
        ? {
            ...context.options.mcpResources,
            [result.client.name]: result.resources,
          }
        : context.options.mcpResources,
    },
  }
}

async function connectCandidate(
  context: ToolUseContext,
  candidate: AutoMcpCandidate,
  dependencies: AutoMcpDependencies,
): Promise<ConnectionResult | null> {
  if (!candidate.config) return null
  const allowed = dependencies.filterPolicy({
    [candidate.name]: candidate.config,
  })
  if (!allowed.allowed[candidate.name]) return null
  const reused = connectedServerForCandidate(context, candidate, dependencies)
  if (reused) return reused
  let result: ConnectionResult | null = null
  await dependencies.connect(connection => {
    if (connection.client.name === candidate.name) result = connection
  }, allowed.allowed)
  return result
}

export async function runAutoMcp(
  task: string,
  context: ToolUseContext,
  dependencies: AutoMcpDependencies,
): Promise<ToolResult<AutoMcpOutput>> {
  const discovery = await dependencies.discover(task)
  if (discovery.candidates.length === 0) {
    return {
      data: {
        success: false,
        reason: discovery.searched.length
          ? 'No trusted MCP server matched the task.'
          : 'The task did not describe an external capability.',
      },
    }
  }
  for (const candidate of discovery.candidates) {
    if (candidate.config === null) {
      return {
        data: {
          success: false,
          serverName: candidate.registryName,
          title: candidate.title,
          transport: candidate.transport,
          requirements: candidate.requirements,
          reason: candidate.requirements.length
            ? 'Credentials or headers are required before this MCP can connect.'
            : 'The candidate did not expose a safe runnable configuration.',
        },
      }
    }
    const result = await connectCandidate(context, candidate, dependencies)
    if (!result) continue
    if (result.client.type === 'needs-auth') {
      return {
        data: {
          success: false,
          serverName: candidate.registryName,
          title: candidate.title,
          transport: candidate.transport,
          requirements: ['MCP authentication'],
          reason:
            'This MCP server requires authentication before it can connect.',
        },
      }
    }
    if (result.client.type !== 'connected') continue
    mergeConnectionIntoContext(context, result, dependencies)
    return {
      data: {
        success: true,
        serverName: result.client.name,
        title: candidate.title,
        transport: candidate.transport,
        tools: result.tools.map(tool => tool.name),
      },
      contextModifier(original) {
        return addConnectionToContext(original, result)
      },
    }
  }
  return {
    data: {
      success: false,
      reason: 'All trusted MCP candidates failed or were blocked by policy.',
    },
  }
}
