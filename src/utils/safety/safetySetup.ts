import { resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  addDirHelpMessage,
  validateDirectoryForWorkspace,
} from '../../commands/add-dir/validation.js'
import type { ToolSafetyContext } from '../../Tool.js'
import type { AdditionalWorkingDirectory } from '../../types/safety.js'
import { getToolsForDefaultPreset, parseToolPreset } from '../../tools.js'
import {
  getFsImplementation,
  safeResolvePath,
} from '../../utils/fsOperations.js'
import { applySafetyRuleUpdate } from './SafetyRuleUpdate.js'
import { normalizeLegacyToolName } from './safetyRuleParser.js'

export function parseToolListFromCLI(tools: string[]): string[] {
  const result: string[] = []

  for (const toolString of tools) {
    if (!toolString) continue

    let current = ''
    let insidePattern = false
    for (const char of toolString) {
      if (char === '(') insidePattern = true
      if (char === ')') insidePattern = false

      if ((char === ',' || char === ' ') && !insidePattern) {
        if (current.trim()) result.push(current.trim())
        current = ''
        continue
      }
      current += char
    }
    if (current.trim()) result.push(current.trim())
  }

  return result
}

function parseBaseTools(baseTools: string[]): string[] {
  const preset = parseToolPreset(baseTools.join(' ').trim())
  return preset ? getToolsForDefaultPreset() : parseToolListFromCLI(baseTools)
}

function isSymlinkToOriginalCwd(processPwd: string): boolean {
  const { resolvedPath, isSymlink } = safeResolvePath(
    getFsImplementation(),
    processPwd,
  )
  return isSymlink && resolvedPath === resolve(getOriginalCwd())
}

export async function initializeToolSafetyContext({
  baseToolsCli,
  addDirs,
}: {
  baseToolsCli?: string[]
  addDirs: string[]
}): Promise<{
  toolSafetyContext: ToolSafetyContext
  warnings: string[]
}> {
  let deniedTools: string[] = []
  if (baseToolsCli?.length) {
    const baseTools = new Set(
      parseBaseTools(baseToolsCli).map(normalizeLegacyToolName),
    )
    deniedTools = getToolsForDefaultPreset().filter(
      tool => !baseTools.has(tool),
    )
  }

  const additionalWorkingDirectories = new Map<
    string,
    AdditionalWorkingDirectory
  >()
  const processPwd = process.env.PWD
  if (
    processPwd &&
    processPwd !== getOriginalCwd() &&
    isSymlinkToOriginalCwd(processPwd)
  ) {
    additionalWorkingDirectories.set(processPwd, {
      path: processPwd,
      source: 'session',
    })
  }

  let toolSafetyContext: ToolSafetyContext = {
    mode: 'auto',
    additionalWorkingDirectories,
    allowRules: {},
    denyRules: { cliArg: deniedTools },
  }

  const warnings: string[] = []
  const validationResults = await Promise.all(
    addDirs.map(directory =>
      validateDirectoryForWorkspace(directory, toolSafetyContext),
    ),
  )
  for (const result of validationResults) {
    if (result.resultType === 'success') {
      toolSafetyContext = applySafetyRuleUpdate(toolSafetyContext, {
        type: 'addDirectories',
        directories: [result.absolutePath],
        destination: 'cliArg',
      })
      continue
    }
    if (
      result.resultType !== 'alreadyInWorkingDirectory' &&
      result.resultType !== 'pathNotFound'
    ) {
      warnings.push(addDirHelpMessage(result))
    }
  }

  return { toolSafetyContext, warnings }
}
