// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import newSession from './commands/clear/index.js'
import model from './commands/model/index.js'
import resume from './commands/resume/index.js'
import effort from './commands/effort/index.js'
import usage from './commands/usage/index.js'
import exit from './commands/exit/index.js'
import { feature } from 'bun:bundle'
import { logError } from './utils/log.js'
import { toError } from './utils/errors.js'
import { logForDebugging } from './utils/debug.js'
import {
  getSkillDirCommands,
  clearSkillCaches,
  getDynamicSkills,
} from './skills/loadSkillsDir.js'
import { getBundledSkills } from './skills/bundledSkills.js'
import { getBuiltinPluginSkillCommands } from './plugins/builtinPlugins.js'
import {
  getPluginCommands,
  clearPluginCommandCache,
  getPluginSkills,
  clearPluginSkillsCache,
} from './utils/plugins/loadPluginCommands.js'
import memoize from 'lodash-es/memoize.js'
import { getSettingSourceName } from './utils/settings/constants.js'
import {
  type Command,
  getCommandName,
  isCommandEnabled,
} from './types/command.js'

// Re-export types from the centralized location
export type {
  Command,
  CommandBase,
  CommandResultDisplay,
  LocalCommandResult,
  LocalJSXCommandContext,
  PromptCommand,
  ResumeEntrypoint,
} from './types/command.js'
export { getCommandName, isCommandEnabled } from './types/command.js'

// Commands that get eliminated from the external build
// Public-but-previously-locked commands moved to the main COMMANDS array below:
//   commit, commitPushPr, bridgeKick, initVerifiers, autofixPr, onboarding
// Remaining items here are truly Anthropic-internal (admin/diagnostics endpoints
// with no fork backend), so they only show up under USER_TYPE=ant.
export const INTERNAL_ONLY_COMMANDS: Command[] = []

// Declared as a function so that we don't run this until getCommands is called,
// since underlying functions read from config, which can't be read at module initialization time
const COMMANDS = memoize((): Command[] => [
  newSession,
  resume,
  effort,
  usage,
  model,
  exit,
  ...(process.env.USER_TYPE === 'ant' && !process.env.IS_DEMO
    ? INTERNAL_ONLY_COMMANDS
    : []),
])

export const builtInCommandNames = memoize(
  (): Set<string> =>
    new Set(COMMANDS().flatMap(_ => [_.name, ...(_.aliases ?? [])])),
)

async function getSkills(cwd: string): Promise<{
  skillDirCommands: Command[]
  pluginSkills: Command[]
  bundledSkills: Command[]
  builtinPluginSkills: Command[]
}> {
  try {
    const [skillDirCommands, pluginSkills] = await Promise.all([
      getSkillDirCommands(cwd).catch(err => {
        logError(toError(err))
        logForDebugging(
          'Skill directory commands failed to load, continuing without them',
        )
        return []
      }),
      getPluginSkills().catch(err => {
        logError(toError(err))
        logForDebugging('Plugin skills failed to load, continuing without them')
        return []
      }),
    ])
    // Bundled skills are registered synchronously at startup
    const bundledSkills = getBundledSkills()
    // Built-in plugin skills come from enabled built-in plugins
    const builtinPluginSkills = getBuiltinPluginSkillCommands()
    logForDebugging(
      `getSkills returning: ${skillDirCommands.length} skill dir commands, ${pluginSkills.length} plugin skills, ${bundledSkills.length} bundled skills, ${builtinPluginSkills.length} builtin plugin skills`,
    )
    return {
      skillDirCommands,
      pluginSkills,
      bundledSkills,
      builtinPluginSkills,
    }
  } catch (err) {
    // This should never happen since we catch at the Promise level, but defensive
    logError(toError(err))
    logForDebugging('Unexpected error in getSkills, returning empty')
    return {
      skillDirCommands: [],
      pluginSkills: [],
      bundledSkills: [],
      builtinPluginSkills: [],
    }
  }
}

/**
 * Filters commands by their declared `availability` (auth/provider requirement).
 * Commands without `availability` are treated as universal.
 * This runs before `isEnabled()` so that provider-gated commands are hidden
 * regardless of feature-flag state.
 *
 * Not memoized because command availability can change mid-session.
 * so this must be re-evaluated on every getCommands() call.
 */
