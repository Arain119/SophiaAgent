import {
  createWorkflowTool,
  workflowInputSchema,
  WORKFLOW_TOOL_NAME,
  type WorkflowToolDescriptor,
} from '@sophia-agent/workflow-engine'
import { buildTool, type Tool } from '../Tool.js'
import { getWorkflowService } from './service.js'

/**
 * Adapts the engine's self-contained descriptor into a buildTool-compatible Tool.
 * The descriptor routes through the service singleton (sharing ports/registry/store).
 *
 * ports resolution is deferred to the first real method call (lazy): tools.ts calls
 * createWorkflowToolCore() during module-load, and resolving ports
 * immediately would trigger service instantiation, which in turn calls module-level
 * side effects like getProjectRoot — yielding wrong paths before bootstrap completes.
 * The Tool object itself is a singleton via createWorkflowToolCore's cached
 * matches by reference), and the ports singleton is guaranteed by getWorkflowService.
 */
function buildWorkflowTool(): Tool {
  let cachedDescriptor: WorkflowToolDescriptor | null = null
  const descriptor = (): WorkflowToolDescriptor => {
    if (!cachedDescriptor) {
      const { ports } = getWorkflowService()
      cachedDescriptor = createWorkflowTool(ports)
    }
    return cachedDescriptor
  }
  return buildTool({
    name: WORKFLOW_TOOL_NAME,
    maxResultSizeChars: 50_000,
    inputSchema: workflowInputSchema,
    isEnabled: () => descriptor().isEnabled(),
    isReadOnly: input => descriptor().isReadOnly(input),
    isConcurrencySafe: () => true,
    async description() {
      return descriptor().description()
    },
    async prompt() {
      return descriptor().prompt()
    },
    async call(input, context, canUseTool, parentMessage, onProgress) {
      const result = await descriptor().call(
        input,
        context,
        canUseTool,
        parentMessage,
        onProgress,
      )
      return { data: result.data }
    },
    renderToolUseMessage: input => descriptor().renderToolUseMessage(input),
    mapToolResultToToolResultBlockParam: (data, toolUseId) =>
      descriptor().mapToolResultToToolResultBlockParam(data, toolUseId),
  })
}

// Singleton: tools.ts registration and execution must reference the same instance.
let cached: Tool | null = null

export function createWorkflowToolCore(): Tool {
  if (!cached) cached = buildWorkflowTool()
  return cached
}
