import type { ToolSafetyContext } from 'src/Tool.js'
import type { SafetyResult } from 'src/utils/safety/SafetyResult.js'
import {
  type ParsedPowerShellCommand,
  PS_TOKENIZER_DASH_CHARS,
} from 'src/utils/powershell/parser.js'
import { resolveToCanonical } from './readOnlyValidation.js'

const LINK_ITEM_TYPES = new Set(['symboliclink', 'junction', 'hardlink'])

function isItemTypeParamAbbrev(param: string): boolean {
  return (
    (param.length >= 3 && '-itemtype'.startsWith(param)) ||
    (param.length >= 3 && '-type'.startsWith(param))
  )
}

export function isSymlinkCreatingCommand(command: {
  name: string
  args: string[]
}): boolean {
  if (resolveToCanonical(command.name) !== 'new-item') return false

  for (let index = 0; index < command.args.length; index++) {
    const raw = command.args[index] ?? ''
    if (!raw) continue
    const normalized =
      PS_TOKENIZER_DASH_CHARS.has(raw[0]!) || raw[0] === '/'
        ? `-${raw.slice(1)}`
        : raw
    const lower = normalized.toLowerCase()
    const colonIndex = lower.indexOf(':', 1)
    const parameter = (
      colonIndex > 0 ? lower.slice(0, colonIndex) : lower
    ).replace(/`/g, '')
    if (!isItemTypeParamAbbrev(parameter)) continue

    const rawValue =
      colonIndex > 0
        ? lower.slice(colonIndex + 1)
        : (command.args[index + 1]?.toLowerCase() ?? '')
    const value = rawValue.replace(/`/g, '').replace(/^['"]|['"]$/g, '')
    if (LINK_ITEM_TYPES.has(value)) return true
  }

  return false
}

export function checkExecutionMode(
  _input: { command: string },
  _parsed: ParsedPowerShellCommand,
  _toolSafetyContext: ToolSafetyContext,
): SafetyResult {
  return {
    behavior: 'passthrough',
    message: 'Auto execution is handled by the fixed policy',
  }
}
