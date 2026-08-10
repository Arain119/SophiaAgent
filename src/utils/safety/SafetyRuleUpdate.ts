import { posix } from 'path'
import type { ToolSafetyContext } from '../../Tool.js'
// Types extracted to src/types/safety.ts to break import cycles
import type {
  AdditionalWorkingDirectory,
  WorkingDirectorySource,
} from '../../types/safety.js'
import { logForDebugging } from '../debug.js'
import type { EditableSettingSource } from '../settings/constants.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import { jsonStringify } from '../slowOperations.js'
import { toPosixPath } from './filesystem.js'
import type { SafetyRuleValue } from './SafetyRule.js'
import type {
  SafetyRuleUpdate,
  SafetyRuleUpdateDestination,
} from './SafetyRuleUpdateSchema.js'
import {
  safetyRuleValueFromString,
  safetyRuleValueToString,
} from './safetyRuleParser.js'
import { addSafetyRulesToSettings } from './safetyRulesLoader.js'

// Re-export for backwards compatibility
export type { AdditionalWorkingDirectory, WorkingDirectorySource }

export function extractRules(
  updates: SafetyRuleUpdate[] | undefined,
): SafetyRuleValue[] {
  if (!updates) return []

  return updates.flatMap(update => {
    switch (update.type) {
      case 'addRules':
        return update.rules
      default:
        return []
    }
  })
}

export function hasRules(updates: SafetyRuleUpdate[] | undefined): boolean {
  return extractRules(updates).length > 0
}

/**
 * Applies a single permission update to the context and returns the updated context
 * @param context The current permission context
 * @param update The permission update to apply
 * @returns The updated permission context
 */
