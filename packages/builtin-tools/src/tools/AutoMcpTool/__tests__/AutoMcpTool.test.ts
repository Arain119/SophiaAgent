import { describe, expect, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import {
  type AutoMcpDependencies,
  type ConnectionResult,
  runAutoMcp,
} from '../runner.js'

const config: ScopedMcpServerConfig = {
  type: 'http',
  url: 'https://render.example.com/mcp',
  scope: 'dynamic',
}

const candidate = {
  name: 'auto_render_12345678',
  registryName: 'io.github.example/render',
  title: 'Render',
  description: 'Deploy services to Render',
  version: '1.0.0',
  score: 1,
  transport: 'http' as const,
  config,
  requirements: [],
}

function connected(name = candidate.name): MCPServerConnection {
  return {
    name,
    type: 'connected',
    config,
    capabilities: {},
    client: {},
    cleanup: async () => {},
  } as unknown as MCPServerConnection
}

function createContext(initialClient?: MCPServerConnection): {
  context: ToolUseContext
  getState: () => AppState
} {
  let state = {
    mcp: {
      clients: initialClient ? [initialClient] : [],
      tools: [],
      commands: [],
      resources: {},
      pluginReconnectKey: 0,
    },
  } as unknown as AppState
  const context = {
    options: {
      tools: [],
      commands: [],
      mcpClients: initialClient ? [initialClient] : [],
      mcpResources: {},
    },
    getAppState: () => state,
    setAppState: (update: (previous: AppState) => AppState) => {
      state = update(state)
    },
  } as unknown as ToolUseContext
  return { context, getState: () => state }
}

function dependencies(
  connect: AutoMcpDependencies['connect'],
  filterPolicy: AutoMcpDependencies['filterPolicy'] = configs => ({
    allowed: configs,
    blocked: [],
  }),
): AutoMcpDependencies {
  return {
    discover: async () => ({ candidates: [candidate], searched: ['render'] }),
    connect,
    filterPolicy,
    getServerSignature: serverConfig => JSON.stringify(serverConfig),
    getToolPrefix: serverName => `mcp__${serverName}__`,
    commandBelongsToServer: (command, serverName) =>
      command.name?.startsWith(`mcp__${serverName}__`) ?? false,
  }
}

describe('runAutoMcp', () => {
  test('connects and injects tools into state and the active query context', async () => {
    const { context, getState } = createContext()
    const tool = {
      name: 'mcp__auto_render_12345678__deploy',
    } as unknown as Tool
    const result = await runAutoMcp(
      'deploy to Render',
      context,
      dependencies(async callback => {
        callback({ client: connected(), tools: [tool], commands: [] })
      }),
    )

    expect(result.data.success).toBe(true)
    expect(getState().mcp.clients).toHaveLength(1)
    expect(getState().mcp.tools.map(item => item.name)).toEqual([tool.name])

    const modified = result.contextModifier?.(context)
    expect(modified?.options.tools.map(item => item.name)).toContain(tool.name)
    expect(modified?.options.mcpClients).toHaveLength(1)
  })

  test('reports authentication without injecting tools', async () => {
    const { context, getState } = createContext()
    const result = await runAutoMcp(
      'deploy to Render',
      context,
      dependencies(async callback => {
        callback({
          client: { name: candidate.name, type: 'needs-auth', config },
          tools: [],
          commands: [],
        })
      }),
    )

    expect(result.data.success).toBe(false)
    expect(result.data.requirements).toEqual(['MCP authentication'])
    expect(getState().mcp.clients).toEqual([])
    expect(result.contextModifier).toBeUndefined()
  })

  test('does not connect a policy-blocked candidate', async () => {
    const { context } = createContext()
    let connectionAttempts = 0
    const result = await runAutoMcp(
      'deploy to Render',
      context,
      dependencies(
        async () => {
          connectionAttempts += 1
        },
        () => ({ allowed: {}, blocked: [candidate.name] }),
      ),
    )

    expect(result.data.success).toBe(false)
    expect(result.data.reason).toContain('blocked by policy')
    expect(connectionAttempts).toBe(0)
  })

  test('reuses an equivalent connected server without reconnecting', async () => {
    const existing = connected('existing-render')
    const existingTool = {
      name: 'mcp__existing-render__deploy',
    } as unknown as Tool
    const { context } = createContext(existing)
    const currentState = context.getAppState()
    ;(currentState.mcp.tools as Tool[]).push(existingTool)
    let connectionAttempts = 0

    const result = await runAutoMcp(
      'deploy to Render',
      context,
      dependencies(async () => {
        connectionAttempts += 1
      }),
    )

    expect(result.data.success).toBe(true)
    expect(result.data.serverName).toBe('existing-render')
    expect(result.data.tools).toEqual([existingTool.name])
    expect(connectionAttempts).toBe(0)
  })

  test('reports registry-declared credential requirements', async () => {
    const { context } = createContext()
    let connectionAttempts = 0
    const missingCredential = {
      ...candidate,
      config: null,
      requirements: ['RENDER_API_KEY'],
    }
    const deps = dependencies(async () => {
      connectionAttempts += 1
    })
    deps.discover = async () => ({
      candidates: [missingCredential],
      searched: ['render'],
    })

    const result = await runAutoMcp('deploy to Render', context, deps)

    expect(result.data.success).toBe(false)
    expect(result.data.requirements).toEqual(['RENDER_API_KEY'])
    expect(connectionAttempts).toBe(0)
  })
})
