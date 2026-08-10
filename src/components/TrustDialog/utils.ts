import type { SafetyRule } from 'src/utils/safety/SafetyRule.js'
import { getSettingsForSource } from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import { BASH_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/BashTool/toolName.js'
import { SAFE_ENV_VARS } from '../../utils/managedEnvConstants.js'
import { getSafetyRulesForSource } from '../../utils/safety/safetyRulesLoader.js'

function hasHooks(settings: SettingsJson | null): boolean {
  if (settings === null || settings.disableAllHooks) {
    return false
  }
  if (settings.statusLine) {
    return true
  }
  if (settings.fileSuggestion) {
    return true
  }
  if (!settings.hooks) {
    return false
  }
  for (const hookConfig of Object.values(settings.hooks)) {
    if (hookConfig.length > 0) {
      return true
    }
  }
  return false
}

export function getHooksSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasHooks(projectSettings)) {
    sources.push('.sophia/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasHooks(localSettings)) {
    sources.push('.sophia/settings.local.json')
  }

  return sources
}

function hasBashPermission(rules: SafetyRule[]): boolean {
  return rules.some(
    rule =>
      rule.ruleBehavior === 'allow' &&
      (rule.ruleValue.toolName === BASH_TOOL_NAME ||
        rule.ruleValue.toolName.startsWith(BASH_TOOL_NAME + '(')),
  )
}

/**
 * Get which setting sources have bash allow rules.
 * Returns an array of file paths that have bash permissions.
 */
export function getBashPermissionSources(): string[] {
  const sources: string[] = []

  const projectRules = getSafetyRulesForSource('projectSettings')
  if (hasBashPermission(projectRules)) {
    sources.push('.sophia/settings.json')
  }

  const localRules = getSafetyRulesForSource('localSettings')
  if (hasBashPermission(localRules)) {
    sources.push('.sophia/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have otelHeadersHelper configured
 */
function hasOtelHeadersHelper(settings: SettingsJson | null): boolean {
  return !!settings?.otelHeadersHelper
}

/**
 * Get which setting sources have otelHeadersHelper configured.
 * Returns an array of file paths that have otelHeadersHelper.
 */
export function getOtelHeadersHelperSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasOtelHeadersHelper(projectSettings)) {
    sources.push('.sophia/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasOtelHeadersHelper(localSettings)) {
    sources.push('.sophia/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have dangerous environment variables configured.
 * Any env var NOT in SAFE_ENV_VARS is considered dangerous.
 */
function hasDangerousEnvVars(settings: SettingsJson | null): boolean {
  if (!settings?.env) {
    return false
  }
  return Object.keys(settings.env).some(
    key => !SAFE_ENV_VARS.has(key.toUpperCase()),
  )
}

/**
 * Get which setting sources have dangerous environment variables configured.
 * Returns an array of file paths that have env vars not in SAFE_ENV_VARS.
 */
export function getDangerousEnvVarsSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasDangerousEnvVars(projectSettings)) {
    sources.push('.sophia/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasDangerousEnvVars(localSettings)) {
    sources.push('.sophia/settings.local.json')
  }

  return sources
}
