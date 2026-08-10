import type { z } from 'zod/v4'
import type { ToolSafetyContext } from 'src/Tool.js'
import type { SafetyResult } from 'src/utils/safety/SafetyResult.js'
import type { BashTool } from './BashTool.js'

export function checkExecutionMode(
  _input: z.infer<typeof BashTool.inputSchema>,
  _toolSafetyContext: ToolSafetyContext,
): SafetyResult {
  return {
    behavior: 'passthrough',
    message: 'Auto execution is handled by the fixed policy',
  }
}