/**
 * Loads model-facing capabilities. These commands are intentionally kept out
 * of the public slash-command registry: Sophia discovers and invokes them via
 * the Skill tool instead of requiring users to know capability names.
 */
const loadCapabilityCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const [
      { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
      pluginCommands,
    ] = await Promise.all([getSkills(cwd), getPluginCommands()])

    return [
      ...bundledSkills,
      ...builtinPluginSkills,
      ...skillDirCommands,
      ...(pluginCommands as Command[]),
      ...pluginSkills,
    ]
  },
)

/**
 * Returns the fixed public slash-command surface. Availability and isEnabled
 * checks run fresh every call so Provider changes take effect immediately.
 */
export async function getCommands(cwd: string): Promise<Command[]> {
  void cwd
  return COMMANDS().filter(isCommandEnabled)
}

/**
 * Clears only the memoization caches for commands, WITHOUT clearing skill caches.
 * Use this when dynamic skills are added to invalidate cached command lists.
 */
export function clearCommandMemoizationCaches(): void {
  loadCapabilityCommands.cache?.clear?.()
  getSkillToolCommands.cache?.clear?.()
}

export function clearCommandsCache(): void {
  clearCommandMemoizationCaches()
  clearPluginCommandCache()
  clearPluginSkillsCache()
  clearSkillCaches()
}

/**
 * Filter AppState.mcp.commands to MCP-provided skills (prompt-type,
 * model-invocable, loaded from MCP). These live outside getCommands() so
 * callers that need MCP skills in their skill index thread them through
 * separately.
 */
export function getMcpSkillCommands(
  mcpCommands: readonly Command[],
): readonly Command[] {
  if (feature('MCP_SKILLS')) {
    return mcpCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        cmd.loadedFrom === 'mcp' &&
        !cmd.disableModelInvocation,
    )
  }
  return []
}

// Model-facing capability index: local/bundled skills plus plugin-provided
// skills and prompts. These capabilities are not exposed as slash commands.
export const getSkillToolCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const capabilities = await loadCapabilityCommands(cwd)
    const dynamicSkills = getDynamicSkills()
    const commandsByName = new Map<string, Command>()
    for (const cmd of [...capabilities, ...dynamicSkills]) {
      if (!commandsByName.has(cmd.name)) commandsByName.set(cmd.name, cmd)
    }
    return [...commandsByName.values()].filter(
      cmd =>
        cmd.type === 'prompt' &&
        isCommandEnabled(cmd) &&
        !cmd.disableModelInvocation &&
        cmd.source !== 'builtin' &&
        // Local and bundled skills get an auto-derived description when
        // frontmatter does not provide one.
        // Plugin/MCP commands still require an explicit description to appear in the listing.
        (cmd.loadedFrom === 'bundled' ||
          cmd.loadedFrom === 'skills' ||
          cmd.hasUserSpecifiedDescription ||
          cmd.whenToUse),
    )
  },
)

export function findCommand(
  commandName: string,
  commands: Command[],
): Command | undefined {
  return commands.find(
    _ =>
      _.name === commandName ||
      getCommandName(_) === commandName ||
      _.aliases?.includes(commandName),
  )
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return findCommand(commandName, commands) !== undefined
}

export function getCommand(commandName: string, commands: Command[]): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = getCommandName(_)
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .sort((a, b) => a.localeCompare(b))
        .join(', ')}`,
    )
  }

  return command
}

/**
 * Formats a command's description with its source annotation for user-facing UI.
 * Use this in typeahead, help screens, and other places where users need to see
 * where a command comes from.
 *
 * For model-facing prompts (like SkillTool), use cmd.description directly.
 */
export function formatDescriptionWithSource(cmd: Command): string {
  if (cmd.type !== 'prompt') {
    return cmd.description
  }

  if (cmd.kind === 'workflow') {
    return `${cmd.description} (workflow)`
  }

  if (cmd.source === 'plugin') {
    const pluginName = cmd.pluginInfo?.pluginManifest.name
    if (pluginName) {
      return `(${pluginName}) ${cmd.description}`
    }
    return `${cmd.description} (plugin)`
  }

  if (cmd.source === 'builtin' || cmd.source === 'mcp') {
    return cmd.description
  }

  if (cmd.source === 'bundled') {
    return `${cmd.description} (bundled)`
  }

  return `${cmd.description} (${getSettingSourceName(cmd.source)})`
}
