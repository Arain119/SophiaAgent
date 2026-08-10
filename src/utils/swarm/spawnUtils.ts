/**
 * Shared utilities for spawning teammates across different backends.
 */

import {
  getChromeFlagOverride,
  getFlagSettingsPath,
  getInlinePlugins,
} from '../../bootstrap/state.js'
import { quote } from '../bash/shellQuote.js'
import { isInBundledMode } from '../bundledMode.js'
import { getTeammateModeFromSnapshot } from './backends/teammateModeSnapshot.js'
import { TEAMMATE_COMMAND_ENV_VAR } from './constants.js'

/**
 * Gets the command to use for spawning teammate processes.
 * Uses TEAMMATE_COMMAND_ENV_VAR if set, otherwise falls back to the
 * current process executable path.
 */
export function getTeammateCommand(): string {
  if (process.env[TEAMMATE_COMMAND_ENV_VAR]) {
    return process.env[TEAMMATE_COMMAND_ENV_VAR]
  }
  return isInBundledMode() ? process.execPath : process.argv[1]!
}

/**
 * Builds CLI flags to propagate from the current session to spawned teammates.
 * This ensures teammates inherit session and plugin configuration. */
export function buildInheritedCliFlags(): string {
  return quote(buildInheritedCliArgParts())
}

export function buildInheritedCliArgParts(): string[] {
  const flags: string[] = []

  // Propagate --settings if set via CLI
  const settingsPath = getFlagSettingsPath()
  if (settingsPath) {
    flags.push('--settings', settingsPath)
  }

  // Propagate --plugin-dir for each inline plugin
  const inlinePlugins = getInlinePlugins()
  for (const pluginDir of inlinePlugins) {
    flags.push('--plugin-dir', pluginDir)
  }

  // Propagate --teammate-mode so tmux teammates use the same mode as leader
  const sessionMode = getTeammateModeFromSnapshot()
  flags.push('--teammate-mode', sessionMode)

  // Propagate --chrome / --no-chrome if explicitly set on the CLI
  const chromeFlagOverride = getChromeFlagOverride()
  if (chromeFlagOverride === true) {
    flags.push('--chrome')
  } else if (chromeFlagOverride === false) {
    flags.push('--no-chrome')
  }

  return flags
}

/**
 * Environment variables that must be explicitly forwarded to tmux-spawned
 * teammates. Tmux may start a new login shell that doesn't inherit the
 * parent's env, so we forward any that are set in the current process.
 */
const TEAMMATE_ENV_VARS = [
  // API provider selection — without these, teammates default to firstParty
  // and send requests to the wrong endpoint (GitHub issue #23561)
  // Custom API endpoint
  'OPENAI_BASE_URL',
  // Config directory override
  'SOPHIA_CONFIG_DIR',
  // Marker for teammate-specific code paths. Auth finds
  // Credentials are loaded from the shared Sophia provider store; file
  // descriptors do not cross tmux boundaries.
  // Auto-memory gate (memdir/paths.ts) checks REMOTE && !MEMORY_DIR to
  // disable memory on ephemeral filesystems. Forwarding REMOTE alone
  // would flip teammates to memory-off when the parent has it on.
  // Upstream proxy — the parent's MITM relay is reachable from teammates
  // (same container network). Forward the proxy vars so teammates route
  // customer-configured upstream traffic through the relay for credential
  // injection. Without these, teammates bypass the proxy entirely.
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
] as const

/**
 * Builds the `env KEY=VALUE ...` string for teammate spawn commands.
 * Always includes SOPHIA_AGENT=1 and SOPHIA_EXPERIMENTAL_AGENT_TEAMS=1,
 * plus any provider/config env vars that are set in the current process.
 */
export function buildInheritedEnvVars(): string {
  return getInheritedEnvVarAssignments()
    .map(([key, value]) => `${key}=${quote([value])}`)
    .join(' ')
}

export function getInheritedEnvVarAssignments(): Array<[string, string]> {
  const envVars: Array<[string, string]> = [
    ['SOPHIA_AGENT', '1'],
    ['SOPHIA_EXPERIMENTAL_AGENT_TEAMS', '1'],
  ]

  for (const key of TEAMMATE_ENV_VARS) {
    const value = process.env[key]
    if (value !== undefined && value !== '') {
      envVars.push([key, value])
    }
  }

  return envVars
}
