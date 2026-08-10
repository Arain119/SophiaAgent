import type { Notification } from 'src/context/notifications.js'
import type { TodoList } from 'src/utils/todo/types.js'
import type { Command } from '../commands.js'
import type { ElicitationRequestEvent } from '../services/mcp/elicitationHandler.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../services/mcp/types.js'
import {
  getEmptyToolSafetyContext,
  type Tool,
  type ToolSafetyContext,
} from '../Tool.js'
import type { TaskState } from '../tasks/types.js'
import type { AgentColorName } from '@sophia-agent/builtin-tools/tools/AgentTool/agentColorManager.js'
import type { AgentDefinitionsResult } from '@sophia-agent/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { AgentId } from '../types/ids.js'
import type { UserMessage } from '../types/message.js'
import type { LoadedPlugin, PluginError } from '../types/plugin.js'
import type { DeepImmutable } from '../types/utils.js'
import {
  type AttributionState,
  createEmptyAttributionState,
} from '../utils/commitAttribution.js'
import { DEFAULT_EFFORT_LEVEL, type EffortValue } from '../utils/effort.js'
import type { FileHistoryState } from '../utils/fileHistory.js'
import type { SessionHooksState } from '../utils/hooks/sessionHooks.js'
import type { ModelSetting } from '../utils/model/model.js'
import type { DenialTrackingState } from '../utils/safety/denialTracking.js'
import type { ExecutionMode } from '../utils/safety/ExecutionMode.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'
import { shouldEnableThinkingByDefault } from '../utils/thinking.js'
import type { PipeIpcState } from '../utils/pipeTransport.js'
import type { Store } from './store.js'

export type FooterItem =
  | 'tasks'
  | 'tmux'
  | 'bagel'
  | 'agents'
  | 'bridge'
  | 'bg_agent'

export type AppState = DeepImmutable<{
  settings: SettingsJson
  verbose: boolean
  mainLoopModel: ModelSetting
  mainLoopModelForSession: ModelSetting
  statusLineText: string | undefined
  expandedView: 'none' | 'tasks' | 'teammates'
  // Optional - only present when ENABLE_AGENT_SWARMS is true (for dead code elimination)
  showTeammateMessagePreview?: boolean
  selectedIPAgentIndex: number
  // Selection index for the bottom BackgroundAgentSelector.
  // -1 = main, 0..N-1 = index into useBackgroundAgentTasks().
  selectedBgAgentIndex: number
  // AgentTaskPanel selection: -1 = pill, 0 = main, 1..N = agent rows.
  // AppState (not local) so the panel can read it directly without prop-drilling
  // through PromptInput → PromptInputFooter.
  agentTaskIndex: number
  viewSelectionMode: 'none' | 'selecting-agent' | 'viewing-agent'
  // Which footer pill is focused (arrow-key navigation below the prompt).
  // Lives in AppState so pill components rendered outside PromptInput
  // Components outside PromptInput can read their own focused state.
  footerSelection: FooterItem | null
  toolSafetyContext: ToolSafetyContext
  spinnerTip?: string
  // Agent name from --agent CLI flag or settings (for logo display)
  agent: string | undefined
  // Pipe IPC state — added at runtime when feature('PIPE_IPC') is enabled.
  pipeIpc?: PipeIpcState
}> & {
  // Unified task state - excluded from DeepImmutable because TaskState contains function types
  tasks: { [taskId: string]: TaskState }
  // Name → AgentId registry populated by Agent tool when `name` is provided.
  // Latest-wins on collision. Used by SendMessage to route by name.
  agentNameRegistry: Map<string, AgentId>
  // Task ID of in-process teammate whose transcript is being viewed (undefined = leader's view)
  viewingAgentTaskId?: string
  // TODO (ashwin): see if we can use utility-types DeepReadonly for this
  mcp: {
    clients: MCPServerConnection[]
    tools: Tool[]
    commands: Command[]
    resources: Record<string, ServerResource[]>
    /**
     * Incremented by automatic plugin refresh to trigger MCP effects to re-run
     * and pick up newly-enabled plugin MCP servers. Effects read this
     * as a dependency; the value itself is not consumed.
     */
    pluginReconnectKey: number
  }
  plugins: {
    enabled: LoadedPlugin[]
    disabled: LoadedPlugin[]
    commands: Command[]
    /**
     * Plugin system errors collected during loading and initialization.
     * See {@link PluginError} type documentation for complete details on error
     * structure, context fields, and display format.
     */
    errors: PluginError[]
    // Installation status for background plugin/marketplace installation
    installationStatus: {
      marketplaces: Array<{
        name: string
        status: 'pending' | 'installing' | 'installed' | 'failed'
        error?: string
      }>
      plugins: Array<{
        id: string
        name: string
        status: 'pending' | 'installing' | 'installed' | 'failed'
        error?: string
      }>
    }
    /**
     * Set to true when plugin state on disk has changed (background reconcile,
     * /config plugin management, external settings edit) and active components
     * are stale. Interactive and headless paths consume it automatically.
     */
    needsRefresh: boolean
  }
  agentDefinitions: AgentDefinitionsResult
  fileHistory: FileHistoryState
  attribution: AttributionState
  todos: { [agentId: string]: TodoList }
  notifications: {
    current: Notification | null
    queue: Notification[]
  }
  elicitation: {
    queue: ElicitationRequestEvent[]
  }
  thinkingEnabled: boolean | undefined
  sessionHooks: SessionHooksState
  tungstenActiveSession?: {
    sessionName: string
    socketName: string
    target: string // The tmux target (e.g., "session:window.pane")
  }
  tungstenLastCapturedTime?: number // Timestamp when frame was captured for model
  tungstenLastCommand?: {
    command: string // The command string to display (e.g., "Enter", "echo hello")
    timestamp: number // When the command was sent
  }
  // Sticky tmux panel visibility — mirrors globalConfig.tungstenPanelVisible for reactivity.
  tungstenPanelVisible?: boolean
  // Transient auto-hide at turn end — separate from tungstenPanelVisible so the
  // pill stays in the footer (user can reopen) but the panel content doesn't take
  // screen space when idle. Cleared on next Tmux tool use or user toggle. NOT persisted.
  tungstenPanelAutoHidden?: boolean
  // WebBrowser tool (codename bagel): pill visible in footer
  bagelActive?: boolean
  // WebBrowser tool: current page URL shown in pill label
  bagelUrl?: string
  // WebBrowser tool: sticky panel visibility toggle
  bagelPanelVisible?: boolean
  // REPL tool VM context - persists across REPL calls for state sharing
  replContext?: {
    vmContext: import('vm').Context
    registeredTools: Map<
      string,
      {
        name: string
        description: string
        schema: Record<string, unknown>
        handler: (args: Record<string, unknown>) => Promise<unknown>
      }
    >
    console: {
      log: (...args: unknown[]) => void
      error: (...args: unknown[]) => void
      warn: (...args: unknown[]) => void
      info: (...args: unknown[]) => void
      debug: (...args: unknown[]) => void
      getStdout: () => string
      getStderr: () => string
      clear: () => void
    }
  }
  teamContext?: {
    teamName: string
    teamFilePath: string
    leadAgentId: string
    // Self-identity for swarm members (separate processes in tmux panes)
    // Note: This is different from toolUseContext.agentId which is for in-process subagents
    selfAgentId?: string // Swarm member's own ID (same as leadAgentId for leaders)
    selfAgentName?: string // Swarm member's name ('team-lead' for leaders)
    isLeader?: boolean // True if this swarm member is the team leader
    selfAgentColor?: string // Assigned color for UI (used by dynamically joined sessions)
    teammates: {
      [teammateId: string]: {
        name: string
        agentType?: string
        color?: string
        tmuxSessionName: string
        tmuxPaneId: string
        cwd: string
        worktreePath?: string
        spawnedAt: number
      }
    }
  }
  // Standalone agent context for non-swarm sessions with custom name/color
  standaloneAgentContext?: {
    name: string
    color?: AgentColorName
  }
  inbox: {
    messages: Array<{
      id: string
      from: string
      text: string
      timestamp: string
      status: 'pending' | 'processing' | 'processed'
      color?: string
      summary?: string
    }>
  }
  // Worker sandbox permission requests (leader side) - for network access approval
  workerSandboxPermissions: {
    queue: Array<{
      requestId: string
      workerId: string
      workerName: string
      workerColor?: string
      host: string
      createdAt: number
    }>
    selectedIndex: number
  }
  // Pending sandbox permission request on worker side
  pendingSandboxRequest: {
    requestId: string
    host: string
  } | null
  // Auth version - incremented when Provider credentials change.
  // Initial message to process (from CLI args or plan mode exit)
  // When set, REPL will process the message and trigger a query
  initialMessage: {
    message: UserMessage
    clearContext?: boolean
    mode?: ExecutionMode
    // Session-scoped permission rules from plan mode (e.g., "run tests", "install dependencies")
  } | null
  // Pending plan verification state (set when exiting plan mode)
  // Used by VerifyPlanExecution tool to trigger background verification
  pendingPlanVerification?: {
    plan: string
    verificationStarted: boolean
    verificationCompleted: boolean
  }
  // Denial tracking for classifier modes (YOLO, headless, etc.) - falls back to prompting when limits exceeded
  denialTracking?: DenialTrackingState
  // Active overlays (Select dialogs, etc.) for Escape key coordination
  activeOverlays: ReadonlySet<string>
  // Advisor model for server-side advisor tool (undefined = disabled).
  advisorModel?: string
  // Effort value
  effortValue?: EffortValue
}

