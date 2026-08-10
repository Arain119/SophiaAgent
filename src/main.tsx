// These side-effects must run before all other imports:
// 1. profileCheckpoint marks entry before heavy module evaluation begins
// 2. startMdmRawRead fires MDM subprocesses (plutil/reg query) so they run in
//    parallel with the remaining ~135ms of imports below
// 3. startKeychainPrefetch starts the macOS API key read in parallel.
//    sequentially via sync spawn inside applySafeConfigEnvironmentVariables()
//    (~65ms on every macOS startup)
import { profileCheckpoint, profileReport } from './utils/startupProfiler.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint('main_tsx_entry');

import { startMdmRawRead } from './utils/settings/mdm/rawRead.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startMdmRawRead();

import { ensureKeychainPrefetchCompleted, startKeychainPrefetch } from './utils/secureStorage/keychainPrefetch.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startKeychainPrefetch();

import { feature } from 'bun:bundle';
import { Command as CommanderCommand, InvalidArgumentError, Option } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import uniqBy from 'lodash-es/uniqBy.js';
import { getSystemContext, getUserContext } from './context.js';
import { init, initializeTelemetryAfterTrust } from './entrypoints/init.js';
import { addToHistory } from './history.js';
import type { Root } from '@anthropic/ink';
import { launchRepl } from './replLauncher.js';
import type { McpSdkServerConfig, ScopedMcpServerConfig } from './services/mcp/types.js';
import type { ToolInputJSONSchema } from './Tool.js';
import {
  createSyntheticOutputTool,
  isSyntheticOutputToolEnabled,
} from '@sophia-agent/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js';
import { getTools } from './tools.js';
import {
  canUserConfigureAdvisor,
  getInitialAdvisorSetting,
  isAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from './utils/advisor.js';
import { isAgentSwarmsEnabled } from './utils/agentSwarmsEnabled.js';
import { count } from './utils/array.js';
import { installAsciicastRecorder } from './utils/asciicast.js';
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  isAutoUpdaterDisabled,
  saveGlobalConfig,
} from './utils/config.js';
import { seedEarlyInput, stopCapturingEarlyInput } from './utils/earlyInput.js';
import { getInitialEffortSetting, parseEffortValue } from './utils/effort.js';
import { applyConfigEnvironmentVariables } from './utils/managedEnv.js';
import { createSystemMessage, createUserMessage } from './utils/messages.js';
import { getPlatform } from './utils/platform.js';
import { getBaseRenderOptions } from './utils/renderOptions.js';
import { settingsChangeDetector } from './utils/settings/changeDetector.js';
import { skillChangeDetector } from './utils/skills/skillChangeDetector.js';
import { jsonParse } from './utils/slowOperations.js';
import { computeInitialTeamContext } from './utils/swarm/reconnection.js';
import { initializeWarningHandler } from './utils/warningHandler.js';

// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeammateUtils = () => require('./utils/teammate.js') as typeof import('./utils/teammate.js');
const getTeammatePromptAddendum = () =>
  require('./utils/swarm/teammatePromptAddendum.js') as typeof import('./utils/swarm/teammatePromptAddendum.js');
/* eslint-enable @typescript-eslint/no-require-imports */
import { relative, resolve } from 'path';
import { isAnalyticsDisabled } from 'src/services/analytics/config.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { initializeAnalyticsGates } from 'src/services/analytics/sink.js';
import { getOriginalCwd, setAdditionalDirectoriesForClaudeMd, setMainThreadAgentType } from './bootstrap/state.js';
import { getCommands } from './commands.js';
import type { StatsStore } from './context/stats.js';
import { launchInvalidSettingsDialog, launchResumeChooser, launchSnapshotUpdateDialog } from './dialogLaunchers.js';
import { SHOW_CURSOR } from '@anthropic/ink';
import {
  exitWithError,
  exitWithMessage,
  getRenderContext,
  renderAndRun,
  showSetupScreens,
} from './interactiveHelpers.js';
import { initBuiltinPlugins } from './plugins/bundled/index.js';
/* eslint-enable @typescript-eslint/no-require-imports */
import { getMcpToolsCommandsAndResources, prefetchAllMcpResources } from './services/mcp/client.js';
import { initBundledSkills } from './skills/bundled/index.js';
import type { AgentColorName } from '@sophia-agent/builtin-tools/tools/AgentTool/agentColorManager.js';
import {
  getAgentDefinitionsWithOverrides,
  isBuiltInAgent,
  isCustomAgent,
} from '@sophia-agent/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import type { LogOption } from './types/logs.js';
import type { Message as MessageType } from './types/message.js';
import { getContextWindowForModel } from './utils/context.js';
import { loadConversationForResume } from './utils/conversationRecovery.js';
import { buildDeepLinkBanner } from './utils/deepLink/banner.js';
import { hasNodeOption, isBareMode, isEnvTruthy, isInProtectedNamespace } from './utils/envUtils.js';
import { refreshExampleCommands } from './utils/exampleCommands.js';
import type { FpsMetrics } from './utils/fpsTracker.js';
import { getWorktreePaths } from './utils/getWorktreePaths.js';
import { findGitRoot, getBranch, getIsGit, getWorktreeCount } from './utils/git.js';
import { getGhAuthStatus } from './utils/github/ghAuthStatus.js';
import { logError } from './utils/log.js';
import {
  getConfiguredProviderModel,
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from './utils/model/model.js';
import { initializeToolSafetyContext, parseToolListFromCLI } from './utils/safety/safetySetup.js';
import { cleanupOrphanedPluginVersionsInBackground } from './utils/plugins/cacheUtils.js';
import { initializeVersionedPlugins } from './utils/plugins/installedPluginsManager.js';
import { getManagedPluginNames } from './utils/plugins/managedPlugins.js';
import { getGlobExclusionsForPluginCache } from './utils/plugins/orphanedPluginFilter.js';
import { getPluginSeedDirs } from './utils/plugins/pluginDirectories.js';
import { countFilesRoundedRg } from './utils/ripgrep.js';
import { processSessionStartHooks, processSetupHooks } from './utils/sessionStart.js';
import {
  cacheSessionTitle,
  getSessionIdFromLog,
  loadTranscriptFromFile,
  saveAgentSetting,
  searchSessionsByCustomTitle,
  sessionIdExists,
} from './utils/sessionStorage.js';
import { ensureMdmSettingsLoaded } from './utils/settings/mdm/settings.js';
import {
  getInitialSettings,
  getManagedSettingsKeysForLogging,
  getSettingsForSource,
  getSettingsWithErrors,
} from './utils/settings/settings.js';
import { DEFAULT_TASKS_MODE_TASK_LIST_ID, TASK_STATUSES } from './utils/tasks.js';
import { logPluginLoadErrors, logPluginsEnabledForSession } from './utils/telemetry/pluginTelemetry.js';
import { logSkillsLoaded } from './utils/telemetry/skillLoadedEvent.js';
import { validateUuid } from './utils/uuid.js';
// Plugin startup checks are now handled non-blockingly in REPL.tsx

import { logPermissionContextForAnts } from 'src/services/internalLogging.js';
import {
  areMcpConfigsAllowedWithEnterpriseMcpConfig,
  getClaudeCodeMcpConfigs,
  parseMcpConfig,
  parseMcpConfigFromFilePath,
} from 'src/services/mcp/config.js';
import { getRelevantTips } from 'src/services/tips/tipRegistry.js';
import { logContextMetrics } from 'src/utils/api.js';
import { registerCleanup } from 'src/utils/cleanupRegistry.js';
import { createEmptyAttributionState } from 'src/utils/commitAttribution.js';
import { countConcurrentSessions, registerSession, updateSessionName } from 'src/utils/concurrentSessions.js';
import { getCwd } from 'src/utils/cwd.js';
import { logForDebugging, setHasFormattedOutput } from 'src/utils/debug.js';
import { errorMessage, getErrnoCode, isENOENT, toError } from 'src/utils/errors.js';
import { gracefulShutdown, gracefulShutdownSync } from 'src/utils/gracefulShutdown.js';
import { setAllHookEventsEnabled } from 'src/utils/hooks/hookEvents.js';
import { peekForStdinData, writeToStderr } from 'src/utils/process.js';
import { setCwd } from 'src/utils/Shell.js';
import { type ProcessedResume, processResumedConversation } from 'src/utils/sessionRestore.js';
import {
  getIsNonInteractiveSession,
  getSessionId,
  setClientType,
  setInitialMainLoopModel,
  setIsInteractive,
  setQuestionPreviewFormat,
  setSessionPersistenceDisabled,
  switchSession,
} from './bootstrap/state.js';

import { migrateEnableAllProjectMcpServersToSettings } from './migrations/migrateEnableAllProjectMcpServersToSettings.js';
/* eslint-enable @typescript-eslint/no-require-imports */
import { initializeLspServerManager } from './services/lsp/manager.js';
import { type AppState, getDefaultAppState } from './state/AppStateStore.js';
import { onChangeAppState } from './state/onChangeAppState.js';
import { createStore } from './state/store.js';
import { asSessionId } from './types/ids.js';
import { isInBundledMode, isRunningWithBun } from './utils/bundledMode.js';
import { logForDiagnosticsNoPII } from './utils/diagLogs.js';
import { filterExistingPaths, getKnownPathsForRepo } from './utils/githubRepoPathMapping.js';
import { loadAllPluginsCacheOnly } from './utils/plugins/pluginLoader.js';
import { migrateChangelogFromConfig } from './utils/releaseNotes.js';
import { SandboxManager } from './utils/sandbox/sandbox-adapter.js';
import { shouldEnableThinkingByDefault, type ThinkingConfig } from './utils/thinking.js';
import { initUser } from './utils/user.js';

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint('main_tsx_imports_loaded');

/**
 * Log managed settings keys to Statsig for analytics.
 * This is called after init() completes to ensure settings are loaded
 * and environment variables are applied before model resolution.
 */
function logManagedSettings(): void {
  try {
    const policySettings = getSettingsForSource('policySettings');
    if (policySettings) {
      const allKeys = getManagedSettingsKeysForLogging(policySettings);
      logEvent('tengu_managed_settings_loaded', {
        keyCount: allKeys.length,
        keys: allKeys.join(',') as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }
  } catch {
    // Silently ignore errors - this is just for analytics
  }
}

// Check if running in debug/inspection mode
function _isBeingDebugged() {
  const isBun = isRunningWithBun();

  // Check for inspect flags in process arguments (including all variants)
  const hasInspectArg = process.execArgv.some(arg => {
    if (isBun) {
      // Note: Bun has an issue with single-file executables where application arguments
      // from process.argv leak into process.execArgv (similar to https://github.com/oven-sh/bun/issues/11673)
      // This breaks use of --debug mode if we omit this branch
      // We're fine to skip that check, because Bun doesn't support Node.js legacy --debug or --debug-brk flags
      return /--inspect(-brk)?/.test(arg);
    } else {
      // In Node.js, check for both --inspect and legacy --debug flags
      return /--inspect(-brk)?|--debug(-brk)?/.test(arg);
    }
  });

  // Check if NODE_OPTIONS contains inspect flags
  const hasInspectEnv = process.env.NODE_OPTIONS && /--inspect(-brk)?|--debug(-brk)?/.test(process.env.NODE_OPTIONS);

  // Check if inspector is available and active (indicates debugging)
  try {
    // Dynamic import would be better but is async - use global object instead
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inspector = (global as any).require('inspector');
    const hasInspectorUrl = !!inspector.url();
    return hasInspectorUrl || hasInspectArg || hasInspectEnv;
  } catch {
    // Ignore error and fall back to argument detection
    return hasInspectArg || hasInspectEnv;
  }
}

/**
 * Per-session skill/plugin telemetry. Called from both the interactive path
 * and the headless -p path (before runHeadless) — both go through
 * main.tsx but branch before the interactive startup path, so it needs two
 * call sites here rather than one here + one in QueryEngine.
 */
function logSessionTelemetry(): void {
  void logSkillsLoaded(getCwd());
  void loadAllPluginsCacheOnly()
    .then(({ enabled, errors }) => {
      const managedNames = getManagedPluginNames();
      logPluginsEnabledForSession(enabled, managedNames, getPluginSeedDirs());
      logPluginLoadErrors(errors, managedNames);
    })
    .catch(err => logError(err));
}

function getCertEnvVarTelemetry(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (process.env.NODE_EXTRA_CA_CERTS) {
    result.has_node_extra_ca_certs = true;
  }
  if (process.env.SOPHIA_CLIENT_CERT) {
    result.has_client_cert = true;
  }
  if (hasNodeOption('--use-system-ca')) {
    result.has_use_system_ca = true;
  }
  if (hasNodeOption('--use-openssl-ca')) {
    result.has_use_openssl_ca = true;
  }
  return result;
}

async function logStartupTelemetry(): Promise<void> {
  if (isAnalyticsDisabled()) return;
  const [isGit, worktreeCount, ghAuthStatus] = await Promise.all([getIsGit(), getWorktreeCount(), getGhAuthStatus()]);

  logEvent('tengu_startup_telemetry', {
    is_git: isGit,
    worktree_count: worktreeCount,
    gh_auth_status: ghAuthStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    sandbox_enabled: SandboxManager.isSandboxingEnabled(),
    are_unsandboxed_commands_allowed: SandboxManager.areUnsandboxedCommandsAllowed(),
    is_auto_bash_allowed_if_sandbox_enabled: SandboxManager.isAutoAllowBashIfSandboxedEnabled(),
    auto_updater_disabled: isAutoUpdaterDisabled(),
    prefers_reduced_motion: getInitialSettings().prefersReducedMotion ?? false,
    ...getCertEnvVarTelemetry(),
  });
}

// Bump this when adding a new sync migration so existing users re-run the set.
const CURRENT_MIGRATION_VERSION = 11;
function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateEnableAllProjectMcpServersToSettings();
    saveGlobalConfig(prev =>
      prev.migrationVersion === CURRENT_MIGRATION_VERSION
        ? prev
        : { ...prev, migrationVersion: CURRENT_MIGRATION_VERSION },
    );
  }
  // Async migration - fire and forget since it's non-blocking
  migrateChangelogFromConfig().catch(() => {
    // Silently ignore migration errors - will retry on next startup
  });
}

/**
 * Prefetch system context (including git status) only when it's safe to do so.
 * Git commands can execute arbitrary code via hooks and config (e.g., core.fsmonitor,
 * diff.external), so we must only run them after trust is established or in
 * non-interactive mode where trust is implicit.
 */
function prefetchSystemContextIfSafe(): void {
  const isNonInteractiveSession = getIsNonInteractiveSession();

  // In non-interactive mode (--print), trust dialog is skipped and
  // execution is considered trusted (as documented in help text)
  if (isNonInteractiveSession) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_non_interactive');
    void getSystemContext();
    return;
  }

  // In interactive mode, only prefetch if trust has already been established
  const hasTrust = checkHasTrustDialogAccepted();
  if (hasTrust) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_has_trust');
    void getSystemContext();
  } else {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_skipped_no_trust');
  }
  // Otherwise, don't prefetch - wait for trust to be established first
}