export function applySafetyRuleUpdate(
  context: ToolSafetyContext,
  update: SafetyRuleUpdate,
): ToolSafetyContext {
  switch (update.type) {
    case 'addRules': {
      const ruleStrings = update.rules.map(rule =>
        safetyRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Adding ${update.rules.length} ${update.behavior} rule(s) to destination '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind = update.behavior === 'allow' ? 'allowRules' : 'denyRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: [
            ...(context[ruleKind][update.destination] || []),
            ...ruleStrings,
          ],
        },
      }
    }

    case 'replaceRules': {
      const ruleStrings = update.rules.map(rule =>
        safetyRuleValueToString(rule),
      )
      logForDebugging(
        `Replacing all ${update.behavior} rules for destination '${update.destination}' with ${update.rules.length} rule(s): ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind = update.behavior === 'allow' ? 'allowRules' : 'denyRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: ruleStrings, // Replace all rules for this source
        },
      }
    }

    case 'addDirectories': {
      logForDebugging(
        `Applying permission update: Adding ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} with destination '${update.destination}': ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.set(directory, {
          path: directory,
          source: update.destination,
        })
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    case 'removeRules': {
      const ruleStrings = update.rules.map(rule =>
        safetyRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Removing ${update.rules.length} ${update.behavior} rule(s) from source '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind = update.behavior === 'allow' ? 'allowRules' : 'denyRules'

      // Filter out the rules to be removed
      const existingRules = context[ruleKind][update.destination] || []
      const rulesToRemove = new Set(ruleStrings)
      const filteredRules = existingRules.filter(
        rule => !rulesToRemove.has(rule),
      )

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: filteredRules,
        },
      }
    }

    case 'removeDirectories': {
      logForDebugging(
        `Applying permission update: Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'}: ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.delete(directory)
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    default:
      return context
  }
}

/**
 * Applies multiple permission updates to the context and returns the updated context
 * @param context The current permission context
 * @param updates The permission updates to apply
 * @returns The updated permission context
 */
export function applySafetyRuleUpdates(
  context: ToolSafetyContext,
  updates: SafetyRuleUpdate[],
): ToolSafetyContext {
  let updatedContext = context
  for (const update of updates) {
    updatedContext = applySafetyRuleUpdate(updatedContext, update)
  }

  return updatedContext
}

export function supportsPersistence(
  destination: SafetyRuleUpdateDestination,
): destination is EditableSettingSource {
  return (
    destination === 'localSettings' ||
    destination === 'userSettings' ||
    destination === 'projectSettings'
  )
}

/**
 * Persists a permission update to the appropriate settings source
 * @param update The permission update to persist
 */
export function persistSafetyRuleUpdate(update: SafetyRuleUpdate): void {
  if (!supportsPersistence(update.destination)) return

  logForDebugging(
    `Persisting permission update: ${update.type} to source '${update.destination}'`,
  )

  switch (update.type) {
    case 'addRules': {
      logForDebugging(
        `Persisting ${update.rules.length} ${update.behavior} rule(s) to ${update.destination}`,
      )
      addSafetyRulesToSettings(
        {
          ruleValues: update.rules,
          ruleBehavior: update.behavior,
        },
        update.destination,
      )
      break
    }

    case 'addDirectories': {
      logForDebugging(
        `Persisting ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} to ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []

      // Add new directories, avoiding duplicates
      const dirsToAdd = update.directories.filter(
        dir => !existingDirs.includes(dir),
      )

      if (dirsToAdd.length > 0) {
        const updatedDirs = [...existingDirs, ...dirsToAdd]
        updateSettingsForSource(update.destination, {
          permissions: {
            additionalDirectories: updatedDirs,
          },
        })
      }
      break
    }

    case 'removeRules': {
      // Handle rule removal
      logForDebugging(
        `Removing ${update.rules.length} ${update.behavior} rule(s) from ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingPermissions = existingSettings?.permissions || {}
      const existingRules = existingPermissions[update.behavior] || []

      // Convert rules to normalized strings for comparison
      // Normalize via parse→serialize roundtrip so "Bash(*)" and "Bash" match
      const rulesToRemove = new Set(update.rules.map(safetyRuleValueToString))
      const filteredRules = existingRules.filter(rule => {
        const normalized = safetyRuleValueToString(
          safetyRuleValueFromString(rule),
        )
        return !rulesToRemove.has(normalized)
      })

      updateSettingsForSource(update.destination, {
        permissions: {
          [update.behavior]: filteredRules,
        },
      })
      break
    }

    case 'removeDirectories': {
      logForDebugging(
        `Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} from ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []

      // Remove specified directories
      const dirsToRemove = new Set(update.directories)
      const filteredDirs = existingDirs.filter(dir => !dirsToRemove.has(dir))

      updateSettingsForSource(update.destination, {
        permissions: {
          additionalDirectories: filteredDirs,
        },
      })
      break
    }

    case 'replaceRules': {
      logForDebugging(
        `Replacing all ${update.behavior} rules in ${update.destination} with ${update.rules.length} rule(s)`,
      )
      const ruleStrings = update.rules.map(safetyRuleValueToString)
      updateSettingsForSource(update.destination, {
        permissions: {
          [update.behavior]: ruleStrings,
        },
      })
      break
    }
  }
}

/**
 * Persists multiple permission updates to the appropriate settings sources
 * Only persists updates with persistable sources
 * @param updates The permission updates to persist
 */
export function persistSafetyRuleUpdates(updates: SafetyRuleUpdate[]): void {
  for (const update of updates) {
    persistSafetyRuleUpdate(update)
  }
}

/**
 * Creates a Read rule suggestion for a directory.
 * @param dirPath The directory path to create a rule for
 * @param destination The destination for the permission rule (defaults to 'session')
 * @returns A SafetyRuleUpdate for a Read rule, or undefined for the root directory
 */
export function createReadRuleSuggestion(
  dirPath: string,
  destination: SafetyRuleUpdateDestination = 'session',
): SafetyRuleUpdate | undefined {
  // Convert to POSIX format for pattern matching (handles Windows internally)
  const pathForPattern = toPosixPath(dirPath)

  // Root directory is too broad to be a reasonable permission target
  if (pathForPattern === '/') {
    return undefined
  }

  // For absolute paths, prepend an extra / to create //path/** pattern
  const ruleContent = posix.isAbsolute(pathForPattern)
    ? `/${pathForPattern}/**`
    : `${pathForPattern}/**`

  return {
    type: 'addRules',
    rules: [
      {
        toolName: 'Read',
        ruleContent,
      },
    ],
    behavior: 'allow',
    destination,
  }
}