export type AppStateStore = Store<AppState>

export function getDefaultAppState(): AppState {
  const initialMode: ExecutionMode = 'auto'

  return {
    settings: getInitialSettings(),
    tasks: {},
    agentNameRegistry: new Map(),
    verbose: false,
    mainLoopModel: null, // alias, full name (as with --model or env var), or null (default)
    mainLoopModelForSession: null,
    statusLineText: undefined,
    expandedView: 'none',
    showTeammateMessagePreview: false,
    selectedIPAgentIndex: -1,
    selectedBgAgentIndex: -1,
    agentTaskIndex: -1,
    viewSelectionMode: 'none',
    footerSelection: null,
    toolSafetyContext: {
      ...getEmptyToolSafetyContext(),
      mode: initialMode,
    },
    agent: undefined,
    agentDefinitions: { activeAgents: [], allAgents: [] },
    fileHistory: {
      snapshots: [],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    },
    attribution: createEmptyAttributionState(),
    mcp: {
      clients: [],
      tools: [],
      commands: [],
      resources: {},
      pluginReconnectKey: 0,
    },
    plugins: {
      enabled: [],
      disabled: [],
      commands: [],
      errors: [],
      installationStatus: {
        marketplaces: [],
        plugins: [],
      },
      needsRefresh: false,
    },
    todos: {},
    notifications: {
      current: null,
      queue: [],
    },
    elicitation: {
      queue: [],
    },
    thinkingEnabled: shouldEnableThinkingByDefault(),
    sessionHooks: new Map(),
    inbox: {
      messages: [],
    },
    workerSandboxPermissions: {
      queue: [],
      selectedIndex: 0,
    },
    pendingSandboxRequest: null,
    initialMessage: null,
    effortValue: DEFAULT_EFFORT_LEVEL,
    activeOverlays: new Set<string>(),
  }
}