/**
 * Start background prefetches and housekeeping that are NOT needed before first render.
 * These are deferred from setup() to reduce event loop contention and child process
 * spawning during the critical startup path.
 * Call this after the REPL has been rendered.
 */
export function startDeferredPrefetches(): void {
  // This function runs after first render, so it doesn't block the initial paint.
  // However, the spawned processes and async work still contend for CPU and event
  // loop time, which skews startup benchmarks (CPU profiles, time-to-first-render
  // measurements). Skip all of it when we're only measuring startup performance.
  if (
    isEnvTruthy(process.env.SOPHIA_EXIT_AFTER_FIRST_RENDER) ||
    // --bare: skip ALL prefetches. These are cache-warms for the REPL's
    // first-turn responsiveness (initUser, getUserContext, tips, countFiles,
    // modelCapabilities, change detectors). Scripted -p calls don't have a
    // "user is typing" window to hide this work in — it's pure overhead on
    // the critical path.
    isBareMode()
  ) {
    return;
  }

  // Process-spawning prefetches (consumed at first API call, user is still typing)
  void initUser();
  void getUserContext();
  prefetchSystemContextIfSafe();
  void getRelevantTips();
  void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), []);

  // Analytics and feature flag initialization
  void initializeAnalyticsGates();

  // File change detectors deferred from init() to unblock first render
  void settingsChangeDetector.initialize();
  if (!isBareMode()) {
    void skillChangeDetector.initialize();
  }

  // Event loop stall detector — logs when the main thread is blocked >500ms
  if (process.env.USER_TYPE === 'ant') {
    void import('./utils/eventLoopStallDetector.js').then(m => m.startEventLoopStallDetector());
  }
}

function initializeEntrypoint(isNonInteractive: boolean): void {
  // Skip if already set (e.g., by SDK or other entrypoints)
  if (process.env.SOPHIA_ENTRYPOINT) {
    return;
  }

  const cliArgs = process.argv.slice(2);

  if (isEnvTruthy(process.env.SOPHIA_ACTION)) {
    process.env.SOPHIA_ENTRYPOINT = 'claude-code-github-action';
    return;
  }

  // Note: 'local-agent' entrypoint is set by the local agent mode launcher
  // via SOPHIA_ENTRYPOINT env var (handled by early return above)

  // Set based on interactive status
  process.env.SOPHIA_ENTRYPOINT = isNonInteractive ? 'sdk-cli' : 'cli';
}

export async function main() {
  profileCheckpoint('main_function_start');

  // SECURITY: Prevent Windows from executing commands from current directory
  // This must be set before ANY command execution to prevent PATH hijacking attacks
  // See: https://docs.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw
  process.env.NoDefaultCurrentDirectoryInExePath = '1';

  // Initialize warning handler early to catch warnings
  initializeWarningHandler();

  process.on('exit', () => {
    resetCursor();
    // 杀掉所有 running workflow，避免孤儿 task 留在 AppState 里
    try {
      const { peekWorkflowService } = require('./workflow/service.js') as {
        peekWorkflowService: () => { shutdown: () => void } | null;
      };
      peekWorkflowService()?.shutdown();
    } catch {
      // workflow 未启用或已卸载——忽略
    }
  });
  process.on('SIGINT', () => {
    // In print mode, print.ts registers its own SIGINT handler that aborts
    // the in-flight query and calls gracefulShutdown; skip here to avoid
    // preempting it with a synchronous process.exit().
    if (process.argv.includes('-p') || process.argv.includes('--print')) {
      return;
    }
    process.exit(0);
  });
  profileCheckpoint('main_warning_handler_initialized');

  // Check for a Sophia direct-connect URL in argv and rewrite so the main command
  // handles it, giving the full interactive TUI instead of a stripped-down subcommand.
  // For headless (-p), we rewrite to the internal `open` subcommand.
  // Handle deep link URIs early — this is invoked by the OS protocol handler
  // and should bail out before full init since it only needs to parse the URI
  // and open a terminal.
  if (feature('LODESTONE')) {
    const handleUriIdx = process.argv.indexOf('--handle-uri');
    if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
      const { enableConfigs } = await import('./utils/config.js');
      enableConfigs();
      const uri = process.argv[handleUriIdx + 1]!;
      const { handleDeepLinkUri } = await import('./utils/deepLink/protocolHandler.js');
      const exitCode = await handleDeepLinkUri(uri);
      process.exit(exitCode);
    }

    // macOS URL handler: when LaunchServices launches our .app bundle, the
    // URL arrives via Apple Event (not argv). LaunchServices overwrites
    // __CFBundleIdentifier to the launching bundle's ID, which is a precise
    // positive signal — cheaper than importing and guessing with heuristics.
    if (process.platform === 'darwin' && process.env.__CFBundleIdentifier === 'com.anthropic.claude-code-url-handler') {
      const { enableConfigs } = await import('./utils/config.js');
      enableConfigs();
      const { handleUrlSchemeLaunch } = await import('./utils/deepLink/protocolHandler.js');
      const urlSchemeResult = await handleUrlSchemeLaunch();
      process.exit(urlSchemeResult ?? 1);
    }
  }

  // Check for -p/--print and --init-only flags early to set isInteractiveSession before init()
  // This is needed because telemetry initialization calls auth functions that need this flag
  const cliArgs = process.argv.slice(2);
  const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print');
  const hasInitOnlyFlag = cliArgs.includes('--init-only');
  const hasSdkUrl = cliArgs.some(arg => arg.startsWith('--sdk-url'));
  const forceInteractive = isEnvTruthy(process.env.SOPHIA_FORCE_INTERACTIVE);
  const hasTerminal = Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY);
  // sophia with no arguments is always the interactive product surface.
  // PowerShell npm shims can report stdout.isTTY as undefined even while
  // attached to a real console, which previously caused a silent headless exit.
  const isBareInteractiveLaunch = cliArgs.length === 0;
  const isNonInteractive =
    hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || (!forceInteractive && !isBareInteractiveLaunch && !hasTerminal);

  // Stop capturing early input for non-interactive modes
  if (isNonInteractive) {
    stopCapturingEarlyInput();
  }

  // Set simplified tracking fields
  const isInteractive = !isNonInteractive;
  setIsInteractive(isInteractive);

  // Initialize entrypoint based on mode - needs to be set before any event is logged
  initializeEntrypoint(isNonInteractive);

  // Determine client type
  const clientType = (() => {
    if (isEnvTruthy(process.env.GITHUB_ACTIONS)) return 'github-action';
    if (process.env.SOPHIA_ENTRYPOINT === 'sdk-ts') return 'sdk-typescript';
    if (process.env.SOPHIA_ENTRYPOINT === 'sdk-py') return 'sdk-python';
    if (process.env.SOPHIA_ENTRYPOINT === 'sdk-cli') return 'sdk-cli';
    if (process.env.SOPHIA_ENTRYPOINT === 'claude-vscode') return 'claude-vscode';
    if (process.env.SOPHIA_ENTRYPOINT === 'local-agent') return 'local-agent';
    if (process.env.SOPHIA_ENTRYPOINT === 'claude-desktop') return 'claude-desktop';

    return 'cli';
  })();
  setClientType(clientType);

  const previewFormat = process.env.SOPHIA_QUESTION_PREVIEW_FORMAT;
  if (previewFormat === 'markdown' || previewFormat === 'html') {
    setQuestionPreviewFormat(previewFormat);
  } else if (
    !clientType.startsWith('sdk-') &&
    // Desktop clients pass previewFormat via toolConfig; when the feature is
    // gated off they pass undefined — don't override that with markdown.
    clientType !== 'claude-desktop' &&
    clientType !== 'local-agent'
  ) {
    setQuestionPreviewFormat('markdown');
  }

  profileCheckpoint('main_client_type_determined');

  // Parse and load settings flags early, before init()

  profileCheckpoint('main_before_run');

  await run();
  profileCheckpoint('main_after_run');
}

async function getInputPrompt(
  prompt: string,
  inputFormat: 'text' | 'stream-json',
): Promise<string | AsyncIterable<string>> {
  if (
    getIsNonInteractiveSession() &&
    !process.stdin.isTTY &&
    // Input hijacking breaks MCP.
    !process.argv.includes('mcp')
  ) {
    if (inputFormat === 'stream-json') {
      return process.stdin;
    }
    process.stdin.setEncoding('utf8');
    let data = '';
    const onData = (chunk: string) => {
      data += chunk;
    };
    process.stdin.on('data', onData);
    // If no data arrives in 3s, stop waiting and warn. Stdin is likely an
    // inherited pipe from a parent that isn't writing (subprocess spawned
    // without explicit stdin handling). 3s covers slow producers like curl,
    // jq on large files, python with import overhead. The warning makes
    // silent data loss visible for the rare producer that's slower still.
    const timedOut = await peekForStdinData(process.stdin, 3000);
    process.stdin.off('data', onData);
    if (timedOut) {
      process.stderr.write(
        'Warning: no stdin data received in 3s, proceeding without it. ' +
          'If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\n',
      );
    }
    return [prompt, data].filter(Boolean).join('\n');
  }
  return prompt;
}

