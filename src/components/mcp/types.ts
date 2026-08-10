import type {
  ConfigScope,
  MCPServerConnection,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js'

type ServerInfoBase = {
  name: string
  client: MCPServerConnection
  scope: ConfigScope
}

export type StdioServerInfo = ServerInfoBase & {
  transport: 'stdio'
  config: McpStdioServerConfig
}

export type SSEServerInfo = ServerInfoBase & {
  transport: 'sse'
  isAuthenticated: boolean | undefined
  config: McpSSEServerConfig
}

export type HTTPServerInfo = ServerInfoBase & {
  transport: 'http'
  isAuthenticated: boolean | undefined
  config: McpHTTPServerConfig
}

export type ServerInfo = StdioServerInfo | SSEServerInfo | HTTPServerInfo

/** MCP servers declared by one or more agent definitions. */
export type AgentMcpServerInfo = {
  name: string
  sourceAgents: string[]
  transport: 'stdio' | 'sse' | 'http' | 'ws'
  command?: string
  url?: string
  needsAuth: boolean
  isAuthenticated?: boolean
}

export type MCPViewState =
  | { type: 'list'; defaultTab?: string }
  | { type: 'server-menu'; server: ServerInfo }
  | { type: 'server-tools'; server: ServerInfo }
  | { type: 'server-tool-detail'; server: ServerInfo; toolIndex: number }
  | { type: 'agent-server-menu'; agentServer: AgentMcpServerInfo }