async function run(): Promise<CommanderCommand> {
  profileCheckpoint('run_function_start');

  // Create help config that sorts options by long option name.
  // Commander supports compareOptions at runtime but @commander-js/extra-typings
  // doesn't include it in the type definitions, so we use Object.assign to add it.
  function createSortedHelpConfig(): {
    sortSubcommands: true;
    sortOptions: true;
  } {
    const getOptionSortKey = (opt: Option): string =>
      opt.long?.replace(/^--/, '') ?? opt.short?.replace(/^-/, '') ?? '';
    return Object.assign({ sortSubcommands: true, sortOptions: true } as const, {
      compareOptions: (a: Option, b: Option) => getOptionSortKey(a).localeCompare(getOptionSortKey(b)),
    });
  }
  const program = new CommanderCommand().configureHelp(createSortedHelpConfig()).enablePositionalOptions();
  profileCheckpoint('run_commander_initialized');

  // Use preAction hook to run initialization only when executing a command,
  // not when displaying help. This avoids the need for env variable signaling.
  program.hook('preAction', async thisCommand => {
    profileCheckpoint('preAction_start');
    // Await async subprocess loads started at module evaluation (lines 12-20).
    // Nearly free — subprocesses complete during the ~135ms of imports above.
    // Must resolve before init() which triggers the first settings read
    // (applySafeConfigEnvironmentVariables → getSettingsForSource('policySettings')
    // Provider eligibility checks avoid unnecessary keychain reads.
    await Promise.all([ensureMdmSettingsLoaded(), ensureKeychainPrefetchCompleted()]);
    profileCheckpoint('preAction_after_mdm');
    await init();
    profileCheckpoint('preAction_after_init');

    // process.title on Windows sets the console title directly; on POSIX,
    // terminal shell integration may mirror the process name to the tab.
    // After init() so settings.json env can also gate this (gh-4765).
    if (!isEnvTruthy(process.env.SOPHIA_DISABLE_TERMINAL_TITLE)) {
      process.title = 'sophia';
    }

    // Attach logging sinks so subcommand handlers can use logEvent/logError.
    // Before PR #11106 logEvent dispatched directly; after, events queue until
    // a sink attaches. setup() attaches sinks for the default command, but
    // subcommands (doctor, mcp, plugin, auth) never call setup() and would
    // silently drop events on process.exit(). Both inits are idempotent.
    const { initSinks } = await import('./utils/sinks.js');
    initSinks();
    profileCheckpoint('preAction_after_sinks');

    runMigrations();
    profileCheckpoint('preAction_after_migrations');

    profileCheckpoint('preAction_after_settings');

    profileCheckpoint('preAction_after_settings_sync');
  });

  const mainProgram = program
    .name('sophia')
    .description(`Sophia Agent - starts an interactive session by default, use -p/--print for non-interactive output`)
    .argument('[prompt]', 'Your prompt', String)
    // Subcommands inherit helpOption via commander's copyInheritedSettings —
    // setting it once here covers mcp, plugin, auth, and all other subcommands.
    .helpOption('-h, --help', 'Display help for command')
    .option(
      '-d, --debug [filter]',
      'Enable debug mode with optional category filtering (e.g., "api,hooks" or "!1p,!file")',
      (_value: string | true) => {
        // If value is provided, it will be the filter string
        // If not provided but flag is present, value will be true
        // The actual filtering is handled in debug.ts by parsing process.argv
        return true;
      },
    )
    .addOption(new Option('--debug-to-stderr', 'Enable debug mode (to stderr)').argParser(Boolean).hideHelp())
    .option(
      '--debug-file <path>',
      'Write debug logs to a specific file path (implicitly enables debug mode)',
      () => true,
    )
    .option(
      '-p, --print',
      'Print response and exit (useful for pipes). Note: The workspace trust dialog is skipped when Sophia Agent runs with -p. Only use this flag in directories you trust.',
      () => true,
    )
    .addOption(new Option('--init', 'Run Setup hooks with init trigger, then continue').hideHelp())
    .addOption(new Option('--init-only', 'Run Setup and SessionStart:startup hooks, then exit').hideHelp())
    .addOption(new Option('--maintenance', 'Run Setup hooks with maintenance trigger, then continue').hideHelp())
    .addOption(
      new Option(
        '--output-format <format>',
        'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming)',
      ).choices(['text', 'json', 'stream-json']),
    )
    .addOption(
      new Option(
        '--json-schema <schema>',
        'JSON Schema for structured output validation. ' +
          'Example: {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
      ).argParser(String),
    )
    .option(
      '--include-hook-events',
      'Include all hook lifecycle events in the output stream (only works with --output-format=stream-json)',
      () => true,
    )
    .option(
      '--include-partial-messages',
      'Include partial message chunks as they arrive (only works with --print and --output-format=stream-json)',
      () => true,
    )
    .addOption(
      new Option(
        '--input-format <format>',
        'Input format (only works with --print): "text" (default), or "stream-json" (realtime streaming input)',
      ).choices(['text', 'stream-json']),
    )
    .addOption(
      new Option('--thinking <mode>', 'Thinking mode: enabled (equivalent to adaptive), disabled')
        .choices(['enabled', 'adaptive', 'disabled'])
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--max-thinking-tokens <tokens>',
        '[DEPRECATED. Use --thinking instead for newer models] Maximum number of thinking tokens (only works with --print)',
      )
        .argParser(Number)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--max-turns <turns>',
        'Maximum number of agentic turns in non-interactive mode. This will early exit the conversation after the specified number of turns. (only works with --print)',
      )
        .argParser(Number)
        .hideHelp(),
    )
    .addOption(
      new Option('--task-budget <tokens>', 'API-side task budget in tokens (output_config.task_budget)')
        .argParser(value => {
          const tokens = Number(value);
          if (isNaN(tokens) || tokens <= 0 || !Number.isInteger(tokens)) {
            throw new Error('--task-budget must be a positive integer');
          }
          return tokens;
        })
        .hideHelp(),
    )
    .option(
      '--replay-user-messages',
      'Re-emit user messages from stdin back on stdout for acknowledgment (only works with --input-format=stream-json and --output-format=stream-json)',
      () => true,
    )
    .addOption(new Option('--system-prompt <prompt>', 'System prompt to use for the session').argParser(String))
    .addOption(new Option('--system-prompt-file <file>', 'Read system prompt from a file').argParser(String).hideHelp())
    .addOption(
      new Option('--append-system-prompt <prompt>', 'Append a system prompt to the default system prompt').argParser(
        String,
      ),
    )
    .addOption(
      new Option(
        '--append-system-prompt-file <file>',
        'Read system prompt from a file and append to the default system prompt',
      )
        .argParser(String)
        .hideHelp(),
    )
    .option('-c, --continue', 'Continue the most recent conversation in the current directory', () => true)
    .option(
      '-r, --resume [value]',
      'Resume a conversation by session ID, or open interactive picker with optional search term',
      value => value || true,
    )
    .option(
      '--fork-session',
      'When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)',
      () => true,
    )
    .addOption(new Option('--prefill <text>', 'Pre-fill the prompt input with text without submitting it').hideHelp())
    .addOption(new Option('--deep-link-origin', 'Signal that this session was launched from a deep link').hideHelp())
    .addOption(
      new Option(
        '--deep-link-repo <slug>',
        'Repo slug the deep link ?repo= parameter resolved to the current cwd',
      ).hideHelp(),
    )
    .addOption(
      new Option('--deep-link-last-fetch <ms>', 'FETCH_HEAD mtime in epoch ms, precomputed by the deep link trampoline')
        .argParser(v => {
          const n = Number(v);
          return Number.isFinite(n) ? n : undefined;
        })
        .hideHelp(),
    )
    .option(
      '--no-session-persistence',
      'Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)',
    )
    .addOption(
      new Option(
        '--resume-session-at <message id>',
        'When resuming, only messages up to and including the assistant message with <message.id> (use with --resume in print mode)',
      )
        .argParser(String)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--rewind-files <user-message-id>',
        'Restore files to state at the specified user message and exit (requires --resume)',
      ).hideHelp(),
    )
    .addOption(
      new Option('--effort <level>', `Effort level for the current session (low, medium, high, xhigh, max)`).argParser(
        (rawValue: string) => {
          const value = rawValue.toLowerCase();
          const allowed = ['low', 'medium', 'high', 'xhigh', 'max'];
          if (!allowed.includes(value)) {
            throw new InvalidArgumentError(`It must be one of: ${allowed.join(', ')}`);
          }
          return value;
        },
      ),
    )
    .addOption(
      new Option(
        '--workload <tag>',
        'Workload tag for billing-header attribution (cc_workload). Process-scoped; set by SDK daemon callers that spawn subprocesses for cron work. (only works with --print)',
      ).hideHelp(),
    )
    .option('--add-dir <directories...>', 'Additional directories to allow tool access to')
    .option('--session-id <uuid>', 'Use a specific session ID for the conversation (must be a valid UUID)')
    .option('-n, --name <name>', 'Set a display name for this session (shown in /resume and terminal title)');

  mainProgram
    .action(async (prompt, options) => {
      profileCheckpoint('action_handler_start');

      // Log event for any single-word prompt
      if (prompt && typeof prompt === 'string' && !/\s/.test(prompt) && prompt.length > 0) {
        logEvent('tengu_single_word_prompt', { length: prompt.length });
      }

      const {
        debug = false,
        debugToStderr = false,
        addDir = [],
        sessionId,
        includeHookEvents,
        includePartialMessages,
      } = options;
      const allowedTools: string[] = [];

      if (options.prefill) {
        seedEarlyInput(options.prefill);
      }

      // NOTE: LSP manager initialization is intentionally deferred until after
      // the trust dialog is accepted. This prevents plugin LSP servers from
      // executing code in untrusted directories before user consent.

      // Extract these separately so they can be modified if needed
      let outputFormat = options.outputFormat;
      let inputFormat = options.inputFormat;
      let verbose = false;
      let print = options.print;
      const init = options.init ?? false;
      const initOnly = options.initOnly ?? false;
      const maintenance = options.maintenance ?? false;

      // Extract tasks mode options (ant-only)
      const tasksOption = process.env.USER_TYPE === 'ant' && (options as { tasks?: boolean | string }).tasks;
      const taskListId = tasksOption
        ? typeof tasksOption === 'string'
          ? tasksOption
          : DEFAULT_TASKS_MODE_TASK_LIST_ID
        : undefined;
      if (process.env.USER_TYPE === 'ant' && taskListId) {
        process.env.SOPHIA_TASK_LIST_ID = taskListId;
      }

      const worktreeEnabled = false;
      const worktreeName = undefined;
      const worktreePRNumber = undefined;
      const tmuxEnabled = false;

      // Extract teammate options (for tmux-spawned agents)
      // Declared outside the if block so it's accessible later for system prompt addendum
      let storedTeammateOpts: TeammateOptions | undefined;
      if (isAgentSwarmsEnabled()) {
        // Extract agent identity options (for tmux-spawned agents)
        // These replace the SOPHIA_* environment variables
        const teammateOpts = extractTeammateOptions(options);
        storedTeammateOpts = teammateOpts;

        // If any teammate identity option is provided, all three required ones must be present
        const hasAnyTeammateOpt = teammateOpts.agentId || teammateOpts.agentName || teammateOpts.teamName;
        const hasAllRequiredTeammateOpts = teammateOpts.agentId && teammateOpts.agentName && teammateOpts.teamName;

        if (hasAnyTeammateOpt && !hasAllRequiredTeammateOpts) {
          process.stderr.write(
            chalk.red('Error: --agent-id, --agent-name, and --team-name must all be provided together\n'),
          );
          process.exit(1);
        }

        // If teammate identity is provided via CLI, set up dynamicTeamContext
        if (teammateOpts.agentId && teammateOpts.agentName && teammateOpts.teamName) {
          getTeammateUtils().setDynamicTeamContext?.({
            agentId: teammateOpts.agentId,
            agentName: teammateOpts.agentName,
            teamName: teammateOpts.teamName,
            color: teammateOpts.agentColor,
            parentSessionId: teammateOpts.parentSessionId,
          });
        }
      }

      // Extract remote sdk options
      const sdkUrl = (options as { sdkUrl?: string }).sdkUrl ?? undefined;

      // Allow env var to enable partial messages (used by sandbox gateway for baku)
      const effectiveIncludePartialMessages =
        includePartialMessages || isEnvTruthy(process.env.SOPHIA_INCLUDE_PARTIAL_MESSAGES);

      // Enable all hook event types when explicitly requested via SDK option.
      if (includeHookEvents) {
        setAllHookEventsEnabled(true);
      }

      // Auto-set input/output formats, verbose mode, and print mode when SDK URL is provided
      if (sdkUrl) {
        // If SDK URL is provided, automatically use stream-json formats unless explicitly set
        if (!inputFormat) {
          inputFormat = 'stream-json';
        }
        if (!outputFormat) {
          outputFormat = 'stream-json';
        }
        verbose = true;
        // Auto-enable print mode unless explicitly disabled
        if (!options.print) {
          print = true;
        }
      }

      if (outputFormat === 'stream-json') {
        verbose = true;
      }

      // Validate session ID if provided
      if (sessionId) {
        // Check for conflicting flags
        // --session-id can be used with --continue or --resume when --fork-session is also provided
        // (to specify a custom ID for the forked session)
        if ((options.continue || options.resume) && !options.forkSession) {
          process.stderr.write(
            chalk.red(
              'Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.\n',
            ),
          );
          process.exit(1);
        }

        // When --sdk-url is provided (bridge/remote mode), the session ID is a
        // server-assigned tagged ID (e.g. "session_local_01...") rather than a
        // UUID. Skip UUID validation and local existence checks in that case.
        if (!sdkUrl) {
          const validatedSessionId = validateUuid(sessionId);
          if (!validatedSessionId) {
            process.stderr.write(chalk.red('Error: Invalid session ID. Must be a valid UUID.\n'));
            process.exit(1);
          }

          // Check if session ID already exists
          if (sessionIdExists(validatedSessionId)) {
            process.stderr.write(chalk.red(`Error: Session ID ${validatedSessionId} is already in use.\n`));
            process.exit(1);
          }
        }
      }

      // Get isNonInteractiveSession from state (was set before init())
      const isNonInteractiveSession = getIsNonInteractiveSession();

      // Handle system prompt options
      let systemPrompt = options.systemPrompt;
      if (options.systemPromptFile) {
        if (options.systemPrompt) {
          process.stderr.write(
            chalk.red('Error: Cannot use both --system-prompt and --system-prompt-file. Please use only one.\n'),
          );
          process.exit(1);
        }

        try {
          const filePath = resolve(options.systemPromptFile);
          systemPrompt = readFileSync(filePath, 'utf8');
        } catch (error) {
          const code = getErrnoCode(error);
          if (code === 'ENOENT') {
            process.stderr.write(
              chalk.red(`Error: System prompt file not found: ${resolve(options.systemPromptFile)}\n`),
            );
            process.exit(1);
          }
          process.stderr.write(chalk.red(`Error reading system prompt file: ${errorMessage(error)}\n`));
          process.exit(1);
        }
      }

      // Handle append system prompt options
      let appendSystemPrompt = options.appendSystemPrompt;
      if (options.appendSystemPromptFile) {
        if (options.appendSystemPrompt) {
          process.stderr.write(
            chalk.red(
              'Error: Cannot use both --append-system-prompt and --append-system-prompt-file. Please use only one.\n',
            ),
          );
          process.exit(1);
        }

        try {
          const filePath = resolve(options.appendSystemPromptFile);
          appendSystemPrompt = readFileSync(filePath, 'utf8');
        } catch (error) {
          const code = getErrnoCode(error);
          if (code === 'ENOENT') {
            process.stderr.write(
              chalk.red(`Error: Append system prompt file not found: ${resolve(options.appendSystemPromptFile)}\n`),
            );
            process.exit(1);
          }
          process.stderr.write(chalk.red(`Error reading append system prompt file: ${errorMessage(error)}\n`));
          process.exit(1);
        }
      }

      // Add teammate-specific system prompt addendum for tmux teammates
      if (
        isAgentSwarmsEnabled() &&
        storedTeammateOpts?.agentId &&
        storedTeammateOpts?.agentName &&
        storedTeammateOpts?.teamName
      ) {
        const addendum = getTeammatePromptAddendum().TEAMMATE_SYSTEM_PROMPT_ADDENDUM;
        appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${addendum}` : addendum;
      }

      const dynamicMcpConfig: Record<string, ScopedMcpServerConfig> = {};
      const strictMcpConfig = false;

      // Store additional directories for SOPHIA.md loading (controlled by env var)
      setAdditionalDirectoriesForClaudeMd(addDir);

      // This await replaces blocking existsSync/statSync calls that were already in
      // the startup path. Wall-clock time is unchanged; we just yield to the event
      // loop during the fs I/O instead of blocking it. See #19661.
      const initResult = await initializeToolSafetyContext({
        baseToolsCli: [],
        addDirs: addDir,
      });
      let toolSafetyContext = initResult.toolSafetyContext;
      const { warnings } = initResult;

      // Print any warnings from initialization
      warnings.forEach(warning => {
        console.error(warning);
      });

      // Kick off MCP config loading early (safe - just reads files, no execution).
      // Both interactive and -p use getClaudeCodeMcpConfigs (local file reads only).
      // The local promise is awaited later (before prefetchAllMcpResources) to
      // overlap config I/O with setup(), commands loading, and trust dialog.
      logForDebugging('[STARTUP] Loading MCP configs...');
      const mcpConfigStart = Date.now();
      let mcpConfigResolvedMs: number | undefined;
      // --bare skips auto-discovered MCP (.mcp.json, user settings, plugins) —
      // only explicit --mcp-config works. dynamicMcpConfig is spread onto
      // allMcpConfigs downstream so it survives this skip.
      const mcpConfigPromise = (
        strictMcpConfig || isBareMode()
          ? Promise.resolve({
              servers: {} as Record<string, ScopedMcpServerConfig>,
            })
          : getClaudeCodeMcpConfigs(dynamicMcpConfig)
      ).then(result => {
        mcpConfigResolvedMs = Date.now() - mcpConfigStart;
        return result;
      });

      // NOTE: We do NOT call prefetchAllMcpResources here - that's deferred until after trust dialog

      if (inputFormat && inputFormat !== 'text' && inputFormat !== 'stream-json') {
        console.error(`Error: Invalid input format "${inputFormat}".`);
        process.exit(1);
      }
      if (inputFormat === 'stream-json' && outputFormat !== 'stream-json') {
        console.error(`Error: --input-format=stream-json requires output-format=stream-json.`);
        process.exit(1);
      }

      // Validate sdkUrl is only used with appropriate formats (formats are auto-set above)
      if (sdkUrl) {
        if (inputFormat !== 'stream-json' || outputFormat !== 'stream-json') {
          console.error(`Error: --sdk-url requires both --input-format=stream-json and --output-format=stream-json.`);
          process.exit(1);
        }
      }

      // Validate replayUserMessages is only used with stream-json formats
      if (options.replayUserMessages) {
        if (inputFormat !== 'stream-json' || outputFormat !== 'stream-json') {
          console.error(
            `Error: --replay-user-messages requires both --input-format=stream-json and --output-format=stream-json.`,
          );
          process.exit(1);
        }
      }

      // Validate includePartialMessages is only used with print mode and stream-json output
      if (effectiveIncludePartialMessages) {
        if (!isNonInteractiveSession || outputFormat !== 'stream-json') {
          writeToStderr(`Error: --include-partial-messages requires --print and --output-format=stream-json.`);
          process.exit(1);
        }
      }

      // Validate --no-session-persistence is only used with print mode
      if (options.sessionPersistence === false && !isNonInteractiveSession) {
        writeToStderr(`Error: --no-session-persistence can only be used with --print mode.`);
        process.exit(1);
      }

      const effectivePrompt = prompt || '';
      let inputPrompt = await getInputPrompt(effectivePrompt, (inputFormat ?? 'text') as 'text' | 'stream-json');
      profileCheckpoint('action_after_input_prompt');

      let tools = getTools(toolSafetyContext);

      profileCheckpoint('action_tools_loaded');

      let jsonSchema: ToolInputJSONSchema | undefined;
      if (isSyntheticOutputToolEnabled({ isNonInteractiveSession }) && options.jsonSchema) {
        jsonSchema = jsonParse(options.jsonSchema) as ToolInputJSONSchema;
      }

      if (jsonSchema) {
        const syntheticOutputResult = createSyntheticOutputTool(jsonSchema);
        if ('tool' in syntheticOutputResult) {
          // Add SyntheticOutputTool to the tools array AFTER getTools() filtering.
          // This tool is excluded from normal filtering (see tools.ts) because it's
          // an implementation detail for structured output, not a user-controlled tool.
          tools = [...tools, syntheticOutputResult.tool];

          logEvent('tengu_structured_output_enabled', {
            schema_property_count: Object.keys((jsonSchema.properties as Record<string, unknown>) || {})
              .length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            has_required_fields: Boolean(
              jsonSchema.required,
            ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        } else {
          logEvent('tengu_structured_output_failure', {
            error: 'Invalid JSON schema' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
        }
      }

      // IMPORTANT: setup() must be called before any other code that depends on the cwd or worktree setup
      profileCheckpoint('action_before_setup');
      logForDebugging('[STARTUP] Running setup()...');
      const setupStart = Date.now();
      const { setup } = await import('./setup.js');
      const messagingSocketPath = feature('UDS_INBOX')
        ? (options as { messagingSocketPath?: string }).messagingSocketPath
        : undefined;
      // Parallelize setup() with commands+agents loading. setup()'s ~28ms is
      // mostly startUdsMessaging (socket bind, ~20ms) — not disk-bound, so it
      // doesn't contend with getCommands' file reads. Gated on !worktreeEnabled
      // since --worktree makes setup() process.chdir() (setup.ts:203), and
      // commands/agents need the post-chdir cwd.
      const preSetupCwd = getCwd();
      // Register bundled skills/plugins before kicking getCommands() — they're
      // pure in-memory array pushes (<1ms, zero I/O) that getBundledSkills()
      // reads synchronously. Previously ran inside setup() after ~20ms of
      // await points, so the parallel getCommands() memoized an empty list.
      if (process.env.SOPHIA_ENTRYPOINT !== 'local-agent') {
        initBuiltinPlugins();
        initBundledSkills();
      }
      const setupPromise = setup(
        preSetupCwd,
        worktreeEnabled,
        worktreeName,
        tmuxEnabled,
        sessionId ? validateUuid(sessionId) : undefined,
        worktreePRNumber,
        messagingSocketPath,
      );
      const commandsPromise = worktreeEnabled ? null : getCommands(preSetupCwd);
      const agentDefsPromise = worktreeEnabled ? null : getAgentDefinitionsWithOverrides(preSetupCwd);
      // Suppress transient unhandledRejection if these reject during the
      // ~28ms setupPromise await before Promise.all joins them below.
      commandsPromise?.catch(() => {});
      agentDefsPromise?.catch(() => {});
      await setupPromise;
      logForDebugging(`[STARTUP] setup() completed in ${Date.now() - setupStart}ms`);
      profileCheckpoint('action_after_setup');

      // Replay user messages into stream-json only when the socket was
      // explicitly requested. The auto-generated socket is passive — it
      // lets tools inject if they want to, but turning it on by default
      // shouldn't reshape stream-json for SDK consumers who never touch it.
      // Callers who inject and also want those injections visible in the
      // stream pass --messaging-socket-path explicitly (or --replay-user-messages).
      let effectiveReplayUserMessages = !!options.replayUserMessages;
      if (feature('UDS_INBOX')) {
        if (!effectiveReplayUserMessages && outputFormat === 'stream-json') {
          effectiveReplayUserMessages = !!(options as { messagingSocketPath?: string }).messagingSocketPath;
        }
      }

      if (getIsNonInteractiveSession()) {
        // Apply full merged settings env now (including project-scoped
        // .sophia/settings.json PATH/GIT_DIR/GIT_WORK_TREE) so gitExe() and
        // the git spawn below see it. Trust is implicit in -p mode; the
        // docstring at managedEnv.ts:96-97 says this applies "potentially
        // dangerous environment variables such as LD_PRELOAD, PATH" from all
        // sources. The later call in the isNonInteractiveSession block below
        // is idempotent (Object.assign, configureGlobalAgents ejects prior
        // interceptor) and picks up any plugin-contributed env after plugin
        // init. Project settings are already loaded here:
        // applySafeConfigEnvironmentVariables in init() called
        // getSettings_DEPRECATED at managedEnv.ts:86 which merges all enabled
        // sources including projectSettings/localSettings.
        applyConfigEnvironmentVariables();

        // Spawn git status/log/branch now so the subprocess execution overlaps
        // with the getCommands await below and startDeferredPrefetches. After
        // setup() so cwd is final (setup.ts:254 may process.chdir(worktreePath)
        // for --worktree) and after the applyConfigEnvironmentVariables above
        // so PATH/GIT_DIR/GIT_WORK_TREE from all sources (trusted + project)
        // are applied. getSystemContext is memoized; the
        // prefetchSystemContextIfSafe call in startDeferredPrefetches becomes
        // a cache hit. The microtask from await getIsGit() drains at the
        // getCommands Promise.all await below. Trust is implicit in -p mode
        // (same gate as prefetchSystemContextIfSafe).
        void getSystemContext();
        // Kick getUserContext now too — its first await (fs.readFile in
        // getMemoryFiles) yields naturally, so the SOPHIA.md directory walk
        // runs during the ~280ms overlap window before the context
        // Promise.all join in print.ts. The void getUserContext() in
        // startDeferredPrefetches becomes a memoize cache-hit.
        void getUserContext();
      }

      // Apply --name: cache-only so no orphan file is created before the
      // session ID is finalized by --continue/--resume. materializeSessionFile
      // persists it on the first user message; REPL's useTerminalTitle reads it
      // via getCurrentSessionTitle.
      const sessionNameArg = options.name?.trim();
      if (sessionNameArg) {
        cacheSessionTitle(sessionNameArg);
      }

      // Reuse preSetupCwd unless setup() chdir'd (worktreeEnabled). Saves a
      // getCwd() syscall in the common path.
      const currentCwd = worktreeEnabled ? getCwd() : preSetupCwd;
      logForDebugging('[STARTUP] Loading commands and agents...');
      const commandsStart = Date.now();
      // Join the promises kicked before setup() (or start fresh if
      // worktreeEnabled gated the early kick). Both memoized by cwd.
      const [commands, agentDefinitionsResult] = await Promise.all([
        commandsPromise ?? getCommands(currentCwd),
        agentDefsPromise ?? getAgentDefinitionsWithOverrides(currentCwd),
      ]);
      logForDebugging(`[STARTUP] Commands and agents loaded in ${Date.now() - commandsStart}ms`);
      profileCheckpoint('action_commands_loaded');

      const agentDefinitions = agentDefinitionsResult;

      // Look up the optional main-thread agent from persisted settings.
      const agentSetting = getInitialSettings().agent;
      let mainThreadAgentDefinition: (typeof agentDefinitions.activeAgents)[number] | undefined;
      if (agentSetting) {
        mainThreadAgentDefinition = agentDefinitions.activeAgents.find(agent => agent.agentType === agentSetting);
        if (!mainThreadAgentDefinition) {
          logForDebugging(
            `Warning: agent "${agentSetting}" not found. ` +
              `Available agents: ${agentDefinitions.activeAgents.map(a => a.agentType).join(', ')}. ` +
              `Using default behavior.`,
          );
        }
      }

      // Store the main thread agent type in bootstrap state so hooks can access it
      setMainThreadAgentType(mainThreadAgentDefinition?.agentType);

      // Log agent flag usage — only log agent name for built-in agents to avoid leaking custom agent names
      if (mainThreadAgentDefinition) {
        logEvent('tengu_agent_flag', {
          agentType: isBuiltInAgent(mainThreadAgentDefinition)
            ? (mainThreadAgentDefinition.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
            : ('custom' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
        });
      }

      // Persist agent setting to session transcript for resume view display and restoration
      if (mainThreadAgentDefinition?.agentType) {
        saveAgentSetting(mainThreadAgentDefinition.agentType);
      }

      // Apply the agent's system prompt for non-interactive sessions
      // (interactive mode uses buildEffectiveSystemPrompt instead)
      if (
        isNonInteractiveSession &&
        mainThreadAgentDefinition &&
        !systemPrompt &&
        !isBuiltInAgent(mainThreadAgentDefinition)
      ) {
        const agentSystemPrompt = mainThreadAgentDefinition.getSystemPrompt();
        if (agentSystemPrompt) {
          systemPrompt = agentSystemPrompt;
        }
      }

      // initialPrompt goes first so its slash command (if any) is processed;
      // user-provided text becomes trailing context.
      // Only concatenate when inputPrompt is a string. When it's an
      // AsyncIterable (SDK stream-json mode), template interpolation would
      // call .toString() producing "[object Object]". The AsyncIterable case
      // is handled in print.ts via structuredIO.prependUserMessage().
      if (mainThreadAgentDefinition?.initialPrompt) {
        if (typeof inputPrompt === 'string') {
          inputPrompt = inputPrompt
            ? `${mainThreadAgentDefinition.initialPrompt}\n\n${inputPrompt}`
            : mainThreadAgentDefinition.initialPrompt;
        } else if (!inputPrompt) {
          inputPrompt = mainThreadAgentDefinition.initialPrompt;
        }
      }

      // Model and provider defaults come from the persisted agent routes.
      const effectiveModel: undefined = undefined;
      const initialMainLoopModel = getConfiguredProviderModel();
      setInitialMainLoopModel(initialMainLoopModel);
      const resolvedInitialModel = initialMainLoopModel;

      let advisorModel: string | undefined;
      if (isAdvisorEnabled()) {
        const advisorOption = canUserConfigureAdvisor() ? (options as { advisor?: string }).advisor : undefined;
        if (advisorOption) {
          logForDebugging(`[AdvisorTool] --advisor ${advisorOption}`);
          if (!modelSupportsAdvisor(resolvedInitialModel)) {
            process.stderr.write(
              chalk.red(`Error: The model "${resolvedInitialModel}" does not support the advisor tool.\n`),
            );
            process.exit(1);
          }
          const normalizedAdvisorModel = normalizeModelStringForAPI(parseUserSpecifiedModel(advisorOption));
          if (!isValidAdvisorModel(normalizedAdvisorModel)) {
            process.stderr.write(chalk.red(`Error: The model "${advisorOption}" cannot be used as an advisor.\n`));
            process.exit(1);
          }
        }
        advisorModel = canUserConfigureAdvisor() ? (advisorOption ?? getInitialAdvisorSetting()) : advisorOption;
        if (advisorModel) {
          logForDebugging(`[AdvisorTool] Advisor model: ${advisorModel}`);
        }
      }

      // For tmux teammates with --agent-type, append the custom agent's prompt
      if (
        isAgentSwarmsEnabled() &&
        storedTeammateOpts?.agentId &&
        storedTeammateOpts?.agentName &&
        storedTeammateOpts?.teamName &&
        storedTeammateOpts?.agentType
      ) {
        // Look up the custom agent definition
        const customAgent = agentDefinitions.activeAgents.find(a => a.agentType === storedTeammateOpts.agentType);
        if (customAgent) {
          // Get the prompt - need to handle both built-in and custom agents
          let customPrompt: string | undefined;
          if (customAgent.source === 'built-in') {
            // Built-in agents have getSystemPrompt that takes toolUseContext
            // We can't access full toolUseContext here, so skip for now
            logForDebugging(
              `[teammate] Built-in agent ${storedTeammateOpts.agentType} - skipping custom prompt (not supported)`,
            );
          } else {
            // Custom agents have getSystemPrompt that takes no args
            customPrompt = customAgent.getSystemPrompt();
          }

          // Log agent memory loaded event for tmux teammates
          if (customAgent.memory) {
            logEvent('tengu_agent_memory_loaded', {
              ...(process.env.USER_TYPE === 'ant' && {
                agent_type: customAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }),
              scope: customAgent.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              source: 'teammate' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            });
          }

          if (customPrompt) {
            const customInstructions = `\n# Custom Agent Instructions\n${customPrompt}`;
            appendSystemPrompt = appendSystemPrompt
              ? `${appendSystemPrompt}\n\n${customInstructions}`
              : customInstructions;
          }
        } else {
          logForDebugging(`[teammate] Custom agent ${storedTeammateOpts.agentType} not found in available agents`);
        }
      }

      // Ink root is only needed for interactive sessions — patchConsole in the
      // Ink constructor would swallow console output in headless mode.
      let root!: Root;
      let getFpsMetrics!: () => FpsMetrics | undefined;
      let stats!: StatsStore;

      // Show setup screens after commands are loaded
      if (!isNonInteractiveSession) {
        const ctx = getRenderContext(false);
        getFpsMetrics = ctx.getFpsMetrics;
        stats = ctx.stats;
        // Install asciicast recorder before Ink mounts (ant-only, opt-in via SOPHIA_TERMINAL_RECORDING=1)
        if (process.env.USER_TYPE === 'ant') {
          installAsciicastRecorder();
        }

        const { createRoot } = await import('@anthropic/ink');
        root = await createRoot(ctx.renderOptions);

        // Log startup time now, before any blocking dialog renders. Logging
        // from REPL's first render (the old location) included however long
        // the user sat on trust/OAuth/onboarding/resume-picker — p99 was ~70s
        // dominated by dialog-wait time, not code-path startup.
        logEvent('tengu_timer', {
          event: 'startup' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs: Math.round(process.uptime() * 1000),
        });

        logForDebugging('[STARTUP] Running showSetupScreens()...');
        const setupScreensStart = Date.now();
        const onboardingShown = await showSetupScreens(root, commands);
        logForDebugging(`[STARTUP] showSetupScreens() completed in ${Date.now() - setupScreensStart}ms`);

        // Now that trust is established and GrowthBook has auth headers,
        // Check for pending agent memory snapshot updates (only for --agent mode, ant-only)
        if (
          feature('AGENT_MEMORY_SNAPSHOT') &&
          mainThreadAgentDefinition &&
          isCustomAgent(mainThreadAgentDefinition) &&
          mainThreadAgentDefinition.memory &&
          mainThreadAgentDefinition.pendingSnapshotUpdate
        ) {
          const agentDef = mainThreadAgentDefinition;
          const choice = await launchSnapshotUpdateDialog(root, {
            agentType: agentDef.agentType,
            scope: agentDef.memory!,
            snapshotTimestamp: agentDef.pendingSnapshotUpdate!.snapshotTimestamp,
          });
          if (choice === 'merge') {
            const { buildMergePrompt } = await import('./components/agents/SnapshotUpdateDialog.js');
            const mergePrompt = buildMergePrompt(agentDef.agentType, agentDef.memory!);
            inputPrompt = inputPrompt ? `${mergePrompt}\n\n${inputPrompt}` : mergePrompt;
          }
          agentDef.pendingSnapshotUpdate = undefined;
        }

        // Do not immediately reopen the Provider dialog completed by onboarding.
        if (onboardingShown && prompt?.trim().toLowerCase() === '/model') {
          prompt = '';
        }
      }

      // If gracefulShutdown was initiated (e.g., user rejected trust dialog),
      // process.exitCode will be set. Skip all subsequent operations that could
      // trigger code execution before the process exits (e.g. we don't want apiKeyHelper
      // to run if trust was not established).
      if (process.exitCode !== undefined) {
        logForDebugging('Graceful shutdown initiated, skipping further initialization');
        return;
      }

      // Initialize LSP manager AFTER trust is established (or in non-interactive mode
      // where trust is implicit). This prevents plugin LSP servers from executing
      // code in untrusted directories before user consent.
      // Must be after inline plugins are set (if any) so --plugin-dir LSP servers are included.
      initializeLspServerManager();

      // Show settings validation errors after trust is established
      // MCP config errors don't block settings from loading, so exclude them
      if (!isNonInteractiveSession) {
        const { errors } = getSettingsWithErrors();
        const nonMcpErrors = errors.filter(e => !e.mcpErrorMetadata);
        if (nonMcpErrors.length > 0) {
          await launchInvalidSettingsDialog(root, {
            settingsErrors: nonMcpErrors,
            onExit: () => gracefulShutdownSync(1),
          });
        }
      }

      if (!isNonInteractiveSession) {
        void refreshExampleCommands(); // Pre-fetch example commands (runs git log, no API call)
      }

      // Resolve MCP configs (started early, overlaps with setup/trust dialog work)
      const { servers: existingMcpConfigs } = await mcpConfigPromise;
      logForDebugging(
        `[STARTUP] MCP configs resolved in ${mcpConfigResolvedMs}ms (awaited at +${Date.now() - mcpConfigStart}ms)`,
      );
      // CLI flag (--mcp-config) should override file-based configs, matching settings precedence
      const allMcpConfigs = {
        ...existingMcpConfigs,
        ...dynamicMcpConfig,
      };

      // Separate SDK configs from regular MCP configs
      const sdkMcpConfigs: Record<string, McpSdkServerConfig> = {};
      const regularMcpConfigs: Record<string, ScopedMcpServerConfig> = {};

      for (const [name, config] of Object.entries(allMcpConfigs)) {
        const typedConfig = config as ScopedMcpServerConfig | McpSdkServerConfig;
        if (typedConfig.type === 'sdk') {
          sdkMcpConfigs[name] = typedConfig as McpSdkServerConfig;
        } else {
          regularMcpConfigs[name] = typedConfig as ScopedMcpServerConfig;
        }
      }

      profileCheckpoint('action_mcp_configs_loaded');

      // Prefetch MCP resources after trust dialog (this is where execution happens).
      // Interactive mode only: print mode defers connects until headlessStore exists
      // and pushes per-server (below), so one slow server doesn't block the batch.
      const mcpPromise = isNonInteractiveSession
        ? Promise.resolve({ clients: [], tools: [], commands: [] })
        : prefetchAllMcpResources(regularMcpConfigs);

      // Start hooks early so they run in parallel with MCP connections.
      // Skip for initOnly/init/maintenance (handled separately), non-interactive
      // (handled via setupTrigger), and resume/continue (conversationRecovery.ts
      // fires 'resume' instead — without this guard, hooks fire TWICE on /resume
      // and the second systemMessage clobbers the first. gh-30825)
      const hooksPromise =
        initOnly || init || maintenance || isNonInteractiveSession || options.continue || options.resume
          ? null
          : processSessionStartHooks('startup', {
              agentType: mainThreadAgentDefinition?.agentType,
              model: resolvedInitialModel,
            });

      // MCP never blocks REPL render OR turn 1 TTFT. useManageMCPConnections
      // populates appState.mcp async as servers connect (connectToServer is
      // memoized — the prefetch calls above and the hook converge on the same
      // connections). getToolUseContext reads store.getState() fresh via
      // computeTools(), so turn 1 sees whatever's connected by query time.
      // Slow servers populate for turn 2+. Matches interactive-no-prompt
      // behavior. Print mode: per-server push into headlessStore (below).
      const hookMessages: Awaited<NonNullable<typeof hooksPromise>> = [];
      // Suppress transient unhandledRejection — the prefetch warms the
      // memoized connectToServer cache but nobody awaits it in interactive.
      mcpPromise.catch(() => {});

      const mcpClients: Awaited<typeof mcpPromise>['clients'] = [];
      const mcpTools: Awaited<typeof mcpPromise>['tools'] = [];
      const mcpCommands: Awaited<typeof mcpPromise>['commands'] = [];

      let thinkingEnabled = shouldEnableThinkingByDefault();
      let thinkingConfig: ThinkingConfig = thinkingEnabled !== false ? { type: 'adaptive' } : { type: 'disabled' };

      if (options.thinking === 'adaptive' || options.thinking === 'enabled') {
        thinkingEnabled = true;
        thinkingConfig = { type: 'adaptive' };
      } else if (options.thinking === 'disabled') {
        thinkingEnabled = false;
        thinkingConfig = { type: 'disabled' };
      } else {
        const maxThinkingTokens = process.env.MAX_THINKING_TOKENS
          ? parseInt(process.env.MAX_THINKING_TOKENS, 10)
          : options.maxThinkingTokens;
        if (maxThinkingTokens !== undefined) {
          if (maxThinkingTokens > 0) {
            thinkingEnabled = true;
            thinkingConfig = {
              type: 'enabled',
              budgetTokens: maxThinkingTokens,
            };
          } else if (maxThinkingTokens === 0) {
            thinkingEnabled = false;
            thinkingConfig = { type: 'disabled' };
          }
        }
      }

      logForDiagnosticsNoPII('info', 'started', {
        version: MACRO.VERSION,
        is_native_binary: isInBundledMode(),
      });

      registerCleanup(async () => {
        logForDiagnosticsNoPII('info', 'exited');
      });

      void logTenguInit({
        hasInitialPrompt: Boolean(prompt),
        hasStdin: Boolean(inputPrompt),
        verbose,
        debug,
        debugToStderr,
        print: print ?? false,
        outputFormat: outputFormat ?? 'text',
        inputFormat: inputFormat ?? 'text',
        numAllowedTools: allowedTools.length,
        mcpClientCount: Object.keys(allMcpConfigs).length,
        worktreeEnabled,
        skipWebFetchPreflight: getInitialSettings().skipWebFetchPreflight,
        githubActionInputs: process.env.GITHUB_ACTION_INPUTS,
        systemPromptFlag: systemPrompt ? (options.systemPromptFile ? 'file' : 'flag') : undefined,
        appendSystemPromptFlag: appendSystemPrompt ? (options.appendSystemPromptFile ? 'file' : 'flag') : undefined,
        thinkingConfig,
      });

      // Log context metrics once at initialization
      void logContextMetrics(regularMcpConfigs, toolSafetyContext);

      void logPermissionContextForAnts(null, 'initialization');

      logManagedSettings();

      // Register PID file for concurrent-session detection (~/.sophia/sessions/)
      // and fire multi-clauding telemetry. Lives here (not init.ts) so only the
      // REPL path registers — not subcommands like `sophia doctor`. Chained:
      // count must run after register's write completes or it misses our own file.
      void registerSession().then(registered => {
        if (!registered) return;
        if (sessionNameArg) {
          void updateSessionName(sessionNameArg);
        }
        void countConcurrentSessions().then(count => {
          if (count >= 2) {
            logEvent('tengu_concurrent_sessions', {
              num_sessions: count,
            });
          }
        });
      });

      // Initialize versioned plugins system (triggers V1→V2 migration if
      // needed). Then run orphan GC, THEN warm the Grep/Glob exclusion cache.
      // Sequencing matters: the warmup scans disk for .orphaned_at markers,
      // so it must see the GC's Pass 1 (remove markers from reinstalled
      // versions) and Pass 2 (stamp unmarked orphans) already applied. The
      // warm also lands before autoupdate (fires on first submit in REPL)
      // can orphan this session's active version underneath us.
      // --bare / SIMPLE: skip plugin version sync + orphan cleanup. These
      // are install/upgrade bookkeeping that scripted calls don't need —
      // the next interactive session will reconcile. The await here was
      // blocking -p on a marketplace round-trip.
      if (isBareMode()) {
        // skip — no-op
      } else if (isNonInteractiveSession) {
        // In headless mode, await to ensure plugin sync completes before CLI exits
        await initializeVersionedPlugins();
        profileCheckpoint('action_after_plugins_init');
        void cleanupOrphanedPluginVersionsInBackground().then(() => getGlobExclusionsForPluginCache());
      } else {
        // In interactive mode, fire-and-forget — this is purely bookkeeping
        // that doesn't affect runtime behavior of the current session
        void initializeVersionedPlugins().then(async () => {
          profileCheckpoint('action_after_plugins_init');
          await cleanupOrphanedPluginVersionsInBackground();
          void getGlobExclusionsForPluginCache();
        });
      }

      const setupTrigger = initOnly || init ? 'init' : maintenance ? 'maintenance' : null;
      if (initOnly) {
        applyConfigEnvironmentVariables();
        await processSetupHooks('init', { forceSyncExecution: true });
        await processSessionStartHooks('startup', {
          forceSyncExecution: true,
        });
        gracefulShutdownSync(0);
        return;
      }

      // --print mode
      if (isNonInteractiveSession) {
        if (outputFormat === 'stream-json' || outputFormat === 'json') {
          setHasFormattedOutput(true);
        }

        // Apply full environment variables in print mode since trust dialog is bypassed
        // This includes potentially dangerous environment variables from untrusted sources
        // but print mode is considered trusted (as documented in help text)
        applyConfigEnvironmentVariables();

        // Initialize telemetry after env vars are applied so OTEL endpoint env vars and
        // otelHeadersHelper (which requires trust to execute) are available.
        initializeTelemetryAfterTrust();

        // Kick SessionStart hooks now so the subprocess spawn overlaps with
        // MCP connect + plugin init + print.ts import below. loadInitialMessages
        // joins this at print.ts:4397. Guarded same as loadInitialMessages —
        // continue/resume paths don't fire startup hooks (or fire them
        // conditionally inside the resume branch, where this promise is
        // undefined and the ?? fallback runs). Also skip when setupTrigger is
        // set — those paths run setup hooks first (print.ts:544), and session
        // start hooks must wait until setup completes.
        const sessionStartHooksPromise =
          options.continue || options.resume || setupTrigger ? undefined : processSessionStartHooks('startup');
        // Suppress transient unhandledRejection if this rejects before
        // loadInitialMessages awaits it. Downstream await still observes the
        // rejection — this just prevents the spurious global handler fire.
        sessionStartHooksPromise?.catch(() => {});

        const commandsHeadless = commands.filter(
          command =>
            (command.type === 'prompt' && !command.disableNonInteractive) ||
            (command.type === 'local' && command.supportsNonInteractive),
        );

        const defaultState = getDefaultAppState();
        const headlessInitialState: AppState = {
          ...defaultState,
          mcp: {
            ...defaultState.mcp,
            clients: mcpClients,
            commands: mcpCommands,
            tools: mcpTools,
          },
          toolSafetyContext,
          effortValue: parseEffortValue(options.effort) ?? getInitialEffortSetting(),
          ...(isAdvisorEnabled() && advisorModel && { advisorModel }),
        };

        // Init app state
        const headlessStore = createStore(headlessInitialState, onChangeAppState);

        // Set global state for session persistence
        if (options.sessionPersistence === false) {
          setSessionPersistenceDisabled(true);
        }

        // Print-mode MCP: per-server incremental push into headlessStore.
        // Push pending first, then replace with connected/failed as each server settles.
        const connectMcpBatch = (configs: Record<string, ScopedMcpServerConfig>, label: string): Promise<void> => {
          if (Object.keys(configs).length === 0) return Promise.resolve();
          headlessStore.setState(prev => ({
            ...prev,
            mcp: {
              ...prev.mcp,
              clients: [
                ...prev.mcp.clients,
                ...Object.entries(configs).map(([name, config]) => ({
                  name,
                  type: 'pending' as const,
                  config,
                })),
              ],
            },
          }));
          return getMcpToolsCommandsAndResources(({ client, tools, commands }) => {
            headlessStore.setState(prev => ({
              ...prev,
              mcp: {
                ...prev.mcp,
                clients: prev.mcp.clients.some(c => c.name === client.name)
                  ? prev.mcp.clients.map(c => (c.name === client.name ? client : c))
                  : [...prev.mcp.clients, client],
                tools: uniqBy([...prev.mcp.tools, ...tools], 'name'),
                commands: uniqBy([...prev.mcp.commands, ...commands], 'name'),
              },
            }));
          }, configs).catch(err => logForDebugging(`[MCP] ${label} connect error: ${err}`));
        };
        // Await all MCP configs — print mode is often single-turn, so
        // "late-connecting servers visible next turn" doesn't help. SDK init
        // message and turn-1 tool list both need configured MCP tools present.
        // Zero-server case is free via the early return in connectMcpBatch.
        // Connectors parallelize inside getMcpToolsCommandsAndResources
        // Connections are parallelized inside getMcpToolsCommandsAndResources.
        profileCheckpoint('before_connectMcp');
        await connectMcpBatch(regularMcpConfigs, 'regular');
        profileCheckpoint('after_connectMcp');
        // In headless mode, start deferred prefetches immediately (no user typing delay)
        // --bare / SIMPLE: startDeferredPrefetches early-returns internally.
        // backgroundHousekeeping (initExtractMemories, pruneShellSnapshots,
        // cleanupOldMessageFiles) and sdkHeapDumpMonitor are all bookkeeping
        // that scripted calls don't need — the next interactive session reconciles.
        if (!isBareMode()) {
          startDeferredPrefetches();
          void import('./utils/backgroundHousekeeping.js').then(m => m.startBackgroundHousekeeping());
          if (process.env.USER_TYPE === 'ant') {
            void import('./utils/sdkHeapDumpMonitor.js').then(m => m.startSdkMemoryMonitor());
          }
        }

        logSessionTelemetry();
        profileCheckpoint('before_print_import');
        const { runHeadless } = await import('src/cli/print.js');
        profileCheckpoint('after_print_import');
        await runHeadless(
          inputPrompt,
          () => headlessStore.getState(),
          headlessStore.setState,
          commandsHeadless,
          tools,
          sdkMcpConfigs,
          agentDefinitions.activeAgents,
          {
            continue: options.continue,
            resume: options.resume,
            verbose: verbose,
            outputFormat: outputFormat,
            jsonSchema,
            allowedTools,
            thinkingConfig,
            maxTurns: options.maxTurns,
            taskBudget: options.taskBudget ? { total: options.taskBudget } : undefined,
            systemPrompt,
            appendSystemPrompt,
            userSpecifiedModel: effectiveModel,
            sdkUrl,
            replayUserMessages: effectiveReplayUserMessages,
            includePartialMessages: effectiveIncludePartialMessages,
            forkSession: options.forkSession || false,
            resumeSessionAt: options.resumeSessionAt || undefined,
            rewindFiles: options.rewindFiles,
            workload: options.workload,
            setupTrigger: setupTrigger ?? undefined,
            sessionStartHooksPromise,
          },
        );
        return;
      }

      const initialNotifications: never[] = [];
      const initialState: AppState = {
        settings: getInitialSettings(),
        tasks: {},
        agentNameRegistry: new Map(),
        verbose: verbose ?? false,
        mainLoopModel: initialMainLoopModel,
        mainLoopModelForSession: null,
        expandedView: getGlobalConfig().showSpinnerTree
          ? 'teammates'
          : getGlobalConfig().showExpandedTodos
            ? 'tasks'
            : 'none',
        showTeammateMessagePreview: isAgentSwarmsEnabled() ? false : undefined,
        selectedIPAgentIndex: -1,
        selectedBgAgentIndex: -1,
        agentTaskIndex: -1,
        viewSelectionMode: 'none',
        footerSelection: null,
        toolSafetyContext,
        agent: mainThreadAgentDefinition?.agentType,
        agentDefinitions,
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
        statusLineText: undefined,
        notifications: {
          current: null,
          queue: initialNotifications,
        },
        elicitation: {
          queue: [],
        },
        todos: {},
        fileHistory: {
          snapshots: [],
          trackedFiles: new Set(),
          snapshotSequence: 0,
        },
        attribution: createEmptyAttributionState(),
        thinkingEnabled,
        sessionHooks: new Map(),
        inbox: {
          messages: [],
        },
        workerSandboxPermissions: {
          queue: [],
          selectedIndex: 0,
        },
        pendingSandboxRequest: null,
        initialMessage: inputPrompt
          ? {
              message: createUserMessage({
                content: String(inputPrompt),
              }),
            }
          : null,
        effortValue: parseEffortValue(options.effort) ?? getInitialEffortSetting(),
        activeOverlays: new Set<string>(),
        ...(isAdvisorEnabled() && advisorModel && { advisorModel }),
        // Compute teamContext synchronously to avoid useEffect setState during render.
        teamContext: computeInitialTeamContext() as AppState['teamContext'],
      };

      // Add CLI initial prompt to history
      if (inputPrompt) {
        addToHistory(String(inputPrompt));
      }

      const initialTools = mcpTools;

      // Increment numStartups synchronously — first-render readers like
      // shouldShowEffortCallout (via useState initializer) need the updated
      // value before setImmediate fires. Defer only telemetry.
      saveGlobalConfig(current => ({
        ...current,
        numStartups: (current.numStartups ?? 0) + 1,
      }));
      setImmediate(() => {
        void logStartupTelemetry();
        logSessionTelemetry();
      });

      // Set up per-turn session environment data uploader (ant-only build).
      // Default-enabled for all ant users when working in an Anthropic-owned
      // repo. Captures git/filesystem state (NOT transcripts) at each turn so
      // environments can be recreated at any user message index. Gating:
      //   - Build-time: this import is stubbed in external builds.
      //   - Runtime: uploader checks github.com/anthropics/* remote + gcloud auth.
      //   - Safety: SOPHIA_DISABLE_SESSION_DATA_UPLOAD=1 bypasses (tests set this).
      // Import is dynamic + async to avoid adding startup latency.
      const sessionUploaderPromise = process.env.USER_TYPE === 'ant' ? import('./utils/sessionDataUploader.js') : null;

      // Defer session uploader resolution to the onTurnComplete callback to avoid
      // adding a new top-level await in main.tsx (performance-critical path).
      // The per-turn auth logic in sessionDataUploader.ts handles unauthenticated
      // state gracefully (re-checks each turn, so auth recovery mid-session works).
      const uploaderReady = sessionUploaderPromise
        ? sessionUploaderPromise.then(mod => mod.createSessionTurnUploader()).catch(() => null)
        : null;

      const sessionConfig = {
        debug: debug || debugToStderr,
        commands: [...commands, ...mcpCommands],
        initialTools,
        mcpClients,
        mainThreadAgentDefinition,
        disableSlashCommands: false,
        dynamicMcpConfig,
        strictMcpConfig,
        systemPrompt,
        appendSystemPrompt,
        taskListId,
        thinkingConfig,
        ...(uploaderReady && {
          onTurnComplete: (messages: MessageType[]) => {
            void uploaderReady.then(uploader => (uploader as ((msgs: MessageType[]) => void) | null)?.(messages));
          },
        }),
      };

      // Shared context for processResumedConversation calls
      const resumeContext = {
        mainThreadAgentDefinition,
        agentDefinitions,
        initialState,
      };

      if (options.continue) {
        // Continue the most recent conversation directly
        let resumeSucceeded = false;
        try {
          const resumeStart = performance.now();

          // Clear stale caches before resuming to ensure fresh file/skill discovery
          const { clearSessionCaches } = await import('./commands/clear/caches.js');
          clearSessionCaches();

          const result = await loadConversationForResume(undefined /* sessionId */, undefined /* sourceFile */);
          if (!result) {
            logEvent('tengu_continue', {
              success: false,
            });
            return await exitWithError(root, 'No conversation found to continue');
          }

          const loaded = await processResumedConversation(
            result,
            {
              forkSession: !!options.forkSession,
              includeAttribution: true,
              transcriptPath: result.fullPath,
            },
            resumeContext,
          );

          if (loaded.restoredAgentDef) {
            mainThreadAgentDefinition = loaded.restoredAgentDef;
          }

          logEvent('tengu_continue', {
            success: true,
            resume_duration_ms: Math.round(performance.now() - resumeStart),
          });
          resumeSucceeded = true;

          await launchRepl(
            root,
            {
              getFpsMetrics,
              stats,
              initialState: loaded.initialState,
            },
            {
              ...sessionConfig,
              mainThreadAgentDefinition: loaded.restoredAgentDef ?? mainThreadAgentDefinition,
              initialMessages: loaded.messages,
              initialFileHistorySnapshots: loaded.fileHistorySnapshots,
              initialContentReplacements: loaded.contentReplacements,
              initialAgentName: loaded.agentName,
              initialAgentColor: loaded.agentColor,
            },
            renderAndRun,
          );
        } catch (error) {
          if (!resumeSucceeded) {
            logEvent('tengu_continue', {
              success: false,
            });
          }
          logError(error);
          process.exit(1);
        }
      } else if (options.resume) {
        // Handle resume flow - from file (ant-only), session ID, or interactive selector

        // Clear stale caches before resuming to ensure fresh file/skill discovery
        const { clearSessionCaches } = await import('./commands/clear/caches.js');
        clearSessionCaches();

        let messages: MessageType[] | null = null;
        let processedResume: ProcessedResume | undefined;

        let maybeSessionId = validateUuid(options.resume);
        let searchTerm: string | undefined;
        // Store full LogOption when found by custom title (for cross-worktree resume)
        let matchedLog: LogOption | null = null;
        // If resume value is not a UUID, try exact match by custom title first
        if (options.resume && typeof options.resume === 'string' && !maybeSessionId) {
          const trimmedValue = options.resume.trim();
          if (trimmedValue) {
            const matches = await searchSessionsByCustomTitle(trimmedValue, {
              exact: true,
            });

            if (matches.length === 1) {
              // Exact match found - store full LogOption for cross-worktree resume
              matchedLog = matches[0]!;
              maybeSessionId = getSessionIdFromLog(matchedLog) ?? null;
            } else {
              // No match or multiple matches - use as search term for picker
              searchTerm = trimmedValue;
            }
          }
        }

        if (process.env.USER_TYPE === 'ant') {
          if (options.resume && typeof options.resume === 'string' && !maybeSessionId) {
            const resolvedPath = resolve(options.resume);
            try {
              const resumeStart = performance.now();
              let logOption;
              try {
                // Attempt to load as a transcript file; ENOENT falls through to session-ID handling
                logOption = await loadTranscriptFromFile(resolvedPath);
              } catch (error) {
                if (!isENOENT(error)) throw error;
                // ENOENT: not a file path — fall through to session-ID handling
              }
              if (logOption) {
                const result = await loadConversationForResume(logOption, undefined /* sourceFile */);
                if (result) {
                  processedResume = await processResumedConversation(
                    result,
                    {
                      forkSession: !!options.forkSession,
                      transcriptPath: result.fullPath,
                    },
                    resumeContext,
                  );
                  if (processedResume.restoredAgentDef) {
                    mainThreadAgentDefinition = processedResume.restoredAgentDef;
                  }
                  logEvent('tengu_session_resumed', {
                    entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    success: true,
                    resume_duration_ms: Math.round(performance.now() - resumeStart),
                  });
                } else {
                  logEvent('tengu_session_resumed', {
                    entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    success: false,
                  });
                }
              }
            } catch (error) {
              logEvent('tengu_session_resumed', {
                entrypoint: 'file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                success: false,
              });
              logError(error);
              await exitWithError(root, `Unable to load transcript from file: ${options.resume}`, () =>
                gracefulShutdown(1),
              );
            }
          }
        }

        // If not loaded as a file, try as session ID
        if (maybeSessionId) {
          // Resume specific session by ID
          const sessionId = maybeSessionId;
          try {
            const resumeStart = performance.now();
            // Use matchedLog if available (for cross-worktree resume by custom title)
            // Otherwise fall back to sessionId string (for direct UUID resume)
            const result = await loadConversationForResume(matchedLog ?? sessionId, undefined);

            if (!result) {
              logEvent('tengu_session_resumed', {
                entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                success: false,
              });
              return await exitWithError(root, `No conversation found with session ID: ${sessionId}`);
            }

            const fullPath = matchedLog?.fullPath ?? result.fullPath;
            processedResume = await processResumedConversation(
              result,
              {
                forkSession: !!options.forkSession,
                sessionIdOverride: sessionId,
                transcriptPath: fullPath,
              },
              resumeContext,
            );

            if (processedResume.restoredAgentDef) {
              mainThreadAgentDefinition = processedResume.restoredAgentDef;
            }
            logEvent('tengu_session_resumed', {
              entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              success: true,
              resume_duration_ms: Math.round(performance.now() - resumeStart),
            });
          } catch (error) {
            logEvent('tengu_session_resumed', {
              entrypoint: 'cli_flag' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              success: false,
            });
            logError(error);
            await exitWithError(root, `Failed to resume session ${sessionId}`);
          }
        }

        // If we have a processed resume, render the REPL
        const resumeData =
          processedResume ??
          (Array.isArray(messages)
            ? {
                messages,
                fileHistorySnapshots: undefined,
                agentName: undefined,
                agentColor: undefined as AgentColorName | undefined,
                restoredAgentDef: mainThreadAgentDefinition,
                initialState,
                contentReplacements: undefined,
              }
            : undefined);
        if (resumeData) {
          await launchRepl(
            root,
            {
              getFpsMetrics,
              stats,
              initialState: resumeData.initialState,
            },
            {
              ...sessionConfig,
              mainThreadAgentDefinition: resumeData.restoredAgentDef ?? mainThreadAgentDefinition,
              initialMessages: resumeData.messages,
              initialFileHistorySnapshots: resumeData.fileHistorySnapshots,
              initialContentReplacements: resumeData.contentReplacements,
              initialAgentName: resumeData.agentName,
              initialAgentColor: resumeData.agentColor,
            },
            renderAndRun,
          );
        } else {
          // Show interactive selector (includes same-repo worktrees)
          // Note: ResumeConversation loads logs internally to ensure proper GC after selection
          await launchResumeChooser(root, { getFpsMetrics, stats, initialState }, getWorktreePaths(getOriginalCwd()), {
            ...sessionConfig,
            initialSearchQuery: searchTerm,
            forkSession: options.forkSession,
          });
        }
      } else {
        // Pass unresolved hooks promise to REPL so it can render immediately
        // instead of blocking ~500ms waiting for SessionStart hooks to finish.
        // REPL will inject hook messages when they resolve and await them before
        // the first API call so the model always sees hook context.
        const pendingHookMessages = hooksPromise && hookMessages.length === 0 ? hooksPromise : undefined;

        profileCheckpoint('action_after_hooks');
        // If launched via a deep link, show a provenance banner so the user
        // knows the session originated externally. Linux xdg-open and
        // browsers with "always allow" set dispatch the link with no OS-level
        // confirmation, so this is the only signal the user gets that the
        // prompt — and the working directory / SOPHIA.md it implies — came
        // from an external source rather than something they typed.
        let deepLinkBanner: ReturnType<typeof createSystemMessage> | null = null;
        if (feature('LODESTONE')) {
          if (options.deepLinkOrigin) {
            logEvent('tengu_deep_link_opened', {
              has_prefill: Boolean(options.prefill),
              has_repo: Boolean(options.deepLinkRepo),
            });
            deepLinkBanner = createSystemMessage(
              buildDeepLinkBanner({
                cwd: getCwd(),
                prefillLength: options.prefill?.length,
                repo: options.deepLinkRepo,
                lastFetch: options.deepLinkLastFetch !== undefined ? new Date(options.deepLinkLastFetch) : undefined,
              }),
              'warning',
            );
          } else if (options.prefill) {
            deepLinkBanner = createSystemMessage(
              'Launched with a pre-filled prompt — review it before pressing Enter.',
              'warning',
            );
          }
        }
        const initialMessages = deepLinkBanner
          ? [deepLinkBanner, ...hookMessages]
          : hookMessages.length > 0
            ? hookMessages
            : undefined;

        await launchRepl(
          root,
          { getFpsMetrics, stats, initialState },
          {
            ...sessionConfig,
            initialMessages,
            pendingHookMessages,
          },
          renderAndRun,
        );
      }
    })
    .version(`${MACRO.VERSION} (Sophia Agent)`, '-v, --version', 'Output the version number');

  if (canUserConfigureAdvisor()) {
    program.addOption(
      new Option(
        '--advisor <model>',
        'Enable the server-side advisor tool with the specified model (alias or full ID).',
      ).hideHelp(),
    );
  }

  if (process.env.USER_TYPE === 'ant') {
    program.addOption(
      new Option(
        '--tasks [id]',
        '[ANT-ONLY] Tasks mode: watch for tasks and auto-process them. Optional id is used as both the task list ID and agent ID (defaults to "tasklist").',
      )
        .argParser(String)
        .hideHelp(),
    );
    program.option('--agent-teams', '[ANT-ONLY] Force Claude to use multi-agent mode for solving problems', () => true);
  }

  if (feature('UDS_INBOX')) {
    program.addOption(
      new Option(
        '--messaging-socket-path <path>',
        'Unix domain socket path for the UDS messaging server (defaults to a tmp path)',
      ),
    );
  }

  // Teammate identity options (set by leader when spawning tmux teammates)
  // These replace the SOPHIA_* environment variables
  program.addOption(new Option('--agent-id <id>', 'Teammate agent ID').hideHelp());
  program.addOption(new Option('--agent-name <name>', 'Teammate display name').hideHelp());
  program.addOption(new Option('--team-name <name>', 'Team name for swarm coordination').hideHelp());
  program.addOption(new Option('--agent-color <color>', 'Teammate UI color').hideHelp());
  program.addOption(new Option('--parent-session-id <id>', 'Parent session ID for analytics correlation').hideHelp());
  program.addOption(new Option('--agent-type <type>', 'Custom agent type for this teammate').hideHelp());

  // Enable SDK URL for all builds but hide from help
  program.addOption(
    new Option(
      '--sdk-url <url>',
      'Use remote WebSocket endpoint for SDK I/O streaming (only with -p and stream-json format)',
    ).hideHelp(),
  );

  if (feature('HARD_FAIL')) {
    program.addOption(new Option('--hard-fail', 'Crash on logError calls instead of silently logging').hideHelp());
  }

  profileCheckpoint('run_main_options_built');

  // -p/--print mode: skip subcommand registration. The 52 subcommands
  // (mcp, auth, plugin, skill, task, config, doctor, update, etc.) are
  // never dispatched in print mode — commander routes the prompt to the
  // default action. The subcommand registration path was measured at ~65ms
  // on baseline — mostly the isBridgeEnabled() call (25ms settings Zod parse
  // + 40ms sync keychain subprocess), both hidden by the try/catch that
  // always returns false before enableConfigs(). Sophia URLs are rewritten to
  // `open` at main() line ~851 BEFORE this runs, so argv check is safe here.
  const isPrintMode = process.argv.includes('-p') || process.argv.includes('--print');
  if (isPrintMode) {
    profileCheckpoint('run_before_parse');
    await program.parseAsync(process.argv);
    profileCheckpoint('run_after_parse');
    return program;
  }

  // ant-only commands
  if (process.env.USER_TYPE === 'ant') {
    const validateLogId = (value: string) => {
      const maybeSessionId = validateUuid(value);
      if (maybeSessionId) return maybeSessionId;
      return Number(value);
    };
    // sophia log
    program
      .command('log')
      .description('[ANT-ONLY] Manage conversation logs.')
      .argument(
        '[number|sessionId]',
        'A number (0, 1, 2, etc.) to display a specific log, or the sesssion ID (uuid) of a log',
        validateLogId,
      )
      .action(async (logId: string | number | undefined) => {
        const { logHandler } = await import('./cli/handlers/ant.js');
        await logHandler(logId);
      });

    // sophia error
    program
      .command('error')
      .description(
        '[ANT-ONLY] View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.',
      )
      .argument('[number]', 'A number (0, 1, 2, etc.) to display a specific log', parseInt)
      .action(async (number: number | undefined) => {
        const { errorHandler } = await import('./cli/handlers/ant.js');
        await errorHandler(number);
      });

    // sophia export
    program
      .command('export')
      .description('[ANT-ONLY] Export a conversation to a text file.')
      .usage('<source> <outputFile>')
      .argument('<source>', 'Session ID, log index (0, 1, 2...), or path to a .json/.jsonl log file')
      .argument('<outputFile>', 'Output file path for the exported text')
      .addHelpText(
        'after',
        `
Examples:
  $ sophia export 0 conversation.txt                Export conversation at log index 0
  $ sophia export <uuid> conversation.txt           Export conversation by session ID
  $ sophia export input.json output.txt             Render JSON log file to text
  $ sophia export <uuid>.jsonl output.txt           Render JSONL session file to text`,
      )
      .action(async (source: string, outputFile: string) => {
        const { exportHandler } = await import('./cli/handlers/ant.js');
        await exportHandler(source, outputFile);
      });

    if (process.env.USER_TYPE === 'ant') {
      const taskCmd = program.command('task').description('[ANT-ONLY] Manage task list tasks');

      taskCmd
        .command('create <subject>')
        .description('Create a new task')
        .option('-d, --description <text>', 'Task description')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(async (subject: string, opts: { description?: string; list?: string }) => {
          const { taskCreateHandler } = await import('./cli/handlers/ant.js');
          await taskCreateHandler(subject, opts);
        });

      taskCmd
        .command('list')
        .description('List all tasks')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .option('--pending', 'Show only pending tasks')
        .option('--json', 'Output as JSON')
        .action(async (opts: { list?: string; pending?: boolean; json?: boolean }) => {
          const { taskListHandler } = await import('./cli/handlers/ant.js');
          await taskListHandler(opts);
        });

      taskCmd
        .command('get <id>')
        .description('Get details of a task')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(async (id: string, opts: { list?: string }) => {
          const { taskGetHandler } = await import('./cli/handlers/ant.js');
          await taskGetHandler(id, opts);
        });

      taskCmd
        .command('update <id>')
        .description('Update a task')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .option('-s, --status <status>', `Set status (${TASK_STATUSES.join(', ')})`)
        .option('--subject <text>', 'Update subject')
        .option('-d, --description <text>', 'Update description')
        .option('--owner <agentId>', 'Set owner')
        .option('--clear-owner', 'Clear owner')
        .action(
          async (
            id: string,
            opts: {
              list?: string;
              status?: string;
              subject?: string;
              description?: string;
              owner?: string;
              clearOwner?: boolean;
            },
          ) => {
            const { taskUpdateHandler } = await import('./cli/handlers/ant.js');
            await taskUpdateHandler(id, opts);
          },
        );

      taskCmd
        .command('dir')
        .description('Show the tasks directory path')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(async (opts: { list?: string }) => {
          const { taskDirHandler } = await import('./cli/handlers/ant.js');
          await taskDirHandler(opts);
        });
    }

    // sophia completion <shell>
    program
      .command('completion <shell>', { hidden: true })
      .description('Generate shell completion script (bash, zsh, or fish)')
      .option('--output <file>', 'Write completion script directly to a file instead of stdout')
      .action(async (shell: string, opts: { output?: string }) => {
        const { completionHandler } = await import('./cli/handlers/ant.js');
        await completionHandler(shell, opts, program);
      });
  }

  profileCheckpoint('run_before_parse');
  await program.parseAsync(process.argv);
  profileCheckpoint('run_after_parse');

  // Record final checkpoint for total_time calculation
  profileCheckpoint('main_after_run');

  // Log startup perf to Statsig (sampled) and output detailed report if enabled
  profileReport();

  return program;
}

async function logTenguInit({
  hasInitialPrompt,
  hasStdin,
  verbose,
  debug,
  debugToStderr,
  print,
  outputFormat,
  inputFormat,
  numAllowedTools,
  mcpClientCount,
  worktreeEnabled,
  skipWebFetchPreflight,
  githubActionInputs,
  systemPromptFlag,
  appendSystemPromptFlag,
  thinkingConfig,
}: {
  hasInitialPrompt: boolean;
  hasStdin: boolean;
  verbose: boolean;
  debug: boolean;
  debugToStderr: boolean;
  print: boolean;
  outputFormat: string;
  inputFormat: string;
  numAllowedTools: number;
  mcpClientCount: number;
  worktreeEnabled: boolean;
  skipWebFetchPreflight: boolean | undefined;
  githubActionInputs: string | undefined;
  systemPromptFlag: 'file' | 'flag' | undefined;
  appendSystemPromptFlag: 'file' | 'flag' | undefined;
  thinkingConfig: ThinkingConfig;
}): Promise<void> {
  try {
    logEvent('tengu_init', {
      entrypoint: 'claude' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      hasInitialPrompt,
      hasStdin,
      verbose,
      debug,
      debugToStderr,
      print,
      outputFormat: outputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      inputFormat: inputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numAllowedTools,
      mcpClientCount,
      worktree: worktreeEnabled,
      skipWebFetchPreflight,
      ...(githubActionInputs && {
        githubActionInputs: githubActionInputs as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      inProtectedNamespace: isInProtectedNamespace(),
      thinkingType: thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(thinkingConfig.type === 'enabled' && {
        thinkingBudgetTokens: thinkingConfig.budgetTokens,
      }),
      ...(systemPromptFlag && {
        systemPromptFlag: systemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(appendSystemPromptFlag && {
        appendSystemPromptFlag: appendSystemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      is_simple: isBareMode() || undefined,
      autoUpdatesChannel: (getInitialSettings().autoUpdatesChannel ??
        'latest') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(process.env.USER_TYPE === 'ant'
        ? (() => {
            const cwd = getCwd();
            const gitRoot = findGitRoot(cwd);
            const rp = gitRoot ? relative(gitRoot, cwd) || '.' : undefined;
            return rp
              ? {
                  relativeProjectPath: rp as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                }
              : {};
          })()
        : {}),
    });
  } catch (error) {
    logError(error);
  }
}

function resetCursor() {
  const terminal = process.stderr.isTTY ? process.stderr : process.stdout.isTTY ? process.stdout : undefined;
  terminal?.write(SHOW_CURSOR);
}

type TeammateOptions = {
  agentId?: string;
  agentName?: string;
  teamName?: string;
  agentColor?: string;
  parentSessionId?: string;
  agentType?: string;
};

function extractTeammateOptions(options: unknown): TeammateOptions {
  if (typeof options !== 'object' || options === null) {
    return {};
  }
  const opts = options as Record<string, unknown>;
  return {
    agentId: typeof opts.agentId === 'string' ? opts.agentId : undefined,
    agentName: typeof opts.agentName === 'string' ? opts.agentName : undefined,
    teamName: typeof opts.teamName === 'string' ? opts.teamName : undefined,
    agentColor: typeof opts.agentColor === 'string' ? opts.agentColor : undefined,
    parentSessionId: typeof opts.parentSessionId === 'string' ? opts.parentSessionId : undefined,
    agentType: typeof opts.agentType === 'string' ? opts.agentType : undefined,
  };
}
