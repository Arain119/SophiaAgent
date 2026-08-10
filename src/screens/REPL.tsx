// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import {
  snapshotOutputTokensForTurn,
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  getBudgetContinuationCount,
  getTotalInputTokens,
} from '../bootstrap/state.js';
import { parseTokenBudget } from '../utils/tokenBudget.js';
import { count } from '../utils/array.js';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import figures from 'figures';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- / n N Esc [ v are bare letters in transcript modal context, same class as g/G/j/k in ScrollKeybindingHandler
import { useInput } from '@anthropic/ink';
import { useSearchInput } from '../hooks/useSearchInput.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useSearchHighlight } from '@anthropic/ink';
import type { JumpHandle } from '../components/VirtualMessageList.js';
import { renderMessagesToPlainText } from '../utils/exportRenderer.js';
import { openFileInExternalEditor } from '../utils/editor.js';
import { writeFile } from 'fs/promises';
import {
  type TabStatusKind,
  Box,
  Text,
  useStdin,
  useTheme,
  useTerminalFocus,
  useTerminalTitle,
  useTabStatus,
} from '@anthropic/ink';
import { IdleReturnDialog } from '../components/IdleReturnDialog.js';
import * as React from 'react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  type RefObject,
} from 'react';
import { useNotifications } from '../context/notifications.js';
import { sendNotification } from '../services/notifier.js';
import { startPreventSleep, stopPreventSleep } from '../services/preventSleep.js';
import { useTerminalNotification, hasCursorUpViewportYankBug } from '@anthropic/ink';
import {
  createFileStateCacheWithSizeLimit,
  mergeFileStateCaches,
  READ_FILE_STATE_CACHE_SIZE,
} from '../utils/fileStateCache.js';
import {
  updateLastInteractionTime,
  getLastInteractionTime,
  getOriginalCwd,
  getProjectRoot,
  getSessionId,
  switchSession,
  setCostStateForRestore,
  getTurnHookDurationMs,
  getTurnHookCount,
  resetTurnHookDuration,
  getTurnToolDurationMs,
  getTurnToolCount,
  resetTurnToolDuration,
  getTurnClassifierDurationMs,
  getTurnClassifierCount,
  resetTurnClassifierDuration,
} from '../bootstrap/state.js';
import { asSessionId, asAgentId } from '../types/ids.js';
import { logForDebugging } from '../utils/debug.js';
import { QueryGuard } from '../utils/QueryGuard.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { formatTokens, truncateToWidth } from '../utils/format.js';
import { consumeEarlyInput } from '../utils/earlyInput.js';
import {
  claimConsumableQueuedAutonomyCommands,
  finalizeAutonomyCommandsForTurn,
} from '../utils/autonomyQueueLifecycle.js';

import { setMemberActive } from '../utils/swarm/teamHelpers.js';
import {
  isSwarmWorker,
  generateSandboxRequestId,
  sendSandboxPermissionRequestViaMailbox,
  sendSandboxPermissionResponseViaMailbox,
} from '../utils/swarm/permissionSync.js';
import { registerSandboxPermissionCallback } from '../hooks/useSwarmPermissionPoller.js';
import { getTeamName, getAgentName } from '../utils/teammate.js';
import { WorkerPendingPermission } from '../components/permissions/WorkerPendingPermission.js';
import {
  injectUserMessageToTeammate,
  getAllInProcessTeammateTasks,
} from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import {
  isLocalAgentTask,
  queuePendingMessage,
  appendMessageToLocalAgent,
  type LocalAgentTaskState,
} from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { endInteractionSpan } from '../utils/telemetry/sessionTracing.js';
import { useLogMessages } from '../hooks/useLogMessages.js';
import {
  type Command,
  type CommandResultDisplay,
  type ResumeEntrypoint,
  getCommandName,
  isCommandEnabled,
} from '../commands.js';
import type { PromptInputMode, QueuedCommand, VimMode } from '../types/textInputTypes.js';
import {
  MessageSelector,
  selectableUserMessagesFilter,
  messagesAfterAreOnlySynthetic,
} from '../components/MessageSelector.js';
import { useIdeLogging } from '../hooks/useIdeLogging.js';
import {
  UserQuestionDialog,
  type UserQuestionRequest,
} from '../components/permissions/UserQuestionDialog/UserQuestionDialog.js';
import { ElicitationDialog } from '../components/mcp/ElicitationDialog.js';
import { PromptDialog } from '../components/hooks/PromptDialog.js';
import type { PromptRequest, PromptResponse } from '../types/hooks.js';
import PromptInput from '../components/PromptInput/PromptInput.js';
import { PromptInputQueuedCommands } from '../components/PromptInput/PromptInputQueuedCommands.js';
import { useMoreRight } from '../moreright/useMoreRight.js';
import { SpinnerWithVerb, type SpinnerMode } from '../components/Spinner.js';
import { MODEL_SPINNER_FRAME_MS, MODEL_SPINNER_FRAMES } from '../components/Spinner/SpinnerGlyph.js';
import { getSystemPrompt } from '../constants/prompts.js';
import { buildEffectiveSystemPrompt } from '../utils/systemPrompt.js';
import { getSystemContext, getUserContext } from '../context.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { startBackgroundHousekeeping } from '../utils/backgroundHousekeeping.js';
import { saveCurrentSessionCosts, resetCostState, getStoredSessionCosts } from '../cost-tracker.js';
import { useCostSummary } from '../costHook.js';
import { useFpsMetrics } from '../context/fpsMetrics.js';
import { useAfterFirstRender } from '../hooks/useAfterFirstRender.js';
import { useDeferredHookMessages } from '../hooks/useDeferredHookMessages.js';
import { addToHistory, removeLastFromHistory, expandPastedTextRefs, parseReferences } from '../history.js';
import { prependModeCharacterToInput } from '../components/PromptInput/inputModes.js';
import { prependToShellHistoryCache } from '../utils/suggestions/shellHistoryCompletion.js';
import { useApiKeyVerification } from '../hooks/useApiKeyVerification.js';
import { GlobalKeybindingHandlers } from '../hooks/useGlobalKeybindings.js';
import { CommandKeybindingHandlers } from '../hooks/useCommandKeybindings.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';
import { CancelRequestHandler } from '../hooks/useCancelRequest.js';
import { useBackgroundTaskNavigation } from '../hooks/useBackgroundTaskNavigation.js';
import { useSwarmInitialization } from '../hooks/useSwarmInitialization.js';
import { useTeammateViewAutoExit } from '../hooks/useTeammateViewAutoExit.js';
import { errorMessage, toError } from '../utils/errors.js';
import { isHumanTurn } from '../utils/messagePredicates.js';
import { logError } from '../utils/log.js';
import { getCwd } from '../utils/cwd.js';
// Dead code elimination: conditional imports
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
// Ant-only org warning. Conditional require so the org UUID list is
// eliminated from external builds (one UUID is on excluded-strings).
const useAntOrgWarningNotification: typeof import('../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification =
  process.env.USER_TYPE === 'ant'
    ? require('../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification
    : () => {};
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import useCanUseTool from '../hooks/useCanUseTool.js';
import type { ToolSafetyContext, Tool } from '../Tool.js';
import { applySafetyRuleUpdate, persistSafetyRuleUpdate } from '../utils/safety/SafetyRuleUpdate.js';
import { WEB_FETCH_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/WebFetchTool/prompt.js';
import { clearSpeculativeChecks } from '@sophia-agent/builtin-tools/tools/BashTool/bashSafety.js';
import { getGlobalConfig, saveGlobalConfig, getGlobalConfigWriteCount } from '../utils/config.js';
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import {
  textForResubmit,
  handleMessageFromStream,
  type StreamingToolUse,
  type StreamingThinking,
  isCompactBoundaryMessage,
  getMessagesAfterCompactBoundary,
  getContentText,
  createUserMessage,
  createAssistantMessage,
  createTurnDurationMessage,
  createAgentsKilledMessage,
  createApiMetricsMessage,
  createSystemMessage,
  createCommandInputMessage,
  formatCommandInputTags,
} from '../utils/messages.js';
import { generateSessionTitle } from '../utils/sessionTitle.js';
import {
  BASH_INPUT_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_NAME_TAG,
  FORK_BOILERPLATE_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../constants/xml.js';
import { FORK_SUBAGENT_TYPE } from '@sophia-agent/builtin-tools/tools/AgentTool/forkSubagent.js';
import { escapeXml } from '../utils/xml.js';
import type { ThinkingConfig } from '../utils/thinking.js';
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js';
import { handlePromptSubmit, type PromptInputHelpers } from '../utils/handlePromptSubmit.js';
import { useQueueProcessor } from '../hooks/useQueueProcessor.js';
import { useMailboxBridge } from '../hooks/useMailboxBridge.js';
import { queryCheckpoint, logQueryProfileReport } from '../utils/queryProfiler.js';
import type {
  Message as MessageType,
  UserMessage,
  ProgressMessage,
  HookResultMessage,
  PartialCompactDirection,
} from '../types/message.js';
import { query } from '../query.js';
import { mergeClients, useMergedClients } from '../hooks/useMergedClients.js';
import { getQuerySourceForREPL } from '../utils/promptCategory.js';
import { useMergedTools } from '../hooks/useMergedTools.js';
import { mergeAndFilterTools } from '../utils/toolPool.js';
import { useMergedCommands } from '../hooks/useMergedCommands.js';
import { useSkillsChange } from '../hooks/useSkillsChange.js';
import { useManagePlugins } from '../hooks/useManagePlugins.js';
import { Messages } from '../components/Messages.js';
import { TaskListV2 } from '../components/TaskListV2.js';
import { TeammateViewHeader } from '../components/TeammateViewHeader.js';
import { getPipeIpc } from '../utils/pipeTransport.js';
import { useTasksV2WithCollapseEffect } from '../hooks/useTasksV2.js';
import { maybeMarkProjectOnboardingComplete } from '../projectOnboardingState.js';
import type { MCPServerConnection } from '../services/mcp/types.js';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { randomUUID, type UUID } from 'crypto';
import { processSessionStartHooks } from '../utils/sessionStart.js';
import { executeSessionEndHooks, getSessionEndHookTimeoutMs } from '../utils/hooks.js';
import { type IDESelection, useIdeSelection } from '../hooks/useIdeSelection.js';
import { getTools, assembleToolPool } from '../tools.js';
import type { AgentDefinition } from '@sophia-agent/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { resolveAgentTools } from '@sophia-agent/builtin-tools/tools/AgentTool/agentToolUtils.js';
import { resumeAgentBackground } from '@sophia-agent/builtin-tools/tools/AgentTool/resumeAgent.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { useAppState, useSetAppState, useAppStateStore } from '../state/AppState.js';
import type { ContentBlockParam, ContentBlock, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { ProcessUserInputContext } from '../utils/processUserInput/processUserInput.js';
import type { PastedContent } from '../utils/config.js';
import type { InternalExecutionMode } from '../types/safety.js';
import { copyPlanForFork, copyPlanForResume, getPlanSlug, setPlanSlug } from '../utils/plans.js';
import {
  clearSessionMetadata,
  resetSessionFilePointer,
  adoptResumedSessionFile,
  removeTranscriptMessage,
  restoreSessionMetadata,
  getCurrentSessionTitle,
  isEphemeralToolProgress,
  isLoggableMessage,
  saveWorktreeState,
  getAgentTranscript,
} from '../utils/sessionStorage.js';
import { deserializeMessages } from '../utils/conversationRecovery.js';
import { extractReadFilesFromMessages, extractBashToolsFromMessages } from '../utils/queryHelpers.js';
import { resetMicrocompactState } from '../services/compact/microCompact.js';
import { runPostCompactCleanup, registerCompactCleanup } from '../services/compact/postCompactCleanup.js';
import {
  createContentReplacementState,
  provisionContentReplacementState,
  reconstructContentReplacementState,
  type ContentReplacementRecord,
} from '../utils/toolResultStorage.js';
import { partialCompactConversation } from '../services/compact/compact.js';
import type { LogOption } from '../types/logs.js';
import type { AgentColorName } from '@sophia-agent/builtin-tools/tools/AgentTool/agentColorManager.js';
import {
  fileHistoryMakeSnapshot,
  type FileHistoryState,
  fileHistoryRewind,
  type FileHistorySnapshot,
  copyFileHistoryForResume,
  fileHistoryEnabled,
  fileHistoryHasAnyChanges,
} from '../utils/fileHistory.js';
import { type AttributionState, incrementPromptCount } from '../utils/commitAttribution.js';
import { recordAttributionSnapshot } from '../utils/sessionStorage.js';
import {
  computeStandaloneAgentContext,
  restoreAgentFromSession,
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
  exitRestoredWorktree,
} from '../utils/sessionRestore.js';
import { updateSessionName } from '../utils/concurrentSessions.js';
import { isInProcessTeammateTask, type InProcessTeammateTaskState } from '../tasks/InProcessTeammateTask/types.js';
import { BackgroundAgentSelector } from '../components/tasks/BackgroundAgentSelector.js';
import { useInboxPoller } from '../hooks/useInboxPoller.js';
import { useScheduledTasks } from '../hooks/useScheduledTasks.js';
/* eslint-disable @typescript-eslint/no-require-imports */
const useMasterMonitor = feature('UDS_INBOX')
  ? require('../hooks/useMasterMonitor.js').useMasterMonitor
  : () => undefined;
const useSlaveNotifications = feature('UDS_INBOX')
  ? require('../hooks/useSlaveNotifications.js').useSlaveNotifications
  : () => undefined;
const usePipeIpc = feature('UDS_INBOX') ? require('../hooks/usePipeIpc.js').usePipeIpc : () => undefined;
const usePipeRelay = feature('UDS_INBOX')
  ? require('../hooks/usePipeRelay.js').usePipeRelay
  : () => ({ relayPipeMessage: () => false, pipeReturnHadErrorRef: { current: false } });
const usePipeMuteSync = feature('UDS_INBOX') ? require('../hooks/usePipeMuteSync.js').usePipeMuteSync : () => undefined;
const usePipeRouter = feature('UDS_INBOX')
  ? require('../hooks/usePipeRouter.js').usePipeRouter
  : () => ({ routeToSelectedPipes: () => false });
/* eslint-enable @typescript-eslint/no-require-imports */
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js';
import { useTaskListWatcher } from '../hooks/useTaskListWatcher.js';
import type { SandboxAskCallback, NetworkHostPattern } from '../utils/sandbox/sandbox-adapter.js';

import { closeOpenDiffs, getConnectedIdeClient } from '../utils/ide.js';
import { ExitFlow } from '../components/ExitFlow.js';
import { getCurrentWorktreeSession } from '../utils/worktree.js';
import { popAllEditable, enqueue, getCommandQueue, getCommandQueueLength } from '../utils/messageQueueManager.js';
import { useCommandQueue } from '../hooks/useCommandQueue.js';
import { TaskBackgroundHandler } from '../components/TaskBackgroundHandler.js';
import { diagnosticTracker } from '../services/diagnosticTracking.js';
import type { EffortValue } from '../utils/effort.js';
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const AntModelSwitchCallout =
  process.env.USER_TYPE === 'ant' ? require('../components/AntModelSwitchCallout.js').AntModelSwitchCallout : null;
const shouldShowAntModelSwitch =
  process.env.USER_TYPE === 'ant'
    ? require('../components/AntModelSwitchCallout.js').shouldShowModelSwitchCallout
    : (): boolean => false;
const UndercoverAutoCallout =
  process.env.USER_TYPE === 'ant' ? require('../components/UndercoverAutoCallout.js').UndercoverAutoCallout : null;
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import { activityManager } from '../utils/activityManager.js';
import { createAbortController } from '../utils/abortController.js';
import { MCPConnectionManager } from 'src/services/mcp/MCPConnectionManager.js';
import { useInstallMessages } from 'src/hooks/notifs/useInstallMessages.js';
import { useAwaySummary } from 'src/hooks/useAwaySummary.js';
import { getTipToShowOnSpinner, recordShownTip } from 'src/services/tips/tipScheduler.js';
import type { Theme } from 'src/utils/theme.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { useFileHistorySnapshotInit } from 'src/hooks/useFileHistorySnapshotInit.js';
import { SandboxPermissionRequest } from 'src/components/permissions/SandboxPermissionRequest.js';
import { SandboxViolationExpandedView } from 'src/components/SandboxViolationExpandedView.js';
import { useSettingsErrors } from 'src/hooks/notifs/useSettingsErrors.js';
import { useMcpConnectivityStatus } from 'src/hooks/notifs/useMcpConnectivityStatus.js';
import { useLspInitializationNotification } from 'src/hooks/notifs/useLspInitializationNotification.js';
import { usePluginInstallationStatus } from 'src/hooks/notifs/usePluginInstallationStatus.js';
import { usePluginAutoupdateNotification } from 'src/hooks/notifs/usePluginAutoupdateNotification.js';
import { performStartupChecks } from 'src/utils/plugins/performStartupChecks.js';
import { useNpmDeprecationNotification } from 'src/hooks/notifs/useNpmDeprecationNotification.js';
import { useTeammateLifecycleNotification } from 'src/hooks/notifs/useTeammateShutdownNotification.js';
import type { HookProgress } from '../types/hooks.js';
// Browser results render inline through tool_result.
import { IssueFlagBanner } from '../components/PromptInput/IssueFlagBanner.js';
import { useIssueFlagBanner } from '../hooks/useIssueFlagBanner.js';
import { DevBar } from '../components/DevBar.js';
// Session manager removed - using AppState now
import { FullscreenLayout, useUnseenDivider, computeUnseenDivider } from '../components/FullscreenLayout.js';
import { isFullscreenEnvEnabled, maybeGetTmuxMouseHint, isMouseTrackingEnabled } from '../utils/fullscreen.js';
import { AlternateScreen } from '@anthropic/ink';
import { ScrollKeybindingHandler } from '../components/ScrollKeybindingHandler.js';
import {
  useMessageActions,
  MessageActionsKeybindings,
  MessageActionsBar,
  type MessageActionsState,
  type MessageActionsNav,
  type MessageActionCaps,
} from '../components/messageActions.js';
import { setClipboard } from '@anthropic/ink';
import type { ScrollBoxHandle } from '@anthropic/ink';

// Stable empty array for hooks that accept MCPServerConnection[] — avoids
// creating a new [] literal on every render in remote mode, which would
// cause useEffect dependency changes and infinite re-render loops.

// Window after a user-initiated scroll during which type-into-empty does NOT
// repin to bottom. Josh Rosen's workflow: Claude emits long output → scroll
// up to read the start → start typing → before this fix, snapped to bottom.
// https://anthropic.slack.com/archives/C07VBSHV7EV/p1773545449871739
const RECENT_SCROLL_REPIN_WINDOW_MS = 3000;

// Use LRU cache to prevent unbounded memory growth
// 100 files should be sufficient for most coding sessions while preventing
// memory issues when working across many files in large projects

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

/**
 * Small component to display transcript mode footer with dynamic keybinding.
 * Must be rendered inside KeybindingSetup to access keybinding context.
 */
function TranscriptModeFooter({
  showAllInTranscript,
  virtualScroll,
  searchBadge,
  suppressShowAll = false,
  status,
}: {
  showAllInTranscript: boolean;
  virtualScroll: boolean;
  /** Minimap while navigating a closed-bar search. Shows n/N hints +
   *  right-aligned count instead of scroll hints. */
  searchBadge?: { current: number; count: number };
  /** Hide the ctrl+e hint. The [ dump path shares this footer with
   *  env-opted dump (SOPHIA_NO_FLICKER=0 / DISABLE_VIRTUAL_SCROLL=1),
   *  but ctrl+e only works in the env case — useGlobalKeybindings.tsx
   *  gates on !virtualScrollActive which is env-derived, doesn't know
   *  [ happened. */
  suppressShowAll?: boolean;
  /** Transient status (v-for-editor progress). Notifications render inside
   *  PromptInput which isn't mounted in transcript — addNotification queues
   *  but nothing draws it. */
  status?: string;
}): React.ReactNode {
  const toggleShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const showAllShortcut = useShortcutDisplay('transcript:toggleShowAll', 'Transcript', 'ctrl+e');
  return (
    <Box
      noSelect
      alignItems="center"
      alignSelf="center"
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
    >
      <Text dimColor>
        Showing detailed transcript · {toggleShortcut} to toggle
        {searchBadge
          ? ' · n/N to navigate'
          : virtualScroll
            ? ` · ${figures.arrowUp}${figures.arrowDown} scroll · home/end top/bottom`
            : suppressShowAll
              ? ''
              : ` · ${showAllShortcut} to ${showAllInTranscript ? 'collapse' : 'show all'}`}
      </Text>
      {status ? (
        // v-for-editor render progress — transient, preempts the search
        // badge since the user just pressed v and wants to see what's
        // happening. Clears after 4s.
        <>
          <Box flexGrow={1} />
          <Text>{status} </Text>
        </>
      ) : searchBadge ? (
        // Engine-counted — close enough for a rough location hint. May
        // drift from render-count for ghost/phantom messages.
        <>
          <Box flexGrow={1} />
          <Text dimColor>
            {searchBadge.current}/{searchBadge.count}
            {'  '}
          </Text>
        </>
      ) : null}
    </Box>
  );
}

/** less-style / bar. 1-row, same border-top styling as TranscriptModeFooter
 *  so swapping them in the bottom slot doesn't shift ScrollBox height.
 *  useSearchInput handles readline editing; we report query changes and
 *  render the counter. Incremental — re-search + highlight per keystroke. */
function TranscriptSearchBar({
  jumpRef,
  count,
  current,
  onClose,
  onCancel,
  setHighlight,
  initialQuery,
}: {
  jumpRef: RefObject<JumpHandle | null>;
  count: number;
  current: number;
  /** Enter — commit. Query persists for n/N. */
  onClose: (lastQuery: string) => void;
  /** Esc/ctrl+c/ctrl+g — undo to pre-/ state. */
  onCancel: () => void;
  setHighlight: (query: string) => void;
  // Seed with the previous query (less: / shows last pattern). Mount-fire
  // of the effect re-scans with the same query — idempotent (same matches,
  // nearest-ptr, same highlights). User can edit or clear.
  initialQuery: string;
}): React.ReactNode {
  const { query, cursorOffset } = useSearchInput({
    isActive: true,
    initialQuery,
    onExit: () => onClose(query),
    onCancel,
  });
  // Index warm-up runs before the query effect so it measures the real
  // cost — otherwise setSearchQuery fills the cache first and warm
  // reports ~0ms while the user felt the actual lag.
  // First / in a transcript session pays the extractSearchText cost.
  // Subsequent / return 0 immediately (indexWarmed ref in VML).
  // Transcript is frozen at ctrl+o so the cache stays valid.
  // Initial 'building' so warmDone is false on mount — the [query] effect
  // waits for the warm effect's first resolve instead of racing it. With
  // null initial, warmDone would be true on mount → [query] fires →
  // setSearchQuery fills cache → warm reports ~0ms while the user felt
  // the real lag.
  const [indexStatus, setIndexStatus] = React.useState<'building' | { ms: number } | null>('building');
  React.useEffect(() => {
    let alive = true;
    let hideTimeout: ReturnType<typeof setTimeout> | undefined;
    const warm = jumpRef.current?.warmSearchIndex;
    if (!warm) {
      setIndexStatus(null); // VML not mounted yet — rare, skip indicator
      return;
    }
    setIndexStatus('building');
    warm().then(ms => {
      if (!alive) return;
      // <20ms = imperceptible. No point showing "indexed in 3ms".
      if (ms < 20) {
        setIndexStatus(null);
      } else {
        setIndexStatus({ ms });
        hideTimeout = setTimeout(() => alive && setIndexStatus(null), 2000);
      }
    });
    return () => {
      alive = false;
      if (hideTimeout) clearTimeout(hideTimeout);
    };
  }, [jumpRef]); // mount-only per stable search bar ref
  // Gate the query effect on warm completion. setHighlight stays instant
  // (screen-space overlay, no indexing). setSearchQuery (the scan) waits.
  const warmDone = indexStatus !== 'building';
  useEffect(() => {
    if (!warmDone) return;
    jumpRef.current?.setSearchQuery(query);
    setHighlight(query);
  }, [jumpRef, query, setHighlight, warmDone]);
  const off = cursorOffset;
  const cursorChar = off < query.length ? query[off] : ' ';
  return (
    <Box
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
      // applySearchHighlight scans the whole screen buffer. The query
      // text rendered here IS on screen — /foo matches its own 'foo' in
      // the bar. With no content matches that's the ONLY visible match →
      // gets CURRENT → underlined. noSelect makes searchHighlight.ts:76
      // skip these cells (same exclusion as gutters). You can't text-
      // select the bar either; it's transient chrome, fine.
      noSelect
    >
      <Text>/</Text>
      <Text>{query.slice(0, off)}</Text>
      <Text inverse>{cursorChar}</Text>
      {off < query.length && <Text>{query.slice(off + 1)}</Text>}
      <Box flexGrow={1} />
      {indexStatus === 'building' ? (
        <Text dimColor>indexing… </Text>
      ) : indexStatus ? (
        <Text dimColor>indexed in {indexStatus.ms}ms </Text>
      ) : count === 0 && query ? (
        <Text color="error">no matches </Text>
      ) : count > 0 ? (
        // Engine-counted (indexOf on extractSearchText). May drift from
        // render-count for ghost/phantom messages — badge is a rough
        // location hint. scanElement gives exact per-message positions
        // but counting ALL would cost ~1-3ms × matched-messages.
        <Text dimColor>
          {current}/{count}
          {'  '}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Sets the terminal tab title with the same rotating-circle prefix and frame
 * rate as the main spinner while a query is running. Keeping the animation in
 * this leaf component avoids re-rendering the full REPL on every frame.
 */
function AnimatedTerminalTitle({
  isAnimating,
  title,
  disabled,
  noPrefix,
}: {
  isAnimating: boolean;
  title: string;
  disabled: boolean;
  noPrefix: boolean;
}): null {
  const terminalFocused = useTerminalFocus();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (disabled || noPrefix || !isAnimating || !terminalFocused) return;
    const interval = setInterval(
      setFrame => setFrame(f => (f + 1) % MODEL_SPINNER_FRAMES.length),
      MODEL_SPINNER_FRAME_MS,
      setFrame,
    );
    return () => clearInterval(interval);
  }, [disabled, noPrefix, isAnimating, terminalFocused]);
  const animatedTitle = `${MODEL_SPINNER_FRAMES[frame] ?? MODEL_SPINNER_FRAMES[0]} ${title}`;
  useTerminalTitle(disabled ? null : !noPrefix && isAnimating ? animatedTitle : title);
  return null;
}

export type Props = {
  commands: Command[];
  debug: boolean;
  initialTools: Tool[];
  // Initial messages to populate the REPL with
  initialMessages?: MessageType[];
  // Deferred hook messages promise — REPL renders immediately and injects
  // hook messages when they resolve. Awaited before the first API call.
  pendingHookMessages?: Promise<HookResultMessage[]>;
  initialFileHistorySnapshots?: FileHistorySnapshot[];
  // Content-replacement records from a resumed session's transcript — used to
  // reconstruct contentReplacementState so the same results are re-replaced
  initialContentReplacements?: ContentReplacementRecord[];
  // Initial agent context for session resume (name/color set via /rename or /color)
  initialAgentName?: string;
  initialAgentColor?: AgentColorName;
  mcpClients?: MCPServerConnection[];
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  strictMcpConfig?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  // Optional callback invoked before query execution
  // Called after user message is added to conversation but before API call
  // Return false to prevent query execution
  onBeforeQuery?: (input: string, newMessages: MessageType[]) => Promise<boolean>;
  // Optional callback when a turn completes (model finishes responding)
  onTurnComplete?: (messages: MessageType[]) => void | Promise<void>;
  // When true, disables REPL input (hides prompt and prevents message selector)
  disabled?: boolean;
  // Optional agent definition to use for the main thread
  mainThreadAgentDefinition?: AgentDefinition;
  // When true, disables all slash commands
  disableSlashCommands?: boolean;
  // Task list id: when set, enables tasks mode that watches a task list and auto-processes tasks.
  taskListId?: string;
  // Thinking configuration to use when thinking is enabled
  thinkingConfig: ThinkingConfig;
};

export type Screen = 'prompt' | 'transcript';

// Boilerplate carrier lives in a mixed user message ([tool_result..., text])
// that AgentTool/forkSubagent.buildForkedMessages emits as the fork child's
// first user turn. The text block wraps <FORK_BOILERPLATE_TAG>...</..> + the
// user prompt; tool_result siblings keep the parent's tool calls closed.
const FORK_BOILERPLATE_OPEN_TAG = `<${FORK_BOILERPLATE_TAG}>`;

function isForkBoilerplateTextBlock(block: { type: string; text?: string }): boolean {
  return block.type === 'text' && typeof block.text === 'string' && block.text.includes(FORK_BOILERPLATE_OPEN_TAG);
}

function isForkBoilerplateMessage(message: MessageType): boolean {
  if (message.type !== 'user' || !Array.isArray(message.message?.content)) return false;
  return message.message.content.some(isForkBoilerplateTextBlock);
}

export function REPL({
  commands: initialCommands,
  debug,
  initialTools,
  initialMessages,
  pendingHookMessages,
  initialFileHistorySnapshots,
  initialContentReplacements,
  initialAgentName: _initialAgentName,
  initialAgentColor: _initialAgentColor,
  mcpClients: initialMcpClients,
  dynamicMcpConfig: initialDynamicMcpConfig,
  strictMcpConfig = false,
  systemPrompt: customSystemPrompt,
  appendSystemPrompt,
  onBeforeQuery,
  onTurnComplete,
  disabled = false,
  mainThreadAgentDefinition: initialMainThreadAgentDefinition,
  disableSlashCommands = false,
  taskListId,
  thinkingConfig,
}: Props): React.ReactNode {
  // Env-var gates hoisted to mount-time — isEnvTruthy does toLowerCase+trim+
  // includes, and these were on the render path (hot during PageUp spam).
  const titleDisabled = useMemo(() => isEnvTruthy(process.env.SOPHIA_DISABLE_TERMINAL_TITLE), []);
  const moreRightEnabled = useMemo(
    () => process.env.USER_TYPE === 'ant' && isEnvTruthy(process.env.CLAUDE_MORERIGHT),
    [],
  );
  const disableVirtualScroll = useMemo(() => isEnvTruthy(process.env.SOPHIA_DISABLE_VIRTUAL_SCROLL), []);
  const disableMessageActionsRaw = useMemo(() => isEnvTruthy(process.env.SOPHIA_DISABLE_MESSAGE_ACTIONS), []);
  const disableMessageActions = feature('MESSAGE_ACTIONS') ? disableMessageActionsRaw : false;

  // Log REPL mount/unmount lifecycle
  useEffect(() => {
    logForDebugging(`[REPL:mount] REPL mounted, disabled=${disabled}`);
    return () => logForDebugging(`[REPL:unmount] REPL unmounting`);
  }, [disabled]);

  // Agent definition is state so /resume can update it mid-session
  const [mainThreadAgentDefinition, setMainThreadAgentDefinition] = useState(initialMainThreadAgentDefinition);

  const toolSafetyContext = useAppState(s => s.toolSafetyContext);
  const verbose = useAppState(s => s.verbose);
  const mcp = useAppState(s => s.mcp);
  const plugins = useAppState(s => s.plugins);
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const fileHistory = useAppState(s => s.fileHistory);
  const initialMessage = useAppState(s => s.initialMessage);
  const queuedCommands = useCommandQueue();
  // feature() is a build-time constant — dead code elimination removes the hook
  // call entirely in external builds, so this is safe despite looking conditional.
  // These fields contain excluded strings that must not appear in external builds.
  const spinnerTip = useAppState(s => s.spinnerTip);
  const showExpandedTodos = useAppState(s => s.expandedView) === 'tasks';
  const pendingSandboxRequest = useAppState(s => s.pendingSandboxRequest);
  const teamContext = useAppState(s => s.teamContext);
  const tasks = useAppState(s => s.tasks);
  const workerSandboxPermissions = useAppState(s => s.workerSandboxPermissions);
  const elicitation = useAppState(s => s.elicitation);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const setAppState = useSetAppState();

  // Bootstrap: retained local_agent that hasn't loaded disk yet → read
  // sidechain JSONL and UUID-merge with whatever stream has appended so far.
  // Stream appends immediately on retain (no defer); bootstrap fills the
  // prefix. Disk-write-before-yield means live is always a suffix of disk.
  const viewedLocalAgent = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const needsBootstrap = isLocalAgentTask(viewedLocalAgent) && viewedLocalAgent.retain && !viewedLocalAgent.diskLoaded;
  useEffect(() => {
    if (!viewingAgentTaskId || !needsBootstrap) return;
    const taskId = viewingAgentTaskId;
    void getAgentTranscript(asAgentId(taskId)).then(result => {
      setAppState(prev => {
        const t = prev.tasks[taskId];
        if (!isLocalAgentTask(t) || t.diskLoaded || !t.retain) return prev;
        const live = t.messages ?? [];
        const liveUuids = new Set(live.map(m => m.uuid));
        const diskOnly = result ? result.messages.filter(m => !liveUuids.has(m.uuid)) : [];
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [taskId]: {
              ...t,
              messages: [...diskOnly, ...live],
              diskLoaded: true,
            },
          },
        };
      });
    });
  }, [viewingAgentTaskId, needsBootstrap, setAppState]);

  const store = useAppStateStore();
  const terminal = useTerminalNotification();
  const mainLoopModel = useMainLoopModel();

  // Note: standaloneAgentContext is initialized in main.tsx (via initialState) or
  // ResumeConversation.tsx (via setAppState before rendering REPL) to avoid
  // useEffect-based state initialization on mount (per SOPHIA.md guidelines)

  // Local state for commands (hot-reloadable when skill files change)
  const [localCommands, setLocalCommands] = useState(initialCommands);

  // Watch for skill file changes and reload all commands
  useSkillsChange(getProjectRoot(), setLocalCommands);

  const localTools = useMemo(() => getTools(toolSafetyContext), [toolSafetyContext]);

  const [dynamicMcpConfig, setDynamicMcpConfig] = useState<Record<string, ScopedMcpServerConfig> | undefined>(
    initialDynamicMcpConfig,
  );

  const onChangeDynamicMcpConfig = useCallback(
    (config: Record<string, ScopedMcpServerConfig>) => {
      setDynamicMcpConfig(config);
    },
    [setDynamicMcpConfig],
  );

  const [screen, setScreen] = useState<Screen>('prompt');
  const [showAllInTranscript, setShowAllInTranscript] = useState(false);
  // [ forces the dump-to-scrollback path inside transcript mode. Separate
  // from SOPHIA_NO_FLICKER=0 (which is process-lifetime) — this is
  // ephemeral, reset on transcript exit. Diagnostic escape hatch so
  // terminal/tmux native cmd-F can search the full flat render.
  const [dumpMode, setDumpMode] = useState(false);
  // v-for-editor render progress. Inline in the footer — notifications
  // render inside PromptInput which isn't mounted in transcript.
  const [editorStatus, setEditorStatus] = useState('');
  // Incremented on transcript exit. Async v-render captures this at start;
  // each status write no-ops if stale (user left transcript mid-render —
  // the stable setState would otherwise stamp a ghost toast into the next
  // session). Also clears any pending 4s auto-clear.
  const editorGenRef = useRef(0);
  const editorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRenderingRef = useRef(false);
  const { addNotification, removeNotification } = useNotifications();

  const mcpClients = useMergedClients(initialMcpClients, mcp.clients);

  // IDE integration
  const [ideSelection, setIDESelection] = useState<IDESelection | undefined>(undefined);
  // Dead code elimination: model switch callout state (ant-only)
  const [showModelSwitchCallout, setShowModelSwitchCallout] = useState(() => {
    if (process.env.USER_TYPE === 'ant') {
      return shouldShowAntModelSwitch();
    }
    return false;
  });
  // notifications
  useMcpConnectivityStatus({ mcpClients });
  usePluginInstallationStatus();
  usePluginAutoupdateNotification();
  useSettingsErrors();
  useNpmDeprecationNotification();
  useAntOrgWarningNotification();
  useInstallMessages();
  useLspInitializationNotification();
  useTeammateLifecycleNotification();

  // Memoize the combined initial tools array to prevent reference changes
  const combinedInitialTools = useMemo(() => {
    return [...localTools, ...initialTools];
  }, [localTools, initialTools]);

  // Initialize plugin management
  useManagePlugins({ enabled: true });

  const tasksV2 = useTasksV2WithCollapseEffect();

  // Start background plugin installations

  // SECURITY: This code is guaranteed to run ONLY after the "trust this folder" dialog
  // has been confirmed by the user. The trust dialog is shown in cli.tsx (line ~387)
  // before the REPL component is rendered. The dialog blocks execution until the user
  // accepts, and only then is the REPL component mounted and this effect runs.
  // This ensures that plugin installations from repository and user settings only
  // happen after explicit user consent to trust the current working directory.
  useEffect(() => {
    void performStartupChecks(setAppState);
  }, [setAppState]);

  // Initialize swarm features: teammate hooks and context
  // Handles both fresh spawns and resumed teammate sessions
  useSwarmInitialization(setAppState, initialMessages, {
    enabled: true,
  });

  const mergedTools = useMergedTools(combinedInitialTools, mcp.tools, toolSafetyContext);

  // Apply agent tool restrictions if mainThreadAgentDefinition is set
  const { tools, allowedAgentTypes } = useMemo(() => {
    if (!mainThreadAgentDefinition) {
      return {
        tools: mergedTools,
        allowedAgentTypes: undefined as string[] | undefined,
      };
    }
    const resolved = resolveAgentTools(mainThreadAgentDefinition, mergedTools, false, true);
    return {
      tools: resolved.resolvedTools,
      allowedAgentTypes: resolved.allowedAgentTypes,
    };
  }, [mainThreadAgentDefinition, mergedTools]);

  // Merge commands from local state, plugins, and MCP
  const commandsWithPlugins = useMergedCommands(localCommands, plugins.commands as Command[]);
  const mergedCommands = useMergedCommands(commandsWithPlugins, mcp.commands as Command[]);
  // Filter out all commands if disableSlashCommands is true
  const commands = useMemo(() => (disableSlashCommands ? [] : mergedCommands), [disableSlashCommands, mergedCommands]);

  useIdeLogging(mcp.clients);
  useIdeSelection(mcp.clients, setIDESelection);

  const [streamMode, setStreamMode] = useState<SpinnerMode>('responding');
  // Ref mirror so onSubmit can read the latest value without adding
  // streamMode to its deps. streamMode flips between
  // requesting/responding/tool-use ~10x per turn during streaming; having it
  // in onSubmit's deps was recreating onSubmit on every flip, which
  // cascaded into PromptInput prop churn and downstream useCallback/useMemo
  // invalidation. The only consumers inside callbacks are debug logging and
  // telemetry (handlePromptSubmit.ts), so a stale-by-one-render value is
  // harmless — but ref mirrors sync on every render anyway so it's fresh.
  const streamModeRef = useRef(streamMode);
  streamModeRef.current = streamMode;
  const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
  const [streamingThinking, setStreamingThinking] = useState<StreamingThinking | null>(null);

  // Auto-hide streaming thinking after 30 seconds of being completed
  useEffect(() => {
    if (streamingThinking && !streamingThinking.isStreaming && streamingThinking.streamingEndedAt) {
      const elapsed = Date.now() - streamingThinking.streamingEndedAt;
      const remaining = 30000 - elapsed;
      if (remaining > 0) {
        const timer = setTimeout(setStreamingThinking, remaining, null);
        return () => clearTimeout(timer);
      } else {
        setStreamingThinking(null);
      }
    }
  }, [streamingThinking]);

  const [abortController, setAbortController] = useState<AbortController | null>(null);
  // Ref that always points to the current abort controller, used by the
  // REPL bridge to abort the active query when a remote interrupt arrives.
  const abortControllerRef = useRef<AbortController | null>(null);
  abortControllerRef.current = abortController;

  // Timestamp (ms) of the most recent local-jsx panel dismissal (for example,
  // ESC on /tasks). Used by onCancel's grace-period guard: the ESC that closes
  // a local-jsx panel (or any quick follow-up ESC within the grace window)
  // must not fall through to abortController.abort('user-cancel') — otherwise
  // closing the task panel via ESC would kill an in-flight Workflow
  // tool. The chat:cancel keybinding's isActive gate (`!isLocalJSXCommand`)
  // only shields the panel while it's mounted; once React commits the
  // unmount, the next ESC reaches onCancel unguarded. This ref closes that
  // race without touching keybinding registration order.
  const LOCAL_JSX_CLOSE_CANCEL_GRACE_MS = 500;
  const localJSXClosedAtRef = useRef(0);

  // Ref for the bridge result callback — set after useReplBridge initializes,
  // read in the onQuery finally block to notify mobile clients that a turn ended.

  // Ref for the synchronous restore callback — set after restoreMessageSync is
  // defined, read in the onQuery finally block for auto-restore on interrupt.
  const restoreMessageSyncRef = useRef<(m: UserMessage) => void>(() => {});

  // Ref to the fullscreen layout's scroll box for keyboard scrolling.
  // Null when fullscreen mode is disabled (ref never attached).
  const scrollRef = useRef<ScrollBoxHandle>(null);
  // Separate ref for the modal slot's inner ScrollBox — passed through
  // FullscreenLayout → ModalContext so Tabs can attach it to its own
  // ScrollBox for tall content (e.g. /status's MCP-server list). NOT
  // keyboard-driven — ScrollKeybindingHandler stays on the outer ref so
  // PgUp/PgDn/wheel always scroll the transcript behind the modal.
  // Plumbing kept for future modal-scroll wiring.
  const modalScrollRef = useRef<ScrollBoxHandle>(null);
  // Timestamp of the last user-initiated scroll (wheel, PgUp/PgDn, ctrl+u,
  // End/Home, G, drag-to-scroll). Stamped in composedOnScroll — the single
  // chokepoint ScrollKeybindingHandler calls for every user scroll action.
  // Programmatic scrolls (repinScroll's scrollToBottom, sticky auto-follow)
  // do NOT go through composedOnScroll, so they don't stamp this. Ref not
  // state: no re-render on every wheel tick.
  const lastUserScrollTsRef = useRef(0);

  // Synchronous state machine for the query lifecycle. Replaces the
  // error-prone dual-state pattern where isLoading (React state, async
  // batched) and isQueryRunning (ref, sync) could desync. See QueryGuard.ts.
  const queryGuard = React.useRef(new QueryGuard()).current;

  // Subscribe to the guard — true during dispatching or running.
  // This is the single source of truth for "is a local query in flight".
  const isQueryActive = React.useSyncExternalStore(queryGuard.subscribe, queryGuard.getSnapshot);

  // SSH operations do not route through the local query guard, so they need
  // a separate spinner-visibility state.
  const [isExternalLoading, setIsExternalLoadingRaw] = React.useState(false);

  // Derived: any loading source active. Read-only — no setter. Local query
  // loading is driven by queryGuard (reserve/tryStart/end/cancelReservation),
  // external loading by setIsExternalLoading.
  const isLoading = isQueryActive || isExternalLoading;

  // Elapsed time is computed by SpinnerWithVerb from these refs on each
  // animation frame, avoiding a useInterval that re-renders the entire REPL.
  const [userInputOnProcessing, setUserInputOnProcessingRaw] = React.useState<string | undefined>(undefined);
  // Wall-clock time tracking refs for accurate elapsed time calculation
  const loadingStartTimeRef = React.useRef<number>(0);
  const totalPausedMsRef = React.useRef(0);
  const pauseStartTimeRef = React.useRef<number | null>(null);
  const resetTimingRefs = React.useCallback(() => {
    loadingStartTimeRef.current = Date.now();
    totalPausedMsRef.current = 0;
    pauseStartTimeRef.current = null;
  }, []);

  // Reset timing refs inline when isQueryActive transitions false→true.
  // queryGuard.reserve() (in executeUserInput) fires BEFORE processUserInput's
  // first await, but the ref reset in onQuery's try block runs AFTER. During
  // that gap, React renders the spinner with loadingStartTimeRef=0, computing
  // elapsedTimeMs = Date.now() - 0 ≈ 56 years. This inline reset runs on the
  // first render where isQueryActive is observed true — the same render that
  // first shows the spinner — so the ref is correct by the time the spinner
  // reads it. See INC-4549.
  const wasQueryActiveRef = React.useRef(false);
  if (isQueryActive && !wasQueryActiveRef.current) {
    resetTimingRefs();
  }
  wasQueryActiveRef.current = isQueryActive;

  // Wrapper for setIsExternalLoading that resets timing refs on transition
  // to true — SpinnerWithVerb reads these for elapsed time, so they must be
  // reset for SSH sessions too (not just local queries, which reset them in
  // onQuery). Without this, a remote-only
  // session would show ~56 years elapsed (Date.now() - 0).
  const setIsExternalLoading = React.useCallback(
    (value: boolean) => {
      setIsExternalLoadingRaw(value);
      if (value) resetTimingRefs();
    },
    [resetTimingRefs],
  );

  // Start time of the first turn that had swarm teammates running
  // Used to compute total elapsed time (including teammate execution) for the deferred message
  const swarmStartTimeRef = React.useRef<number | null>(null);
  const swarmBudgetInfoRef = React.useRef<{ tokens: number; limit: number; nudges: number } | undefined>(undefined);

  // Ref to track current focusedInputDialog for use in callbacks
  // This avoids stale closures when checking dialog state in timer callbacks
  const focusedInputDialogRef = React.useRef<ReturnType<typeof getFocusedInputDialog>>(undefined);

  // How long after the last keystroke before deferred dialogs are shown
  const PROMPT_SUPPRESSION_MS = 1500;
  // True when user is actively typing — defers interrupt dialogs so keystrokes
  // don't accidentally dismiss or answer a permission prompt the user hasn't read yet.
  const [isPromptInputActive, setIsPromptInputActive] = React.useState(false);

  // tmux + fullscreen + `mouse off`: one-time hint that wheel won't scroll.
  // We no longer mutate tmux's session-scoped mouse option (it poisoned
  // sibling panes); tmux users already know this tradeoff from vim/less.
  useEffect(() => {
    if (isFullscreenEnvEnabled()) {
      void maybeGetTmuxMouseHint().then(hint => {
        if (hint) {
          addNotification({
            key: 'tmux-mouse-hint',
            text: hint,
            priority: 'low',
          });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showUndercoverCallout, setShowUndercoverCallout] = useState(false);
  useEffect(() => {
    if (process.env.USER_TYPE === 'ant') {
      void (async () => {
        // Wait for repo classification to settle (memoized, no-op if primed).
        const { isInternalModelRepo } = await import('../utils/commitAttribution.js');
        await isInternalModelRepo();
        const { shouldShowUndercoverAutoNotice } = await import('../utils/undercover.js');
        if (shouldShowUndercoverAutoNotice()) {
          setShowUndercoverCallout(true);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [toolJSX, setToolJSXInternal] = useState<{
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
    showSpinner?: boolean;
    isLocalJSXCommand?: boolean;
    isImmediate?: boolean;
  } | null>(null);

  // Track local JSX commands separately so tools can't overwrite them.
  // This enables immediate command dialogs to persist while Sophia is processing.
  const localJSXCommandRef = useRef<{
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
    showSpinner?: boolean;
    isLocalJSXCommand: true;
  } | null>(null);

  // Wrapper for setToolJSX that preserves immediate command dialogs.
  // When a local JSX command is active, we ignore updates from tools
  // unless they explicitly set clearLocalJSX: true (from onDone callbacks).
  //
  // TO ADD A NEW IMMEDIATE COMMAND:
  // 1. Set `immediate: true` in the command definition
  // 2. Set `isLocalJSXCommand: true` when calling setToolJSX in the command's JSX
  // 3. In the onDone callback, use `setToolJSX({ jsx: null, shouldHidePromptInput: false, clearLocalJSX: true })`
  //    to explicitly clear the overlay when the user dismisses it
  const setToolJSX = useCallback(
    (
      args: {
        jsx: React.ReactNode | null;
        shouldHidePromptInput: boolean;
        shouldContinueAnimation?: true;
        showSpinner?: boolean;
        isLocalJSXCommand?: boolean;
        clearLocalJSX?: boolean;
      } | null,
    ) => {
      // If setting a local JSX command, store it in the ref
      if (args?.isLocalJSXCommand) {
        const { clearLocalJSX: _, ...rest } = args;
        localJSXCommandRef.current = { ...rest, isLocalJSXCommand: true };
        setToolJSXInternal(rest);
        return;
      }

      // If there's an active local JSX command in the ref
      if (localJSXCommandRef.current) {
        // Allow clearing only if explicitly requested (from onDone callbacks)
        if (args?.clearLocalJSX) {
          localJSXCommandRef.current = null;
          setToolJSXInternal(null);
          // Stamp the dismissal so onCancel's grace-period guard can swallow
          // the ESC that just dismissed the panel (and any quick follow-up).
          localJSXClosedAtRef.current = Date.now();
          return;
        }
        // Otherwise, keep the local JSX command visible - ignore tool updates
        return;
      }

      // No active local JSX command, allow any update
      if (args?.clearLocalJSX) {
        setToolJSXInternal(null);
        return;
      }
      setToolJSXInternal(args);
    },
    [],
  );
  const [userQuestionQueue, setUserQuestionQueue] = useState<UserQuestionRequest[]>([]);
  const [sandboxPermissionRequestQueue, setSandboxPermissionRequestQueue] = useState<
    Array<{
      hostPattern: NetworkHostPattern;
      resolvePromise: (allowConnection: boolean) => void;
    }>
  >([]);
  const [promptQueue, setPromptQueue] = useState<
    Array<{
      request: PromptRequest;
      title: string;
      toolInputSummary?: string | null;
      resolve: (response: PromptResponse) => void;
      reject: (error: Error) => void;
    }>
  >([]);

  // Track bridge cleanup functions for sandbox permission requests so the
  // local dialog handler can cancel the remote prompt when the local user
  // responds first. Keyed by host to support concurrent same-host requests.

  // -- Terminal title management
  // Session title (set via /rename or restored on resume) wins over
  // the agent name, which wins over the Haiku-extracted topic;
  // all fall back to the product name.
  const terminalTitleFromRename = useAppState(s => s.settings.terminalTitleFromRename) !== false;
  const sessionTitle = terminalTitleFromRename ? getCurrentSessionTitle(getSessionId()) : undefined;
  const [haikuTitle, setHaikuTitle] = useState<string>();
  // Gates the one-shot Haiku call that generates the tab title. Seeded true
  // on resume (initialMessages present) so we don't re-title a resumed
  // session from mid-conversation context.
  const haikuTitleAttemptedRef = useRef((initialMessages?.length ?? 0) > 0);
  const agentTitle = mainThreadAgentDefinition?.agentType;
  const terminalTitle = sessionTitle ?? agentTitle ?? haikuTitle ?? 'Sophia Agent';
  const isWaitingForInput = userQuestionQueue.length > 0 || promptQueue.length > 0 || pendingSandboxRequest;
  // Local-jsx commands (such as /config and /tasks) show user-facing dialogs that
  // wait for input. Require jsx != null — if the flag is stuck true but jsx
  // is null, treat as not-showing so TextInput focus and queue processor
  // aren't deadlocked by a phantom overlay.
  const isShowingLocalJSXCommand = toolJSX?.isLocalJSXCommand === true && toolJSX?.jsx != null;
  const titleIsAnimating = isLoading && !isWaitingForInput && !isShowingLocalJSXCommand;
  // Title animation state lives in <AnimatedTerminalTitle> so its tick
  // doesn't re-render REPL. titleDisabled/terminalTitle are still computed
  // here because onQueryImpl reads them for the title extraction gate.

  // Prevent macOS from sleeping while Claude is working
  useEffect(() => {
    if (isLoading && !isWaitingForInput && !isShowingLocalJSXCommand) {
      startPreventSleep();
      return () => stopPreventSleep();
    }
  }, [isLoading, isWaitingForInput, isShowingLocalJSXCommand]);

  const sessionStatus: TabStatusKind =
    isWaitingForInput || isShowingLocalJSXCommand ? 'waiting' : isLoading ? 'busy' : 'idle';

  const waitingFor =
    sessionStatus !== 'waiting'
      ? undefined
      : userQuestionQueue.length > 0
        ? 'answer question'
        : pendingSandboxRequest
          ? 'sandbox request'
          : isShowingLocalJSXCommand
            ? 'dialog open'
            : 'input needed';

  // Push status to the PID file for `sophia ps`. Fire-and-forget; ps falls
  // back to transcript-tail derivation when this is missing/stale.
  // 3P default: off — OSC 21337 is ant-only while the spec stabilizes.
  // Gated so we can roll back if the sidebar indicator conflicts with
  // the title spinner in terminals that render both. When the flag is
  // on, the user-facing config setting controls whether it's active.
  const tabStatusGateEnabled = getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_sidebar', false);
  const showStatusInTerminalTab = tabStatusGateEnabled && (getGlobalConfig().showStatusInTerminalTab ?? false);
  useTabStatus(titleDisabled || !showStatusInTerminalTab ? null : sessionStatus);

  const [messages, rawSetMessages] = useState<MessageType[]>(initialMessages ?? []);
  const messagesRef = useRef(messages);
  // Stores the willowMode variant that was shown (or false if no hint shown).
  // Captured at hint_shown time so hint_converted telemetry reports the same
  // variant — the GrowthBook value shouldn't change mid-session, but reading
  // it once guarantees consistency between the paired events.
  const idleHintShownRef = useRef<string | false>(false);
  // Wrap setMessages so messagesRef is always current the instant the
  // call returns — not when React later processes the batch.  Apply the
  // updater eagerly against the ref, then hand React the computed value
  // (not the function).  rawSetMessages batching becomes last-write-wins,
  // and the last write is correct because each call composes against the
  // already-updated ref.  This is the Zustand pattern: ref is source of
  // truth, React state is the render projection.  Without this, paths
  // that queue functional updaters then synchronously read the ref see stale data.
  const setMessages = useCallback((action: React.SetStateAction<MessageType[]>) => {
    const next = typeof action === 'function' ? action(messagesRef.current) : action;
    messagesRef.current = next;
    rawSetMessages(next);
  }, []);
  const setUserInputOnProcessing = useCallback((input: string | undefined) => {
    setUserInputOnProcessingRaw(input);
  }, []);
  // Fullscreen: track the unseen-divider position. dividerIndex changes
  // only ~twice/scroll-session (first scroll-away + repin). pillVisible
  // and stickyPrompt now live in FullscreenLayout — they subscribe to
  // ScrollBox directly so per-frame scroll never re-renders REPL.
  const { dividerIndex, dividerYRef, onScrollAway, onRepin, jumpToNew } = useUnseenDivider(messages.length);
  if (feature('AWAY_SUMMARY')) {
    useAwaySummary(messages, setMessages, isLoading);
  }
  const [cursor, setCursor] = useState<MessageActionsState | null>(null);
  const cursorNavRef = useRef<MessageActionsNav | null>(null);
  // Memoized so Messages' React.memo holds.
  const unseenDivider = useMemo(
    () => computeUnseenDivider(messages, dividerIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- length change covers appends; useUnseenDivider's count-drop guard clears dividerIndex on replace/rewind
    [dividerIndex, messages.length],
  );
  // Re-pin scroll to bottom and clear the unseen-messages baseline. Called
  // on any user-driven return-to-live action (submit, type-into-empty,
  // overlay appear/dismiss).
  const repinScroll = useCallback(() => {
    scrollRef.current?.scrollToBottom();
    onRepin();
    setCursor(null);
  }, [onRepin, setCursor]);
  // Backstop for the submit-handler repin at onSubmit. If a buffered stdin
  // event (wheel/drag) races between handler-fire and state-commit, the
  // handler's scrollToBottom can be undone. This effect fires on the render
  // where the user's message actually lands — tied to React's commit cycle,
  // so it can't race with stdin. Keyed on lastMsg identity rather than length.
  const lastMsg = messages.at(-1);
  const lastMsgIsHuman = lastMsg != null && isHumanTurn(lastMsg);
  useEffect(() => {
    if (lastMsgIsHuman) {
      repinScroll();
    }
  }, [lastMsgIsHuman, lastMsg, repinScroll]);
  const composedOnScroll = useCallback(
    (sticky: boolean, handle: ScrollBoxHandle) => {
      lastUserScrollTsRef.current = Date.now();
      if (sticky) {
        onRepin();
      } else {
        onScrollAway(handle);
      }
    },
    [onRepin, onScrollAway],
  );
  // Deferred SessionStart hook messages — REPL renders immediately and
  // hook messages are injected when they resolve. awaitPendingHooks()
  // must be called before the first API call so the model sees hook context.
  const awaitPendingHooks = useDeferredHookMessages(pendingHookMessages, setMessages);

  // Deferred messages for the Messages component — renders at transition
  // priority so the reconciler yields every 5ms, keeping input responsive
  // while the expensive message processing pipeline runs.
  // Cap at 500 messages to limit memory double-buffering. The bypass
  // at display-time uses sync messages during streaming and non-loading,
  // so this cap only affects reduced-motion scenarios.
  const DEFERRED_CAP = 500;
  const cappedMessages = React.useMemo(
    () => (messages.length > DEFERRED_CAP ? messages.slice(-DEFERRED_CAP) : messages),
    [messages],
  );
  const deferredMessages = useDeferredValue(cappedMessages);
  const deferredBehind = messages.length - deferredMessages.length;
  if (deferredBehind > 0) {
    logForDebugging(
      `[useDeferredValue] Messages deferred by ${deferredBehind} (${deferredMessages.length}→${messages.length})`,
    );
  }

  // Frozen state for transcript mode - stores lengths instead of cloning arrays for memory efficiency
  const [frozenTranscriptState, setFrozenTranscriptState] = useState<{
    messagesLength: number;
    streamingToolUsesLength: number;
  } | null>(null);
  // Initialize input with any early input that was captured before REPL was ready.
  // Using lazy initialization ensures cursor offset is set correctly in PromptInput.
  const [inputValue, setInputValueRaw] = useState(() => consumeEarlyInput());
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const insertTextRef = useRef<{
    insert: (text: string) => void;
    setInputWithCursor: (value: string, cursor: number) => void;
    cursorOffset: number;
  } | null>(null);

  // Wrap setInputValue to co-locate suppression state updates.
  // Both setState calls happen in the same synchronous context so React
  // batches them into a single render, eliminating the extra render that
  // the previous useEffect → setState pattern caused.
  const setInputValue = useCallback(
    (value: string) => {
      // In fullscreen mode, typing into an empty prompt re-pins scroll to
      // bottom. Only fires on empty→non-empty so scrolling up to reference
      // something while composing a message doesn't yank the view back on
      // every keystroke. Restores the pre-fullscreen muscle memory of
      // typing to snap back to the end of the conversation.
      // Skipped if the user scrolled within the last 3s — they're actively
      // reading, not lost. lastUserScrollTsRef starts at 0 so the first-
      // ever keypress (no scroll yet) always repins.
      if (
        inputValueRef.current === '' &&
        value !== '' &&
        Date.now() - lastUserScrollTsRef.current >= RECENT_SCROLL_REPIN_WINDOW_MS
      ) {
        repinScroll();
      }
      // Sync ref immediately (like setMessages) so callers that read
      // inputValueRef before React commits — e.g. the auto-restore finally
      // block's `=== ''` guard — see the fresh value, not the stale render.
      inputValueRef.current = value;
      setInputValueRaw(value);
      setIsPromptInputActive(value.trim().length > 0);
    },
    [setIsPromptInputActive, repinScroll],
  );

  // Schedule a timeout to stop suppressing dialogs after the user stops typing.
  // Only manages the timeout — the immediate activation is handled by setInputValue above.
  useEffect(() => {
    if (inputValue.trim().length === 0) return;
    const timer = setTimeout(setIsPromptInputActive, PROMPT_SUPPRESSION_MS, false);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const [inputMode, setInputMode] = useState<PromptInputMode>('prompt');
  const [stashedPrompt, setStashedPrompt] = useState<
    | {
        text: string;
        cursorOffset: number;
        pastedContents: Record<number, PastedContent>;
      }
    | undefined
  >();

  const [inProgressToolUseIDs, setInProgressToolUseIDs] = useState<Set<string>>(new Set());
  const hasInterruptibleToolInProgressRef = useRef(false);

  // Direct connect hook - manages WebSocket to a sophia server for `sophia connect` mode

  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
  const [submitCount, setSubmitCount] = useState(0);
  // Ref instead of state to avoid triggering React re-renders on every
  // streaming text_delta. The spinner reads this via its animation timer.
  const responseLengthRef = useRef(0);
  const compactProgressActiveRef = useRef(false);
  // API performance metrics ref for ant-only spinner display (TTFT/OTPS).
  // Accumulates metrics from all API requests in a turn for P50 aggregation.
  const apiMetricsRef = useRef<
    Array<{
      ttftMs: number;
      firstTokenTime: number;
      lastTokenTime: number;
      responseLengthBaseline: number;
      // Tracks responseLengthRef at the time of the last content addition.
      // Updated by both streaming deltas and subagent message content.
      // lastTokenTime is also updated at the same time, so the OTPS
      // denominator correctly includes subagent processing time.
      endResponseLength: number;
    }>
  >([]);
  const setResponseLength = useCallback((f: (prev: number) => number) => {
    const prev = responseLengthRef.current;
    responseLengthRef.current = f(prev);
    // When content is added (not a compaction reset), update the latest
    // metrics entry so OTPS reflects all content generation activity.
    // Updating lastTokenTime here ensures the denominator includes both
    // streaming time AND subagent execution time, preventing inflation.
    if (responseLengthRef.current > prev) {
      const entries = apiMetricsRef.current;
      if (entries.length > 0) {
        const lastEntry = entries.at(-1)!;
        lastEntry.lastTokenTime = Date.now();
        lastEntry.endResponseLength = responseLengthRef.current;
      }
    }
  }, []);

  // Streaming text display: set state directly per delta (Ink's 16ms render
  // throttle batches rapid updates). Cleared on message arrival (messages.ts)
  // so displayedMessages switches from deferredMessages to messages atomically.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const reducedMotion = useAppState(s => s.settings.prefersReducedMotion) ?? false;
  const showStreamingText = !reducedMotion && !hasCursorUpViewportYankBug();
  const onStreamingText = useCallback(
    (f: (current: string | null) => string | null) => {
      if (!showStreamingText) return;
      setStreamingText(f);
    },
    [showStreamingText],
  );

  // Hide the in-progress source line so text streams line-by-line, not
  // char-by-char. lastIndexOf returns -1 when no newline, giving '' → null.
  // Guard on showStreamingText so toggling reducedMotion mid-stream
  // immediately hides the streaming preview.
  const visibleStreamingText =
    streamingText && showStreamingText ? streamingText.substring(0, streamingText.lastIndexOf('\n') + 1) || null : null;

  const [lastQueryCompletionTime, setLastQueryCompletionTime] = useState(0);
  const [spinnerMessage, setSpinnerMessage] = useState<string | null>(null);
  const [spinnerColor, setSpinnerColor] = useState<keyof Theme | null>(null);
  const [spinnerShimmerColor, setSpinnerShimmerColor] = useState<keyof Theme | null>(null);
  const [isMessageSelectorVisible, setIsMessageSelectorVisible] = useState(false);
  const [messageSelectorPreselect, setMessageSelectorPreselect] = useState<UserMessage | undefined>(undefined);
  const [conversationId, setConversationId] = useState(randomUUID());

  // Idle-return dialog: shown when user submits after a long idle gap
  const [idleReturnPending, setIdleReturnPending] = useState<{
    input: string;
    idleMinutes: number;
  } | null>(null);
  const skipIdleCheckRef = useRef(false);
  const lastQueryCompletionTimeRef = useRef(lastQueryCompletionTime);
  lastQueryCompletionTimeRef.current = lastQueryCompletionTime;

  // Aggregate tool result budget: per-conversation decision tracking.
  // When the GrowthBook flag is on, query.ts enforces the budget; when
  // off (undefined), enforcement is skipped entirely. Stale entries after
  // /clear, rewind, or compact are harmless (tool_use_ids are UUIDs, stale
  // keys are never looked up). Memory is bounded by total replacement count
  // × ~2KB preview over the REPL lifetime — negligible.
  //
  // Lazy init via useState initializer — useRef(expr) evaluates expr on every
  // render (React ignores it after first, but the computation still runs).
  // For large resumed sessions, reconstruction does O(messages × blocks)
  // work; we only want that once.
  const [contentReplacementStateRef] = useState(() => ({
    current: provisionContentReplacementState(initialMessages, initialContentReplacements),
  }));
  registerCompactCleanup(() => {
    contentReplacementStateRef.current = createContentReplacementState();
  });

  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  const [showBashesDialog, setShowBashesDialog] = useState<string | boolean>(false);
  const [isSearchingHistory, setIsSearchingHistory] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const [theme] = useTheme();

  // resetLoadingState runs twice per turn (onQueryImpl tail + onQuery finally).
  // Without this guard, both calls pick a tip → two recordShownTip → two
  // saveGlobalConfig writes back-to-back. Reset at submit in onSubmit.
  const tipPickedThisTurnRef = React.useRef(false);
  const pickNewSpinnerTip = useCallback(() => {
    if (tipPickedThisTurnRef.current) return;
    tipPickedThisTurnRef.current = true;
    const newMessages = messagesRef.current.slice(bashToolsProcessedIdx.current);
    for (const tool of extractBashToolsFromMessages(newMessages)) {
      bashTools.current.add(tool);
    }
    bashToolsProcessedIdx.current = messagesRef.current.length;
    void getTipToShowOnSpinner({
      theme,
      readFileState: readFileState.current,
      bashTools: bashTools.current,
    }).then(async tip => {
      if (tip) {
        const content = await tip.content({ theme });
        setAppState(prev => ({
          ...prev,
          spinnerTip: content,
        }));
        recordShownTip(tip);
      } else {
        setAppState(prev => {
          if (prev.spinnerTip === undefined) return prev;
          return { ...prev, spinnerTip: undefined };
        });
      }
    });
  }, [setAppState, theme]);

  // Resets UI loading state. Does NOT call onTurnComplete - that should be
  // called explicitly only when a query turn actually completes.
  const resetLoadingState = useCallback(() => {
    // isLoading is now derived from queryGuard — no setter call needed.
    // queryGuard.end() (onQuery finally) or cancelReservation() (executeUserInput
    // finally) have already transitioned the guard to idle by the time this runs.
    // External loading (remote/backgrounding) is reset separately by those hooks.
    setIsExternalLoading(false);
    setUserInputOnProcessing(undefined);
    responseLengthRef.current = 0;
    apiMetricsRef.current = [];
    setStreamingText(null);
    setStreamingToolUses([]);
    setSpinnerMessage(null);
    setSpinnerColor(null);
    setSpinnerShimmerColor(null);
    pickNewSpinnerTip();
    endInteractionSpan();
    // Speculative bash classifier checks are only valid for the current
    // turn's commands — clear after each turn to avoid accumulating
    // Promise chains for unconsumed checks (denied/aborted paths).
    clearSpeculativeChecks();
  }, [pickNewSpinnerTip]);

  const hasRunningTeammates = useMemo(
    () => getAllInProcessTeammateTasks(tasks).some(t => t.status === 'running'),
    [tasks],
  );

  // Show deferred turn duration message once all swarm teammates finish
  useEffect(() => {
    if (!hasRunningTeammates && swarmStartTimeRef.current !== null) {
      const totalMs = Date.now() - swarmStartTimeRef.current;
      const deferredBudget = swarmBudgetInfoRef.current;
      swarmStartTimeRef.current = null;
      swarmBudgetInfoRef.current = undefined;
      setMessages(prev => [
        ...prev,
        createTurnDurationMessage(
          totalMs,
          deferredBudget,
          // Count only what recordTranscript will persist — ephemeral
          // progress ticks and non-ant attachments are filtered by
          // isLoggableMessage and never reach disk. Using raw prev.length
          // would make checkResumeConsistency report false delta<0 for
          // every turn that ran a progress-emitting tool.
          count(prev, isLoggableMessage),
        ),
      ]);
    }
  }, [hasRunningTeammates, setMessages]);

  // If worktree creation was slow and sparse-checkout isn't configured,
  // nudge the user toward settings.worktree.sparsePaths.
  const worktreeTipShownRef = useRef(false);
  useEffect(() => {
    if (worktreeTipShownRef.current) return;
    const wt = getCurrentWorktreeSession();
    if (!wt?.creationDurationMs || wt.usedSparsePaths) return;
    if (wt.creationDurationMs < 15_000) return;
    worktreeTipShownRef.current = true;
    const secs = Math.round(wt.creationDurationMs / 1000);
    setMessages(prev => [
      ...prev,
      createSystemMessage(
        `Worktree creation took ${secs}s. For large repos, set \`worktree.sparsePaths\` in .sophia/settings.json to check out only the directories you need — e.g. \`{"worktree": {"sparsePaths": ["src", "packages/foo"]}}\`.`,
        'info',
      ),
    ]);
  }, [setMessages]);

  const {
    onBeforeQuery: mrOnBeforeQuery,
    onTurnComplete: mrOnTurnComplete,
    render: mrRender,
  } = useMoreRight({
    enabled: moreRightEnabled,
    setMessages,
    inputValue,
    setInputValue,
    setToolJSX,
  });

  const showSpinner =
    (!toolJSX || toolJSX.showSpinner === true) &&
    userQuestionQueue.length === 0 &&
    promptQueue.length === 0 &&
    // Show spinner during input processing, API call, while teammates are running,
    // or while pending task notifications are queued (prevents spinner bounce between consecutive notifications)
    (isLoading ||
      userInputOnProcessing ||
      hasRunningTeammates ||
      // Keep spinner visible while task notifications are queued for processing.
      // Without this, the spinner briefly disappears between consecutive notifications
      // (e.g., multiple background agents completing in rapid succession) because
      // isLoading goes false momentarily between processing each one.
      getCommandQueueLength() > 0) &&
    // Hide spinner when streaming text is visible (the text IS the feedback).
    !visibleStreamingText;

  const showIssueFlagBanner = useIssueFlagBanner(messages, submitCount);

  useFileHistorySnapshotInit(initialFileHistorySnapshots, fileHistory, fileHistoryState =>
    setAppState(prev => ({
      ...prev,
      fileHistory: fileHistoryState,
    })),
  );

  const resume = useCallback(
    async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
      const resumeStart = performance.now();
      try {
        // Deserialize messages to properly clean up the conversation
        // This filters unresolved tool uses and adds a synthetic assistant message if needed
        const messages = deserializeMessages(log.messages);

        // Fire SessionEnd hooks for the current session before starting the
        // resumed one, mirroring the /clear flow in conversation.ts.
        const sessionEndTimeoutMs = getSessionEndHookTimeoutMs();
        await executeSessionEndHooks('resume', {
          getAppState: () => store.getState(),
          setAppState,
          signal: AbortSignal.timeout(sessionEndTimeoutMs),
          timeoutMs: sessionEndTimeoutMs,
        });

        // Process session start hooks for resume
        const hookMessages = await processSessionStartHooks('resume', {
          sessionId,
          agentType: mainThreadAgentDefinition?.agentType,
          model: mainLoopModel,
        });

        // Append hook messages to the conversation
        messages.push(...hookMessages);
        // For forks, generate a new plan slug and copy the plan content so the
        // original and forked sessions don't clobber each other's plan files.
        // For regular resumes, reuse the original session's plan slug.
        if (entrypoint === 'fork') {
          void copyPlanForFork(log, asSessionId(sessionId));
        } else {
          void copyPlanForResume(log, asSessionId(sessionId));
        }

        // Restore file history and attribution state from the resumed conversation
        await restoreSessionStateFromLog(log, setAppState);
        if (log.fileHistorySnapshots) {
          void copyFileHistoryForResume(log);
        }

        // Restore agent setting from the resumed conversation
        // Always reset to the new session's values (or clear if none),
        // matching the standaloneAgentContext pattern below
        const { agentDefinition: restoredAgent } = restoreAgentFromSession(
          log.agentSetting,
          initialMainThreadAgentDefinition,
          agentDefinitions,
        );
        setMainThreadAgentDefinition(restoredAgent);
        setAppState(prev => ({ ...prev, agent: restoredAgent?.agentType }));

        // Restore standalone agent context from the resumed conversation
        // Always reset to the new session's values (or clear if none)
        setAppState(prev => ({
          ...prev,
          standaloneAgentContext: computeStandaloneAgentContext(log.agentName, log.agentColor),
        }));
        void updateSessionName(log.agentName);

        // Restore read file state from the message history
        restoreReadFileState(messages, log.projectPath ?? getOriginalCwd());

        // Clear any active loading state (no queryId since we're not in a query)
        resetLoadingState();
        setAbortController(null);

        setConversationId(sessionId);

        // Get target session's costs BEFORE saving current session
        // (saveCurrentSessionCosts overwrites the config, so we need to read first)
        const targetSessionCosts = getStoredSessionCosts(sessionId);

        // Save current session's costs before switching to avoid losing accumulated costs
        saveCurrentSessionCosts();

        // Reset cost state for clean slate before restoring target session
        resetCostState();

        // Switch session (id + project dir atomically). fullPath may point to
        // a different project (cross-worktree, /branch); null derives from
        // current originalCwd.
        switchSession(asSessionId(sessionId), log.fullPath ? dirname(log.fullPath) : null);
        // Rename asciicast recording to match the resumed session ID
        const { renameRecordingForSession } = await import('../utils/asciicast.js');
        await renameRecordingForSession();
        await resetSessionFilePointer();

        // Clear then restore session metadata so it's re-appended on exit via
        // reAppendSessionMetadata. clearSessionMetadata must be called first:
        // restoreSessionMetadata only sets-if-truthy, so without the clear,
        // a session without an agent name would inherit the previous session's
        // cached name and write it to the wrong transcript on first message.
        clearSessionMetadata();
        restoreSessionMetadata(log);

        // Resumed sessions shouldn't re-title from mid-conversation context
        // (same reasoning as the useRef seed), and the previous session's
        // Haiku title shouldn't carry over.
        haikuTitleAttemptedRef.current = true;
        setHaikuTitle(undefined);

        // Exit any worktree a prior /resume entered, then cd into the one
        // this session was in. Without the exit, resuming from worktree B
        // to non-worktree C leaves cwd/currentWorktreeSession stale;
        // resuming B→C where C is also a worktree fails entirely
        // (getCurrentWorktreeSession guard blocks the switch).
        //
        // Skipped for /branch: forkLog doesn't carry worktreeSession, so
        // this would kick the user out of a worktree they're still working
        // in. Same fork skip as processResumedConversation for the adopt —
        // fork materializes its own file via recordTranscript on REPL mount.
        if (entrypoint !== 'fork') {
          exitRestoredWorktree();
          restoreWorktreeForResume(log.worktreeSession);
          adoptResumedSessionFile();
        } else {
          // Fork: same re-persist as /clear (conversation.ts). The clear
          // above wiped currentSessionWorktree, forkLog doesn't carry it,
          // and the process is still in the same worktree.
          const ws = getCurrentWorktreeSession();
          if (ws) saveWorktreeState(ws);
        }

        // Persist the current mode so future resumes know what mode this session was in
        // Restore target session's costs from the data we read earlier
        if (targetSessionCosts) {
          setCostStateForRestore(targetSessionCosts);
        }

        // Reconstruct replacement state for the resumed session. Runs after
        // setSessionId so any NEW replacements post-resume write to the
        // resumed session's tool-results dir. Gated on ref.current: the
        // initial mount already read the feature flag, so we don't re-read
        // it here (mid-session flag flips stay unobservable in both
        // directions).
        //
        // Skipped for in-session /branch: the existing ref is already correct
        // (branch preserves tool_use_ids), so there's no need to reconstruct.
        // createFork() does write content-replacement entries to the forked
        // JSONL with the fork's sessionId, so `sophia -r {forkId}` also works.
        if (contentReplacementStateRef.current && entrypoint !== 'fork') {
          contentReplacementStateRef.current = reconstructContentReplacementState(
            messages,
            log.contentReplacements ?? [],
          );
        }

        // Reset messages to the provided initial messages
        // Use a callback to ensure we're not dependent on stale state
        setMessages(() => messages);

        // Clear any active tool JSX
        setToolJSX(null);

        // Clear input to ensure no residual state
        setInputValue('');

        logEvent('tengu_session_resumed', {
          entrypoint: entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: true,
          resume_duration_ms: Math.round(performance.now() - resumeStart),
        });
      } catch (error) {
        logEvent('tengu_session_resumed', {
          entrypoint: entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: false,
        });
        throw error;
      }
    },
    [resetLoadingState, setAppState],
  );

  // Lazy init: useRef(createX()) would call createX on every render and
  // discard the result. LRUCache construction inside FileStateCache is
  // expensive (~170ms), so we use useState's lazy initializer to create
  // it exactly once, then feed that stable reference into useRef.
  const [initialReadFileState] = useState(() => createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE));
  const readFileState = useRef(initialReadFileState);
  const bashTools = useRef(new Set<string>());
  const bashToolsProcessedIdx = useRef(0);
  // Session-scoped skill discovery tracking (feeds was_discovered on
  // tengu_skill_tool_invocation). Must persist across getToolUseContext
  // Session-level dedup for nested_memory SOPHIA.md attachments.
  // readFileState is a 100-entry LRU; once it evicts a SOPHIA.md path,
  // the next discovery cycle re-injects it. Cleared in clearConversation.
  const loadedNestedMemoryPathsRef = useRef(new Set<string>());

  // Helper to restore read file state from messages (used for resume flows)
  // This allows Claude to edit files that were read in previous sessions
  const restoreReadFileState = useCallback((messages: MessageType[], cwd: string) => {
    const extracted = extractReadFilesFromMessages(messages, cwd, READ_FILE_STATE_CACHE_SIZE);
    readFileState.current = mergeFileStateCaches(readFileState.current, extracted);
    for (const tool of extractBashToolsFromMessages(messages)) {
      bashTools.current.add(tool);
    }
  }, []);

  // Extract read file state from initialMessages on mount
  // This handles CLI flag resume (--resume-session) and ResumeConversation screen
  // where messages are passed as props rather than through the resume callback
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      restoreReadFileState(initialMessages, getOriginalCwd());
    }
    // Only run on mount - initialMessages shouldn't change during component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { status: apiKeyStatus, reverify } = useApiKeyVerification();

  // State for exit feedback flow
  const [exitFlow, setExitFlow] = useState<React.ReactNode>(null);
  const [isExiting, setIsExiting] = useState(false);

  // Determine which dialog should have focus (if any)
  // Interactive dialogs can show even when toolJSX is set,
  // as long as shouldContinueAnimation is true. This prevents deadlocks when
  // agents set background hints while waiting for user interaction.
  function getFocusedInputDialog():
    | 'message-selector'
    | 'sandbox-permission'
    | 'user-question'
    | 'prompt'
    | 'worker-sandbox-permission'
    | 'elicitation'
    | 'idle-return'
    | 'init-onboarding'
    | 'ide-onboarding'
    | 'model-switch'
    | 'undercover-callout'
    | 'effort-callout'
    | 'lsp-recommendation'
    | 'plugin-hint'
    | 'search-extra-tools-hint'
    | 'desktop-upsell'
    | undefined {
    // Exit states always take precedence
    if (isExiting || exitFlow) return undefined;

    // High priority dialogs (always show regardless of typing)
    if (isMessageSelectorVisible) return 'message-selector';

    // Suppress interrupt dialogs while user is actively typing
    if (isPromptInputActive) return undefined;

    if (sandboxPermissionRequestQueue[0]) return 'sandbox-permission';

    // Interactive dialogs (show unless blocked by toolJSX)
    const allowDialogsWithAnimation = !toolJSX || toolJSX.shouldContinueAnimation;

    if (allowDialogsWithAnimation && userQuestionQueue[0]) return 'user-question';
    if (allowDialogsWithAnimation && promptQueue[0]) return 'prompt';
    // Worker sandbox permission prompts (network access) from swarm workers
    if (allowDialogsWithAnimation && workerSandboxPermissions.queue[0]) return 'worker-sandbox-permission';
    if (allowDialogsWithAnimation && elicitation.queue[0]) return 'elicitation';
    if (allowDialogsWithAnimation && idleReturnPending) return 'idle-return';

    // Model switch callout (ant-only, eliminated from external builds)
    if (process.env.USER_TYPE === 'ant' && allowDialogsWithAnimation && showModelSwitchCallout) return 'model-switch';

    // Undercover auto-enable explainer (ant-only, eliminated from external builds)
    if (process.env.USER_TYPE === 'ant' && allowDialogsWithAnimation && showUndercoverCallout)
      return 'undercover-callout';
    // Remote callout (shown once before first bridge enable)

    // Desktop app upsell (max 3 launches, lowest priority)

    return undefined;
  }

  const focusedInputDialog = getFocusedInputDialog();

  // True when interactive dialogs exist but are hidden because the user is typing.
  const hasSuppressedDialogs =
    isPromptInputActive &&
    (sandboxPermissionRequestQueue[0] ||
      userQuestionQueue[0] ||
      promptQueue[0] ||
      workerSandboxPermissions.queue[0] ||
      elicitation.queue[0]);

  // Keep ref in sync so timer callbacks can read the current value
  focusedInputDialogRef.current = focusedInputDialog;

  // Immediately capture pause/resume when focusedInputDialog changes
  // This ensures accurate timing even under high system load, rather than
  // relying on the 100ms polling interval to detect state changes
  useEffect(() => {
    if (!isLoading) return;

    const isPaused = focusedInputDialog === 'user-question';
    const now = Date.now();

    if (isPaused && pauseStartTimeRef.current === null) {
      // Just entered pause state - record the exact moment
      pauseStartTimeRef.current = now;
    } else if (!isPaused && pauseStartTimeRef.current !== null) {
      // Just exited pause state - accumulate paused time immediately
      totalPausedMsRef.current += now - pauseStartTimeRef.current;
      pauseStartTimeRef.current = null;
    }
  }, [focusedInputDialog, isLoading]);

  // Re-pin scroll to bottom whenever the question dialog appears or
  // dismisses. Overlay now renders below messages inside the same
  // ScrollBox (no remount), so we need an explicit scrollToBottom for:
  //  - appear: user may have been scrolled up (sticky broken) — the
  //    dialog is blocking and must be visible
  //  - dismiss: user may have scrolled up to read context during the
  //    overlay, and onScroll was suppressed so the pill state is stale
  // useLayoutEffect so the re-pin commits before the Ink frame renders —
  // no 1-frame flash of the wrong scroll position.
  const prevDialogRef = useRef(focusedInputDialog);
  useLayoutEffect(() => {
    const was = prevDialogRef.current === 'user-question';
    const now = focusedInputDialog === 'user-question';
    if (was !== now) repinScroll();
    prevDialogRef.current = focusedInputDialog;
  }, [focusedInputDialog, repinScroll]);

  function onCancel() {
    if (focusedInputDialog === 'elicitation') {
      // Elicitation dialog handles its own Escape, and closing it shouldn't affect any loading state.
      return;
    }

    // Grace-period guard: if a local-jsx panel (for example, /tasks) was just
    // dismissed via ESC, swallow the same / immediately-following ESC so it
    // doesn't fall through to abortController.abort('user-cancel') and kill
    // the in-flight Workflow tool. Single-press ESC closes the panel
    // (handled by the panel's own useInput → onDone → setToolJSX); the
    // chat:cancel keybinding's isActive gate shields while the panel is
    // mounted but not in the React commit window right after unmount.
    // Reset the stamp so a later, deliberate ESC still cancels normally.
    if (
      localJSXClosedAtRef.current !== 0 &&
      Date.now() - localJSXClosedAtRef.current < LOCAL_JSX_CLOSE_CANCEL_GRACE_MS
    ) {
      localJSXClosedAtRef.current = 0;
      logForDebugging('[onCancel] suppressed: local-jsx panel just dismissed');
      return;
    }
    localJSXClosedAtRef.current = 0;

    logForDebugging(`[onCancel] focusedInputDialog=${focusedInputDialog} streamMode=${streamMode}`);

    queryGuard.forceEnd();
    skipIdleCheckRef.current = false;

    // Preserve partially-streamed text so the user can read what was
    // generated before pressing Esc. Pushed before resetLoadingState clears
    // streamingText, and before query.ts yields the async interrupt marker,
    // giving final order [user, partial-assistant, [Request interrupted by user]].
    if (streamingText?.trim()) {
      setMessages(prev => [...prev, createAssistantMessage({ content: streamingText })]);
    }

    resetLoadingState();

    // Clear any active token budget so the backstop doesn't fire on
    // a stale budget if the query generator hasn't exited yet.
    if (feature('TOKEN_BUDGET')) {
      snapshotOutputTokensForTurn(null);
    }

    if (focusedInputDialog === 'user-question') {
      userQuestionQueue[0]?.onAbort();
      setUserQuestionQueue([]);
    } else if (focusedInputDialog === 'prompt') {
      // Reject all pending prompts and clear the queue
      for (const item of promptQueue) {
        item.reject(new Error('Prompt cancelled by user'));
      }
      setPromptQueue([]);
      abortController?.abort('user-cancel');
    } else {
      abortController?.abort('user-cancel');
    }

    // Clear the controller so subsequent Escape presses don't see a stale
    // aborted signal. Without this, canCancelRunningTask is false (signal
    // defined but .aborted === true), so isActive becomes false if no other
    // activating conditions hold — leaving the Escape keybinding inactive.
    setAbortController(null);

    // forceEnd() skips the finally path — fire directly (aborted=true).
    void mrOnTurnComplete(messagesRef.current, true);
  }

  // Function to handle queued command when cancelling an interactive request.
  const handleQueuedCommandOnCancel = useCallback(() => {
    const result = popAllEditable(inputValue, 0);
    if (!result) return;
    setInputValue(result.text);
    setInputMode('prompt');

    // Restore images from queued commands to pastedContents
    if (result.images.length > 0) {
      setPastedContents(prev => {
        const newContents = { ...prev };
        for (const image of result.images) {
          newContents[image.id] = image;
        }
        return newContents;
      });
    }
  }, [setInputValue, setInputMode, inputValue, setPastedContents]);

  // CancelRequestHandler props - rendered inside KeybindingSetup
  const cancelRequestProps = {
    onCancel,
    onAgentsKilled: () => setMessages(prev => [...prev, createAgentsKilledMessage()]),
    isMessageSelectorVisible: isMessageSelectorVisible || !!showBashesDialog,
    screen,
    abortSignal: abortController?.signal,
    popCommandFromQueue: handleQueuedCommandOnCancel,
    vimMode,
    isLocalJSXCommand: toolJSX?.isLocalJSXCommand,
    isSearchingHistory,
    isHelpOpen,
    inputMode,
    inputValue,
    streamMode,
  };

  useEffect(() => {
    if (false) {
      // Cost threshold UI is intentionally disabled for provider-neutral runs.
      // Mark as shown even if the dialog won't render (no API billing
      // access). Otherwise this effect re-fires on every message change for
      // the rest of the session — 200k+ spurious events observed.
      return;
    }
  }, []);

  const sandboxAskCallback: SandboxAskCallback = useCallback(
    async (hostPattern: NetworkHostPattern) => {
      return false;

      // If running as a swarm worker, forward the request to the leader via mailbox
      if (isAgentSwarmsEnabled() && isSwarmWorker()) {
        const requestId = generateSandboxRequestId();

        // Send the request to the leader via mailbox
        const sent = await sendSandboxPermissionRequestViaMailbox(hostPattern.host, requestId);

        return new Promise(resolveShouldAllowHost => {
          if (!sent) {
            // If we couldn't send via mailbox, fall back to local handling
            setSandboxPermissionRequestQueue(prev => [
              ...prev,
              {
                hostPattern,
                resolvePromise: resolveShouldAllowHost,
              },
            ]);
            return;
          }

          // Register the callback for when the leader responds
          registerSandboxPermissionCallback({
            requestId,
            host: hostPattern.host,
            resolve: resolveShouldAllowHost,
          });

          // Update AppState to show pending indicator
          setAppState(prev => ({
            ...prev,
            pendingSandboxRequest: {
              requestId,
              host: hostPattern.host,
            },
          }));
        });
      }

      // Normal flow for non-workers: show local UI and optionally race
      return new Promise(resolveShouldAllowHost => {
        let resolved = false;
        function resolveOnce(allow: boolean): void {
          if (resolved) return;
          resolved = true;
          resolveShouldAllowHost(allow);
        }

        // Queue the local sandbox permission dialog
        setSandboxPermissionRequestQueue(prev => [
          ...prev,
          {
            hostPattern,
            resolvePromise: resolveOnce,
          },
        ]);
      });
    },
    [setAppState, store],
  );

  // #34044: if user explicitly set sandbox.enabled=true but deps are missing,
  // isSandboxingEnabled() returns false silently. Surface the reason once at
  // mount so users know their security config isn't being enforced. Full
  // reason goes to debug log; notification points to /sandbox for details.
  // addNotification is stable (useCallback) so the effect fires once.
  useEffect(() => {
    const reason = SandboxManager.getSandboxUnavailableReason();
    if (!reason) return;
    if (SandboxManager.isSandboxRequired()) {
      process.stderr.write(
        `\nError: sandbox required but unavailable: ${reason}\n` +
          `  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`,
      );
      gracefulShutdownSync(1, 'other');
      return;
    }
    logForDebugging(`sandbox disabled: ${reason}`, { level: 'warn' });
    addNotification({
      key: 'sandbox-unavailable',
      jsx: (
        <>
          <Text color="warning">sandbox disabled</Text>
          <Text dimColor> · /sandbox</Text>
        </>
      ),
      priority: 'medium',
    });
  }, [addNotification]);

  if (SandboxManager.isSandboxingEnabled()) {
    // If sandboxing is enabled (setting.sandbox is defined, initialise the manager)
    SandboxManager.initialize(sandboxAskCallback).catch(err => {
      // Initialization/validation failed - display error and exit
      process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`);
      gracefulShutdownSync(1, 'other');
    });
  }

  const setToolSafetyContext = useCallback(
    (context: ToolSafetyContext, options?: { preserveMode?: boolean }) => {
      setAppState(prev => ({
        ...prev,
        toolSafetyContext: {
          ...context,
          mode: options?.preserveMode ? prev.toolSafetyContext.mode : context.mode,
        },
      }));
    },
    [setAppState],
  );

  const canUseTool = useCanUseTool(setUserQuestionQueue);

  const requestPrompt = useCallback(
    (title: string, toolInputSummary?: string | null) =>
      (request: PromptRequest): Promise<PromptResponse> =>
        new Promise<PromptResponse>((resolve, reject) => {
          setPromptQueue(prev => [...prev, { request, title, toolInputSummary, resolve, reject }]);
        }),
    [],
  );

  const getToolUseContext = useCallback(
    (
      messages: MessageType[],
      _newMessages: MessageType[],
      abortController: AbortController,
      mainLoopModel: string,
    ): ProcessUserInputContext => {
      // Read mutable values fresh from the store rather than closure-capturing
      // useAppState() snapshots. Same values today (closure is refreshed by the
      // render between turns); decouples freshness from React's render cycle for
      // a future headless conversation loop. Same pattern refreshTools() uses.
      const s = store.getState();

      // Compute tools fresh from store.getState() rather than the closure-
      // captured `tools`. useManageMCPConnections populates appState.mcp
      // async as servers connect — the store may have newer MCP state than
      // the closure captured at render time. Also doubles as refreshTools()
      // for mid-query tool list updates.
      const computeTools = () => {
        const state = store.getState();
        const assembled = assembleToolPool(state.toolSafetyContext, state.mcp.tools);
        const merged = mergeAndFilterTools(combinedInitialTools, assembled, state.toolSafetyContext.mode);
        if (!mainThreadAgentDefinition) return merged;
        return resolveAgentTools(mainThreadAgentDefinition, merged, false, true).resolvedTools;
      };

      return {
        abortController,
        options: {
          commands,
          tools: computeTools(),
          debug,
          verbose: s.verbose,
          mainLoopModel,
          thinkingConfig: s.thinkingEnabled !== false ? thinkingConfig : { type: 'disabled' },
          // Merge fresh from store rather than closing over useMergedClients'
          // memoized output. initialMcpClients is a prop (session-constant).
          mcpClients: mergeClients(initialMcpClients, s.mcp.clients),
          mcpResources: s.mcp.resources,
          isNonInteractiveSession: false,
          dynamicMcpConfig,
          theme,
          agentDefinitions: allowedAgentTypes ? { ...s.agentDefinitions, allowedAgentTypes } : s.agentDefinitions,
          customSystemPrompt,
          appendSystemPrompt,
          refreshTools: computeTools,
        },
        getAppState: () => store.getState(),
        setAppState,
        messages,
        setMessages,
        updateFileHistoryState(updater: (prev: FileHistoryState) => FileHistoryState) {
          // Perf: skip the setState when the updater returns the same reference
          // (e.g. fileHistoryTrackEdit returns `state` when the file is already
          // tracked). Otherwise every no-op call would notify all store listeners.
          setAppState(prev => {
            const updated = updater(prev.fileHistory);
            if (updated === prev.fileHistory) return prev;
            return { ...prev, fileHistory: updated };
          });
        },
        updateAttributionState(updater: (prev: AttributionState) => AttributionState) {
          setAppState(prev => {
            const updated = updater(prev.attribution);
            if (updated === prev.attribution) return prev;
            return { ...prev, attribution: updated };
          });
        },
        openMessageSelector: () => {
          if (!disabled) {
            setIsMessageSelectorVisible(true);
          }
        },
        onChangeAPIKey: reverify,
        readFileState: readFileState.current,
        setToolJSX,
        addNotification,
        appendSystemMessage: msg => setMessages(prev => [...prev, msg]),
        sendOSNotification: opts => {
          void sendNotification(opts, terminal);
        },
        onChangeDynamicMcpConfig,
        nestedMemoryAttachmentTriggers: new Set<string>(),
        loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
        dynamicSkillDirTriggers: new Set<string>(),
        setResponseLength,
        pushApiMetricsEntry:
          process.env.USER_TYPE === 'ant'
            ? (ttftMs: number) => {
                const now = Date.now();
                const baseline = responseLengthRef.current;
                apiMetricsRef.current.push({
                  ttftMs,
                  firstTokenTime: now,
                  lastTokenTime: now,
                  responseLengthBaseline: baseline,
                  endResponseLength: baseline,
                });
              }
            : undefined,
        setStreamMode,
        onCompactProgress: event => {
          switch (event.type) {
            case 'hooks_start':
              setSpinnerColor('sophiaBlue');
              setSpinnerShimmerColor('sophiaBlueShimmer');
              setSpinnerMessage(
                event.hookType === 'pre_compact'
                  ? 'Running PreCompact hooks\u2026'
                  : event.hookType === 'post_compact'
                    ? 'Running PostCompact hooks\u2026'
                    : 'Running SessionStart hooks\u2026',
              );
              break;
            case 'compact_start':
              setSpinnerMessage('Compacting conversation');
              compactProgressActiveRef.current = true;
              break;
            case 'compact_end':
              setSpinnerMessage(null);
              setSpinnerColor(null);
              setSpinnerShimmerColor(null);
              compactProgressActiveRef.current = false;
              break;
          }
        },
        setInProgressToolUseIDs,
        setHasInterruptibleToolInProgress: (v: boolean) => {
          hasInterruptibleToolInProgressRef.current = v;
        },
        resume,
        setConversationId,
        requestPrompt: feature('HOOK_PROMPTS') ? requestPrompt : undefined,
        contentReplacementState: contentReplacementStateRef.current,
      };
    },
    [
      commands,
      combinedInitialTools,
      mainThreadAgentDefinition,
      debug,
      initialMcpClients,
      dynamicMcpConfig,
      theme,
      allowedAgentTypes,
      store,
      setAppState,
      reverify,
      addNotification,
      setMessages,
      onChangeDynamicMcpConfig,
      resume,
      requestPrompt,
      disabled,
      customSystemPrompt,
      appendSystemPrompt,
      setConversationId,
    ],
  );

  const onQueryEvent = useCallback(
    (event: Parameters<typeof handleMessageFromStream>[0]) => {
      handleMessageFromStream(
        event,
        newMessage => {
          if (isCompactBoundaryMessage(newMessage)) {
            // Keep the complete transcript visible. query.ts independently
            // starts the next model request at this boundary, so retaining
            // these messages affects display/history only and does not spend
            // them again in the model context.
            setMessages(old => [...old, newMessage]);
            // Bump conversationId so Messages.tsx row keys change and
            // stale memoized rows remount with post-compact content.
            setConversationId(randomUUID());
          } else if (
            newMessage.type === 'progress' &&
            isEphemeralToolProgress((newMessage as unknown as { data?: { type?: string } }).data?.type)
          ) {
            // Replace the previous ephemeral progress tick for the same tool
            // call instead of appending. Sleep/Bash emit a tick per second and
            // only the last one is rendered; appending blows up the messages
            // array (13k+ observed) and the transcript (120MB of sleep_progress
            // lines). useLogMessages tracks length, so same-length replacement
            // also skips the transcript write.
            // agent_progress / hook_progress / skill_progress are NOT ephemeral
            // — each carries distinct state the UI needs (e.g. subagent tool
            // history). Replacing those leaves the AgentTool UI stuck at
            // "Initializing…" because it renders the full progress trail.
            setMessages(oldMessages => {
              const newData = newMessage.data as Record<string, unknown>;
              // Scan backwards to find the last ephemeral progress with matching
              // parentToolUseID and type. Previously only checked the last message,
              // so interleaved non-ephemeral messages caused duplicate progress
              // entries to accumulate (observed 13k+ entries in sleep-heavy sessions).
              for (let i = oldMessages.length - 1; i >= 0; i--) {
                const m = oldMessages[i]!;
                if (m.type !== 'progress') break;
                const mData = m.data as Record<string, unknown> | undefined;
                if (m.parentToolUseID === newMessage.parentToolUseID && mData?.type === newData.type) {
                  const copy = oldMessages.slice();
                  copy[i] = newMessage;
                  return copy;
                }
              }
              return [...oldMessages, newMessage];
            });
          } else {
            setMessages(oldMessages => [...oldMessages, newMessage]);
          }
          // Relay assistant response to master when in slave mode.
          if (feature('UDS_INBOX') && newMessage.type === 'assistant') {
            // Extract text from content blocks (API format)
            const msg = newMessage.message as any;
            const contentBlocks = msg?.content ?? (newMessage as any).content ?? [];
            const textParts: string[] = [];
            if (Array.isArray(contentBlocks)) {
              for (const block of contentBlocks) {
                if (typeof block === 'string') {
                  textParts.push(block);
                } else if (block?.type === 'text' && block.text) {
                  textParts.push(block.text);
                }
              }
            } else if (typeof contentBlocks === 'string') {
              textParts.push(contentBlocks);
            }
            const text = textParts.join('\n').trim();
            if ('isApiErrorMessage' in newMessage && newMessage.isApiErrorMessage) {
              pipeReturnHadErrorRef.current = true;
              relayPipeMessage({
                type: 'error',
                data: text || 'Slave request failed',
              });
            } else if (text) {
              relayPipeMessage({ type: 'stream', data: text });
            }
          }
        },
        newContent => {
          // setResponseLength handles updating both responseLengthRef (for
          // spinner animation) and apiMetricsRef (endResponseLength/lastTokenTime
          // for OTPS). No separate metrics update needed here.
          setResponseLength(length => length + newContent.length);
        },
        setStreamMode,
        setStreamingToolUses,
        tombstonedMessage => {
          setMessages(oldMessages => oldMessages.filter(m => m !== tombstonedMessage));
          void removeTranscriptMessage(tombstonedMessage.uuid);
        },
        setStreamingThinking,
        metrics => {
          const now = Date.now();
          const baseline = responseLengthRef.current;
          apiMetricsRef.current.push({
            ...metrics,
            firstTokenTime: now,
            lastTokenTime: now,
            responseLengthBaseline: baseline,
            endResponseLength: baseline,
          });
        },
        onStreamingText,
      );
    },
    [setMessages, setResponseLength, setStreamMode, setStreamingToolUses, setStreamingThinking, onStreamingText],
  );

  const onQueryImpl = useCallback(
    async (
      messagesIncludingNewMessages: MessageType[],
      newMessages: MessageType[],
      abortController: AbortController,
      shouldQuery: boolean,
      additionalAllowedTools: string[],
      mainLoopModelParam: string,
      effort?: EffortValue,
    ) => {
      // Prepare IDE integration for new prompt. Read mcpClients fresh from
      // store — useManageMCPConnections may have populated it since the
      // render that captured this closure (same pattern as computeTools).
      if (shouldQuery) {
        const freshClients = mergeClients(initialMcpClients, store.getState().mcp.clients);
        void diagnosticTracker.handleQueryStart(freshClients);
        const ideClient = getConnectedIdeClient(freshClients);
        if (ideClient) {
          void closeOpenDiffs(ideClient);
        }
      }

      // Mark onboarding as complete when any user message is sent to Sophia.
      void maybeMarkProjectOnboardingComplete();

      // Extract a session title from the first real user message. One-shot
      // via ref (was tengu_birch_mist experiment: first-message-only to save
      // Haiku calls). The ref replaces the old `messages.length <= 1` check,
      // which was broken by SessionStart hook messages (prepended via
      // useDeferredHookMessages) and attachment messages (appended by
      // processTextPrompt) — both pushed length past 1 on turn one, so the
      // title silently fell through to the "Sophia Agent" default.
      if (!titleDisabled && !sessionTitle && !agentTitle && !haikuTitleAttemptedRef.current) {
        const firstUserMessage = newMessages.find(m => m.type === 'user' && !m.isMeta);
        const text =
          firstUserMessage?.type === 'user'
            ? getContentText(firstUserMessage.message!.content as string | ContentBlockParam[])
            : null;
        // Skip synthetic breadcrumbs — slash-command output, prompt-skill
        // expansions (/commit → <command-message>), local-command headers
        // (/help → <command-name>), and bash-mode (!cmd → <bash-input>).
        // None of these are the user's topic; wait for real prose.
        if (
          text &&
          !text.startsWith(`<${LOCAL_COMMAND_STDOUT_TAG}>`) &&
          !text.startsWith(`<${COMMAND_MESSAGE_TAG}>`) &&
          !text.startsWith(`<${COMMAND_NAME_TAG}>`) &&
          !text.startsWith(`<${BASH_INPUT_TAG}>`)
        ) {
          haikuTitleAttemptedRef.current = true;
          void generateSessionTitle(text, new AbortController().signal).then(
            title => {
              if (title) setHaikuTitle(title);
              else haikuTitleAttemptedRef.current = false;
            },
            () => {
              haikuTitleAttemptedRef.current = false;
            },
          );
        }
      }

      // Apply slash-command-scoped allowedTools (from skill frontmatter) to the
      // store once per turn. This also covers the reset: the next non-skill turn
      // passes [] and clears it. Must run before the !shouldQuery gate: forked
      // commands (executeForkedSlashCommand) return shouldQuery=false, and
      // createGetAppStateWithAllowedTools in forkedAgent.ts reads this field, so
      // stale skill tools would otherwise leak into forked agent permissions.
      // Previously this write was hidden inside getToolUseContext's getAppState
      // (~85 calls/turn); hoisting it here makes getAppState a pure read and stops
      // ephemeral contexts (permission dialog, BackgroundTasksDialog) from
      // accidentally clearing it mid-turn.
      store.setState(prev => {
        const cur = prev.toolSafetyContext.allowRules.command;
        if (
          cur === additionalAllowedTools ||
          (cur?.length === additionalAllowedTools.length && cur.every((v, i) => v === additionalAllowedTools[i]))
        ) {
          return prev;
        }
        return {
          ...prev,
          toolSafetyContext: {
            ...prev.toolSafetyContext,
            allowRules: {
              ...prev.toolSafetyContext.allowRules,
              command: additionalAllowedTools,
            },
          },
        };
      });

      // The last message is an assistant message if the user input was a bash command,
      // or if the user input was an invalid slash command.
      if (!shouldQuery) {
        // Manual /compact sets messages directly (shouldQuery=false) bypassing
        // handleMessageFromStream. Clear context-blocked if a compact boundary
        // is present so proactive ticks resume after compaction.
        if (newMessages.some(isCompactBoundaryMessage)) {
          // Bump conversationId so Messages.tsx row keys change and
          // stale memoized rows remount with post-compact content.
          setConversationId(randomUUID());
        }
        resetLoadingState();
        setAbortController(null);
        return;
      }

      const toolUseContext = getToolUseContext(
        messagesIncludingNewMessages,
        newMessages,
        abortController,
        mainLoopModelParam,
      );
      // getToolUseContext reads tools/mcpClients fresh from store.getState()
      // (via computeTools/mergeClients). Use those rather than the closure-
      // captured `tools`/`mcpClients` — useManageMCPConnections may have
      // flushed new MCP state between the render that captured this closure
      // and now. Turn 1 via processInitialMessage is the main beneficiary.
      const { tools: freshTools, mcpClients: freshMcpClients } = toolUseContext.options;

      // Scope the skill's effort override to this turn's context only —
      // wrapping getAppState keeps the override out of the global store so
      // background agents and UI subscribers (Spinner, LogoV2) never see it.
      if (effort !== undefined) {
        const previousGetAppState = toolUseContext.getAppState;
        toolUseContext.getAppState = () => ({
          ...previousGetAppState(),
          effortValue: effort,
        });
      }

      queryCheckpoint('query_context_loading_start');
      const [, , defaultSystemPrompt, baseUserContext, systemContext] = await Promise.all([
        // IMPORTANT: do this after setMessages() above, to avoid UI jank
        undefined,
        undefined,
        getSystemPrompt(
          freshTools,
          mainLoopModelParam,
          Array.from(toolSafetyContext.additionalWorkingDirectories.keys()),
          freshMcpClients,
        ),
        getUserContext(),
        getSystemContext(),
      ]);
      const userContext = baseUserContext;
      queryCheckpoint('query_context_loading_end');

      const systemPrompt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext,
        customSystemPrompt,
        defaultSystemPrompt,
        appendSystemPrompt,
      });
      toolUseContext.renderedSystemPrompt = systemPrompt;

      queryCheckpoint('query_query_start');
      resetTurnHookDuration();
      resetTurnToolDuration();
      resetTurnClassifierDuration();

      for await (const event of query({
        messages: messagesIncludingNewMessages,
        systemPrompt,
        userContext,
        systemContext,
        canUseTool,
        toolUseContext,
        querySource: getQuerySourceForREPL(),
      })) {
        onQueryEvent(event);
      }

      queryCheckpoint('query_end');

      if (feature('UDS_INBOX')) {
        if (abortController.signal.aborted) {
          pipeReturnHadErrorRef.current = true;
          relayPipeMessage({
            type: 'error',
            data: 'Slave request was interrupted before completion.',
          });
        }
      }

      // Capture ant-only API metrics before resetLoadingState clears the ref.
      // For multi-request turns (tool use loops), compute P50 across all requests.
      if (process.env.USER_TYPE === 'ant' && apiMetricsRef.current.length > 0) {
        const entries = apiMetricsRef.current;

        const ttfts = entries.map(e => e.ttftMs);
        // Compute per-request OTPS using only active streaming time and
        // streaming-only content. endResponseLength tracks content added by
        // streaming deltas only, excluding subagent/compaction inflation.
        const otpsValues = entries.map(e => {
          const delta = Math.round((e.endResponseLength - e.responseLengthBaseline) / 4);
          const samplingMs = e.lastTokenTime - e.firstTokenTime;
          return samplingMs > 0 ? Math.round(delta / (samplingMs / 1000)) : 0;
        });

        const isMultiRequest = entries.length > 1;
        const hookMs = getTurnHookDurationMs();
        const hookCount = getTurnHookCount();
        const toolMs = getTurnToolDurationMs();
        const toolCount = getTurnToolCount();
        const classifierMs = getTurnClassifierDurationMs();
        const classifierCount = getTurnClassifierCount();
        const turnMs = Date.now() - loadingStartTimeRef.current;
        setMessages(prev => [
          ...prev,
          createApiMetricsMessage({
            ttftMs: isMultiRequest ? median(ttfts) : ttfts[0]!,
            otps: isMultiRequest ? median(otpsValues) : otpsValues[0]!,
            isP50: isMultiRequest,
            hookDurationMs: hookMs > 0 ? hookMs : undefined,
            hookCount: hookCount > 0 ? hookCount : undefined,
            turnDurationMs: turnMs > 0 ? turnMs : undefined,
            toolDurationMs: toolMs > 0 ? toolMs : undefined,
            toolCount: toolCount > 0 ? toolCount : undefined,
            classifierDurationMs: classifierMs > 0 ? classifierMs : undefined,
            classifierCount: classifierCount > 0 ? classifierCount : undefined,
            configWriteCount: getGlobalConfigWriteCount(),
          }),
        ]);
      }

      resetLoadingState();

      // Log query profiling report if enabled
      logQueryProfileReport();

      // Signal that a query turn has completed successfully
      await onTurnComplete?.(messagesRef.current);
    },
    [
      initialMcpClients,
      resetLoadingState,
      getToolUseContext,
      toolSafetyContext,
      setAppState,
      customSystemPrompt,
      onTurnComplete,
      appendSystemPrompt,
      canUseTool,
      mainThreadAgentDefinition,
      onQueryEvent,
      sessionTitle,
      titleDisabled,
    ],
  );

  const onQuery = useCallback(
    async (
      newMessages: MessageType[],
      abortController: AbortController,
      shouldQuery: boolean,
      additionalAllowedTools: string[],
      mainLoopModelParam: string,
      onBeforeQueryCallback?: (input: string, newMessages: MessageType[]) => Promise<boolean>,
      input?: string,
      effort?: EffortValue,
    ): Promise<boolean> => {
      // If this is a teammate, mark them as active when starting a turn
      if (isAgentSwarmsEnabled()) {
        const teamName = getTeamName();
        const agentName = getAgentName();
        if (teamName && agentName) {
          // Fire and forget - turn starts immediately, write happens in background
          void setMemberActive(teamName, agentName, true);
        }
      }

      // Concurrent guard via state machine. tryStart() atomically checks
      // and transitions idle→running, returning the generation number.
      // Returns null if already running — no separate check-then-set.
      const thisGeneration = queryGuard.tryStart();
      if (thisGeneration === null) {
        logEvent('tengu_concurrent_onquery_detected', {});

        // Extract and enqueue user message text, skipping meta messages
        // (e.g. expanded skill content, tick prompts) that should not be
        // replayed as user-visible text.
        newMessages
          .filter((m): m is UserMessage => m.type === 'user' && !m.isMeta)
          .map(_ => getContentText(_.message.content as string | ContentBlockParam[]))
          .filter(_ => _ !== null)
          .forEach((msg, i) => {
            enqueue({ value: msg, mode: 'prompt' });
            if (i === 0) {
              logEvent('tengu_concurrent_onquery_enqueued', {});
            }
          });
        return false;
      }

      try {
        pipeReturnHadErrorRef.current = false;
        // isLoading is derived from queryGuard — tryStart() above already
        // transitioned dispatching→running, so no setter call needed here.
        resetTimingRefs();
        setMessages(oldMessages => [...oldMessages, ...newMessages]);
        responseLengthRef.current = 0;
        if (feature('TOKEN_BUDGET')) {
          const parsedBudget = input ? parseTokenBudget(input) : null;
          snapshotOutputTokensForTurn(parsedBudget ?? getCurrentTurnTokenBudget());
        }
        apiMetricsRef.current = [];
        setStreamingToolUses([]);
        setStreamingText(null);

        // messagesRef is updated synchronously by the setMessages wrapper
        // above, so it already includes newMessages from the append at the
        // top of this try block.  No reconstruction needed, no waiting for
        // React's scheduler (previously cost 20-56ms per prompt; the 56ms
        // case was a GC pause caught during the await).
        const latestMessages = messagesRef.current;

        if (input) {
          await mrOnBeforeQuery(input, latestMessages, newMessages.length);
        }

        // Pass full conversation history to callback
        if (onBeforeQueryCallback && input) {
          const shouldProceed = await onBeforeQueryCallback(input, latestMessages);
          if (!shouldProceed) {
            return true;
          }
        }

        try {
          await onQueryImpl(
            latestMessages,
            newMessages,
            abortController,
            shouldQuery,
            additionalAllowedTools,
            mainLoopModelParam,
            effort,
          );
        } catch (error) {
          if (feature('UDS_INBOX')) {
            pipeReturnHadErrorRef.current = true;
            relayPipeMessage({
              type: 'error',
              data: error instanceof Error ? error.message : String(error),
            });
          }
          throw error;
        }
      } finally {
        // queryGuard.end() atomically checks generation and transitions
        // running→idle. Returns false if a newer query owns the guard
        // (cancel+resubmit race where the stale finally fires as a microtask).
        if (queryGuard.end(thisGeneration)) {
          setLastQueryCompletionTime(Date.now());
          skipIdleCheckRef.current = false;
          // Always reset loading state in finally - this ensures cleanup even
          // if onQueryImpl throws. onTurnComplete is called separately in
          // onQueryImpl only on successful completion.
          resetLoadingState();

          await mrOnTurnComplete(messagesRef.current, abortController.signal.aborted);

          if (feature('UDS_INBOX') && !pipeReturnHadErrorRef.current) {
            relayPipeMessage({
              type: 'done',
              data: '',
            });
          }

          // Notify bridge clients that the turn is complete so mobile apps
          // can stop the spark animation and show post-turn UI.

          // Auto-hide tungsten panel content at turn end (ant-only), but keep
          // tungstenActiveSession set so the pill stays in the footer and the user
          // can reopen the panel. Background tmux tasks (e.g. /hunter) run for
          // minutes — wiping the session made the pill disappear entirely, forcing
          // the user to re-invoke Tmux just to peek. Skip on abort so the panel
          // stays open for inspection (matches the turn-duration guard below).
          if (process.env.USER_TYPE === 'ant' && !abortController.signal.aborted) {
            setAppState(prev => {
              if (prev.tungstenActiveSession === undefined) return prev;
              if (prev.tungstenPanelAutoHidden === true) return prev;
              return { ...prev, tungstenPanelAutoHidden: true };
            });
          }

          // Capture budget info before clearing (ant-only)
          let budgetInfo: { tokens: number; limit: number; nudges: number } | undefined;
          if (feature('TOKEN_BUDGET')) {
            if (
              getCurrentTurnTokenBudget() !== null &&
              getCurrentTurnTokenBudget()! > 0 &&
              !abortController.signal.aborted
            ) {
              budgetInfo = {
                tokens: getTurnOutputTokens(),
                limit: getCurrentTurnTokenBudget()!,
                nudges: getBudgetContinuationCount(),
              };
            }
            snapshotOutputTokensForTurn(null);
          }

          // Add turn duration message for turns longer than 30s or with a budget
          // Skip if user aborted or if in loop mode (too noisy between ticks)
          // Defer if swarm teammates are still running (show when they finish)
          const turnDurationMs = Date.now() - loadingStartTimeRef.current - totalPausedMsRef.current;
          if ((turnDurationMs > 30000 || budgetInfo !== undefined) && !abortController.signal.aborted) {
            const hasRunningSwarmAgents = getAllInProcessTeammateTasks(store.getState().tasks).some(
              t => t.status === 'running',
            );
            if (hasRunningSwarmAgents) {
              // Only record start time on the first deferred turn
              if (swarmStartTimeRef.current === null) {
                swarmStartTimeRef.current = loadingStartTimeRef.current;
              }
              // Always update budget — later turns may carry the actual budget
              if (budgetInfo) {
                swarmBudgetInfoRef.current = budgetInfo;
              }
            } else {
              setMessages(prev => [
                ...prev,
                createTurnDurationMessage(turnDurationMs, budgetInfo, count(prev, isLoggableMessage)),
              ]);
            }
          }
          // Clear the controller so CancelRequestHandler's canCancelRunningTask
          // reads false at the idle prompt. Without this, the stale non-aborted
          // controller makes ctrl+c fire onCancel() (aborting nothing) instead of
          // propagating to the double-press exit flow.
          setAbortController(null);
        }

        // Auto-restore: if the user interrupted before any meaningful response
        // arrived, rewind the conversation and restore their prompt — same as
        // opening the message selector and picking the last message.
        // This runs OUTSIDE the queryGuard.end() check because onCancel calls
        // forceEnd(), which bumps the generation so end() returns false above.
        // Guards: reason === 'user-cancel' (onCancel/Esc; programmatic aborts
        // use 'background'/'interrupt' and must not rewind — note abort() with
        // no args sets reason to a DOMException, not undefined), !isActive (no
        // newer query started — cancel+resubmit race), empty input (don't
        // clobber text typed during loading), no queued commands (user queued
        // B while A was loading → they've moved on, don't restore A; also
        // avoids removeLastFromHistory removing B's entry instead of A's),
        // not viewing a teammate (messagesRef is the main conversation — the
        // old Up-arrow quick-restore had this guard, preserve it).
        if (
          abortController.signal.reason === 'user-cancel' &&
          !queryGuard.isActive &&
          inputValueRef.current === '' &&
          getCommandQueueLength() === 0 &&
          !store.getState().viewingAgentTaskId
        ) {
          const msgs = messagesRef.current;
          const lastUserMsg = msgs.findLast(selectableUserMessagesFilter);
          if (lastUserMsg) {
            const idx = msgs.lastIndexOf(lastUserMsg);
            if (messagesAfterAreOnlySynthetic(msgs, idx)) {
              // The submit is being undone — undo its history entry too,
              // otherwise Up-arrow shows the restored text twice.
              removeLastFromHistory();
              restoreMessageSyncRef.current(lastUserMsg);
            }
          }
        }
      }
      return true;
    },
    [onQueryImpl, setAppState, resetLoadingState, queryGuard, mrOnBeforeQuery, mrOnTurnComplete],
  );

  // Handle initial message (from CLI args or plan mode exit with context clear)
  // This effect runs when isLoading becomes false and there's a pending message
  const initialMessageRef = useRef(false);
  useEffect(() => {
    const pending = initialMessage;
    if (!pending || isLoading || initialMessageRef.current) return;

    // Mark as processing to prevent re-entry
    initialMessageRef.current = true;

    async function processInitialMessage(initialMsg: NonNullable<typeof pending>) {
      // Clear context if requested (plan mode exit)
      if (initialMsg.clearContext) {
        // Preserve the plan slug before clearing context, so the new session
        // can access the same plan file after regenerateSessionId()
        const oldPlanSlug = initialMsg.message.planContent ? getPlanSlug() : undefined;

        const { clearConversation } = await import('../commands/clear/conversation.js');
        await clearConversation({
          setMessages,
          readFileState: readFileState.current,
          loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
          getAppState: () => store.getState(),
          setAppState,
          setConversationId,
        });
        haikuTitleAttemptedRef.current = false;
        setHaikuTitle(undefined);
        bashTools.current.clear();
        bashToolsProcessedIdx.current = 0;

        // Restore the plan slug for the new session so getPlan() finds the file
        if (oldPlanSlug) {
          setPlanSlug(getSessionId(), oldPlanSlug);
        }
      }

      // Atomically clear the message and restore the fixed auto workflow state.
      setAppState(prev => {
        return {
          ...prev,
          initialMessage: null,
          toolSafetyContext: {
            ...prev.toolSafetyContext,
            mode: 'auto',
          },
        };
      });

      // Create file history snapshot for code rewind
      if (fileHistoryEnabled()) {
        void fileHistoryMakeSnapshot((updater: (prev: FileHistoryState) => FileHistoryState) => {
          setAppState(prev => ({
            ...prev,
            fileHistory: updater(prev.fileHistory),
          }));
        }, initialMsg.message.uuid);
      }

      // Ensure SessionStart hook context is available before the first API
      // call. onSubmit calls this internally but the onQuery path below
      // bypasses onSubmit — hoist here so both paths see hook messages.
      awaitPendingHooks();

      // Route all initial prompts through onSubmit to ensure UserPromptSubmit hooks fire
      // TODO: Simplify by always routing through onSubmit once it supports
      // ContentBlockParam arrays (images) as input
      const content = initialMsg.message.message.content;

      // Route all string content through onSubmit to ensure hooks fire
      // For complex content (images, etc.), fall back to direct onQuery
      // Plan messages bypass onSubmit to preserve planContent metadata for rendering
      if (typeof content === 'string' && !initialMsg.message.planContent) {
        // Route through onSubmit for proper processing including UserPromptSubmit hooks
        void onSubmit(content, {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {},
        });
      } else {
        // Plan messages or complex content (images, etc.) - send directly to model
        // Plan messages use onQuery to preserve planContent metadata for rendering
        // TODO: Once onSubmit supports ContentBlockParam arrays, remove this branch
        const newAbortController = createAbortController();
        setAbortController(newAbortController);

        void onQuery(
          [initialMsg.message],
          newAbortController,
          true, // shouldQuery
          [], // additionalAllowedTools
          mainLoopModel,
        );
      }

      // Reset ref after a delay to allow new initial messages
      setTimeout(
        ref => {
          ref.current = false;
        },
        100,
        initialMessageRef,
      );
    }

    void processInitialMessage(pending);
  }, [initialMessage, isLoading, setMessages, setAppState, onQuery, mainLoopModel, tools]);

  const onSubmit = useCallback(
    async (input: string, helpers: PromptInputHelpers, options?: { fromKeybinding?: boolean }) => {
      // Re-pin scroll to bottom on submit so the user always sees the new
      // exchange (matches OpenCode's auto-scroll behavior).
      repinScroll();

      // Route user input to selected pipe targets (extracted to usePipeRouter)
      if (routeToSelectedPipes(input)) {
        // Show the user's prompt in the message list so they can see what was sent
        const userMessage = createUserMessage({ content: input });
        setMessages(prev => [...prev, userMessage]);

        if (!options?.fromKeybinding) {
          addToHistory({
            display: prependModeCharacterToInput(input, inputMode),
            pastedContents,
          });
        }
        setInputValue('');
        helpers.setCursorOffset(0);
        helpers.clearBuffer();
        setPastedContents({});
        setInputMode('prompt');
        setIDESelection(undefined);
        return;
      }

      // Handle immediate commands - these bypass the queue and execute right away
      // even while Claude is processing. Commands opt-in via `immediate: true`.
      // Commands triggered via keybindings are always treated as immediate.
      if (input.trim().startsWith('/')) {
        // Expand [Pasted text #N] refs so immediate commands receive
        // the pasted content, not the placeholder. The non-immediate path gets
        // this expansion later in handlePromptSubmit.
        const trimmedInput = expandPastedTextRefs(input, pastedContents).trim();
        const spaceIndex = trimmedInput.indexOf(' ');
        const commandName = spaceIndex === -1 ? trimmedInput.slice(1) : trimmedInput.slice(1, spaceIndex);
        const commandArgs = spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim();

        // Find matching command - treat as immediate if:
        // 1. Command has `immediate: true`, OR
        // 2. Command was triggered via keybinding (fromKeybinding option)
        const matchingCommand = commands.find(
          cmd =>
            isCommandEnabled(cmd) &&
            (cmd.name === commandName || cmd.aliases?.includes(commandName) || getCommandName(cmd) === commandName),
        );
        if (matchingCommand?.name === 'clear' && idleHintShownRef.current) {
          logEvent('tengu_idle_return_action', {
            action: 'hint_converted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            variant: idleHintShownRef.current as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            idleMinutes: Math.round((Date.now() - lastQueryCompletionTimeRef.current) / 60_000),
            messageCount: messagesRef.current.length,
            totalInputTokens: getTotalInputTokens(),
          });
          idleHintShownRef.current = false;
        }

        const shouldTreatAsImmediate = queryGuard.isActive && (matchingCommand?.immediate || options?.fromKeybinding);

        if (matchingCommand && shouldTreatAsImmediate && matchingCommand.type === 'local-jsx') {
          // Only clear input if the submitted text matches what's in the prompt.
          // When a command keybinding fires, input is "/<command>" but the actual
          // input value is the user's existing text - don't clear it in that case.
          if (input.trim() === inputValueRef.current.trim()) {
            setInputValue('');
            helpers.setCursorOffset(0);
            helpers.clearBuffer();
            setPastedContents({});
          }

          const pastedTextRefs = parseReferences(input).filter(r => pastedContents[r.id]?.type === 'text');
          const pastedTextCount = pastedTextRefs.length;
          const pastedTextBytes = pastedTextRefs.reduce(
            (sum, r) => sum + (pastedContents[r.id]?.content.length ?? 0),
            0,
          );
          logEvent('tengu_paste_text', { pastedTextCount, pastedTextBytes });
          logEvent('tengu_immediate_command_executed', {
            commandName: matchingCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            fromKeybinding: options?.fromKeybinding ?? false,
          });

          // Execute the command directly
          const executeImmediateCommand = async (): Promise<void> => {
            let doneWasCalled = false;
            const onDone = (
              result?: string,
              doneOptions?: {
                display?: CommandResultDisplay;
                metaMessages?: string[];
                displayArgs?: string;
              },
            ): void => {
              doneWasCalled = true;
              setToolJSX({
                jsx: null,
                shouldHidePromptInput: false,
                clearLocalJSX: true,
              });
              const newMessages: MessageType[] = [];
              if (result && doneOptions?.display !== 'skip') {
                addNotification({
                  key: `immediate-${matchingCommand.name}`,
                  text: result,
                  priority: 'immediate',
                });
                // In fullscreen the command just showed as a centered modal
                // pane — the notification above is enough feedback. Adding
                // "❯ /config" + "⎿ dismissed" to the transcript is clutter
                // (those messages are type:system subtype:local_command —
                // user-visible but NOT sent to the model, so skipping them
                // doesn't change model context). Outside fullscreen the
                // transcript entry stays so scrollback shows what ran.
                if (!isFullscreenEnvEnabled()) {
                  const breadcrumbArgs = doneOptions?.displayArgs ?? commandArgs;
                  newMessages.push(
                    createCommandInputMessage(formatCommandInputTags(getCommandName(matchingCommand), breadcrumbArgs)),
                    createCommandInputMessage(
                      `<${LOCAL_COMMAND_STDOUT_TAG}>${escapeXml(result)}</${LOCAL_COMMAND_STDOUT_TAG}>`,
                    ),
                  );
                }
              }
              // Inject meta messages (model-visible, user-hidden) into the transcript
              if (doneOptions?.metaMessages?.length) {
                newMessages.push(
                  ...doneOptions.metaMessages.map(content => createUserMessage({ content, isMeta: true })),
                );
              }
              if (newMessages.length) {
                setMessages(prev => [...prev, ...newMessages]);
              }
              // Restore stashed prompt after local-jsx command completes.
              // The normal stash restoration path (below) is skipped because
              // local-jsx commands return early from onSubmit.
              if (stashedPrompt !== undefined) {
                setInputValue(stashedPrompt.text);
                helpers.setCursorOffset(stashedPrompt.cursorOffset);
                setPastedContents(stashedPrompt.pastedContents);
                setStashedPrompt(undefined);
              }
            };

            // Build context for the command (reuses existing getToolUseContext).
            // Read messages via ref to keep onSubmit stable across message
            // updates — matches the pattern at L2384/L2400/L2662 and avoids
            // pinning stale REPL render scopes in downstream closures.
            const context = getToolUseContext(messagesRef.current, [], createAbortController(), mainLoopModel);

            const mod = await matchingCommand.load();
            const jsx = await mod.call(onDone, context, commandArgs);

            // Skip if onDone already fired — prevents stuck isLocalJSXCommand
            // (see processSlashCommand.tsx local-jsx case for full mechanism).
            if (jsx && !doneWasCalled) {
              // shouldHidePromptInput: false keeps Notifications mounted
              // so the onDone result isn't lost
              setToolJSX({
                jsx,
                shouldHidePromptInput: false,
                isLocalJSXCommand: true,
              });
            }
          };
          void executeImmediateCommand();
          return; // Always return early - don't add to history or queue
        }
      }

      // Idle-return: prompt returning users to start fresh when the
      // conversation is large and the cache is cold. tengu_willow_mode
      // controls treatment: "dialog" (blocking), "hint" (notification), "off".
      {
        const willowMode = getFeatureValue_CACHED_MAY_BE_STALE('tengu_willow_mode', 'off');
        const idleThresholdMin = Number(process.env.SOPHIA_IDLE_THRESHOLD_MINUTES ?? 75);
        const tokenThreshold = Number(process.env.SOPHIA_IDLE_TOKEN_THRESHOLD ?? 100_000);
        if (
          willowMode !== 'off' &&
          !getGlobalConfig().idleReturnDismissed &&
          !skipIdleCheckRef.current &&
          !input.trim().startsWith('/') &&
          lastQueryCompletionTimeRef.current > 0 &&
          getTotalInputTokens() >= tokenThreshold
        ) {
          const idleMs = Date.now() - lastQueryCompletionTimeRef.current;
          const idleMinutes = idleMs / 60_000;
          if (idleMinutes >= idleThresholdMin && willowMode === 'dialog') {
            setIdleReturnPending({ input, idleMinutes });
            setInputValue('');
            helpers.setCursorOffset(0);
            helpers.clearBuffer();
            return;
          }
        }
      }

      // Add to history for direct user submissions.
      // Queued command processing (executeQueuedInput) doesn't call onSubmit,
      // so notifications and already-queued user input won't be added to history here.
      // Skip history for keybinding-triggered commands (user didn't type the command).
      if (!options?.fromKeybinding) {
        addToHistory({
          display: prependModeCharacterToInput(input, inputMode),
          pastedContents,
        });
        // Add the just-submitted command to the front of the ghost-text
        // cache so it's suggested immediately (not after the 60s TTL).
        if (inputMode === 'bash') {
          prependToShellHistoryCache(input.trim());
        }
      }

      // Restore stash if present, but NOT for slash commands or when loading.
      // - Slash commands (especially interactive ones like /model, /context) hide
      //   the prompt and show a picker UI. Restoring the stash during a command would
      //   place the text in a hidden input, and the user would lose it by typing the
      //   next command. Instead, preserve the stash so it survives across command runs.
      // - When loading, the submitted input will be queued and handlePromptSubmit
      //   will clear the input field (onInputChange('')), which would clobber the
      //   restored stash. Defer restoration to after handlePromptSubmit (below).
      //   Remote mode is exempt: it sends via WebSocket and returns early without
      //   calling handlePromptSubmit, so there's no clobbering risk — restore eagerly.
      // In both deferred cases, the stash is restored after await handlePromptSubmit.
      const isSlashCommand = input.trim().startsWith('/');
      // Submit runs "now" (not queued) when not already loading or in remote
      // mode, which sends via WS and returns before handlePromptSubmit.
      const submitsNow = !isLoading;
      if (stashedPrompt !== undefined && !isSlashCommand && submitsNow) {
        setInputValue(stashedPrompt.text);
        helpers.setCursorOffset(stashedPrompt.cursorOffset);
        setPastedContents(stashedPrompt.pastedContents);
        setStashedPrompt(undefined);
      } else if (submitsNow) {
        if (!options?.fromKeybinding) {
          // Clear input when submitting immediately.
          // Preserve input for keybinding-triggered commands.
          setInputValue('');
          helpers.setCursorOffset(0);
        }
        setPastedContents({});
      }

      if (submitsNow) {
        setInputMode('prompt');
        setIDESelection(undefined);
        setSubmitCount(_ => _ + 1);
        helpers.clearBuffer();
        tipPickedThisTurnRef.current = false;

        // Keep the spinner active immediately while the submitted prompt is
        // being handed to the query loop. The committed user message is the
        // only transcript rendering for this input.
        if (!isSlashCommand && inputMode === 'prompt') {
          setUserInputOnProcessing(input);
          // showSpinner includes userInputOnProcessing, so the spinner appears
          // on this render. Reset timing refs now (before queryGuard.reserve()
          // would) so elapsed time doesn't read as Date.now() - 0. The
          // isQueryActive transition above does the same reset — idempotent.
          resetTimingRefs();
        }

        // Increment prompt count for attribution tracking and save snapshot
        // The snapshot persists promptCount so it survives compaction
        if (feature('COMMIT_ATTRIBUTION')) {
          setAppState(prev => ({
            ...prev,
            attribution: incrementPromptCount(prev.attribution, snapshot => {
              void recordAttributionSnapshot(snapshot).catch(error => {
                logForDebugging(`Attribution: Failed to save snapshot: ${error}`);
              });
            }),
          }));
        }
      }

      // Ensure SessionStart hook context is available before the first API call.
      await awaitPendingHooks();

      await handlePromptSubmit({
        input,
        helpers,
        queryGuard,
        isExternalLoading,
        mode: inputMode,
        commands,
        onInputChange: setInputValue,
        setPastedContents,
        setToolJSX,
        getToolUseContext,
        messages: messagesRef.current,
        mainLoopModel,
        pastedContents,
        ideSelection,
        setUserInputOnProcessing,
        setAbortController,
        abortController,
        onQuery,
        setAppState,
        querySource: getQuerySourceForREPL(),
        onBeforeQuery,
        canUseTool,
        addNotification,
        setMessages,
        // Read via ref so streamMode can be dropped from onSubmit deps —
        // handlePromptSubmit only uses it for debug log + telemetry event.
        streamMode: streamModeRef.current,
        hasInterruptibleToolInProgress: hasInterruptibleToolInProgressRef.current,
      });

      // Restore stash that was deferred above. Two cases:
      // - Slash command: handlePromptSubmit awaited the full command execution
      //   (including interactive pickers). Restoring now places the stash back in
      //   the visible input.
      // - Loading (queued): handlePromptSubmit enqueued + cleared input, then
      //   returned quickly. Restoring now places the stash back after the clear.
      if ((isSlashCommand || isLoading) && stashedPrompt !== undefined) {
        setInputValue(stashedPrompt.text);
        helpers.setCursorOffset(stashedPrompt.cursorOffset);
        setPastedContents(stashedPrompt.pastedContents);
        setStashedPrompt(undefined);
      }
    },
    [
      queryGuard,
      // isLoading is read at the !isLoading checks above for input-clearing
      // and submitCount gating. It's derived from isQueryActive || isExternalLoading,
      // so including it here ensures the closure captures the fresh value.
      isLoading,
      isExternalLoading,
      inputMode,
      commands,
      setInputValue,
      setInputMode,
      setPastedContents,
      setSubmitCount,
      setIDESelection,
      setToolJSX,
      getToolUseContext,
      // messages is read via messagesRef.current inside the callback to
      // keep onSubmit stable across message updates (see L2384/L2400/L2662).
      // Without this, each setMessages call (~30× per turn) recreates
      // onSubmit, pinning the REPL render scope (1776B) + that render's
      // messages array in downstream closures (PromptInput, handleAutoRunIssue).
      // Heap analysis showed ~9 REPL scopes and ~15 messages array versions
      // accumulating after #20174/#20175, all traced to this dep.
      mainLoopModel,
      pastedContents,
      ideSelection,
      setUserInputOnProcessing,
      setAbortController,
      addNotification,
      onQuery,
      stashedPrompt,
      setStashedPrompt,
      setAppState,
      onBeforeQuery,
      canUseTool,
      setMessages,
      awaitPendingHooks,
      repinScroll,
    ],
  );

  // Callback for when user submits input while viewing a teammate's transcript
  const onAgentSubmit = useCallback(
    async (input: string, task: InProcessTeammateTaskState | LocalAgentTaskState, helpers: PromptInputHelpers) => {
      if (isLocalAgentTask(task)) {
        appendMessageToLocalAgent(task.id, createUserMessage({ content: input }), setAppState);
        if (task.status === 'running') {
          queuePendingMessage(task.id, input, setAppState);
        } else {
          void resumeAgentBackground({
            agentId: task.id,
            prompt: input,
            toolUseContext: getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel),
            canUseTool,
          }).catch(err => {
            logForDebugging(`resumeAgentBackground failed: ${errorMessage(err)}`);
            addNotification({
              key: `resume-agent-failed-${task.id}`,
              jsx: <Text color="error">Failed to resume agent: {errorMessage(err)}</Text>,
              priority: 'low',
            });
          });
        }
      } else {
        injectUserMessageToTeammate(task.id, input, undefined, setAppState);
      }
      setInputValue('');
      helpers.setCursorOffset(0);
      helpers.clearBuffer();
    },
    [setAppState, setInputValue, getToolUseContext, canUseTool, mainLoopModel, addNotification],
  );

  // onSubmit is unstable (deps include `messages` which changes every turn).
  // `handleOpenRateLimitOptions` is prop-drilled to every MessageRow, and each
  // MessageRow fiber pins the closure (and transitively the entire REPL render
  // scope, ~1.8KB) at mount time. Using a ref keeps this callback stable so
  // old REPL scopes can be GC'd — saves ~35MB over a 1000-turn session.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const handleExit = useCallback(async () => {
    setIsExiting(true);
    // In bg sessions, always detach instead of kill — even when a worktree is
    // active. Without this guard, the worktree branch below short-circuits into
    // ExitFlow (which calls gracefulShutdown) before exit.tsx is ever loaded.
    const showWorktree = getCurrentWorktreeSession() !== null;
    if (showWorktree) {
      setExitFlow(
        <ExitFlow
          showWorktree
          onDone={() => {}}
          onCancel={() => {
            setExitFlow(null);
            setIsExiting(false);
          }}
        />,
      );
      return;
    }
    await gracefulShutdownSync(0, 'prompt_input_exit');
    setIsExiting(false);
  }, []);

  const handleShowMessageSelector = useCallback(() => {
    setIsMessageSelectorVisible(prev => !prev);
  }, []);

  // Rewind conversation state to just before `message`: slice messages,
  // reset conversation ID, microcompact state, and permission mode.
  // Does NOT touch the prompt input. Index is computed from messagesRef (always
  // fresh via the setMessages wrapper) so callers don't need to worry about
  // stale closures.
  const rewindConversationTo = useCallback(
    (message: UserMessage) => {
      const prev = messagesRef.current;
      const messageIndex = prev.lastIndexOf(message);
      if (messageIndex === -1) return;

      logEvent('tengu_conversation_rewind', {
        preRewindMessageCount: prev.length,
        postRewindMessageCount: messageIndex,
        messagesRemoved: prev.length - messageIndex,
        rewindToMessageIndex: messageIndex,
      });
      setMessages(prev.slice(0, messageIndex));
      // Careful, this has to happen after setMessages
      setConversationId(randomUUID());
      // Reset cached microcompact state so stale pinned cache edits
      // don't reference tool_use_ids from truncated messages
      resetMicrocompactState();
      if (feature('CONTEXT_COLLAPSE')) {
        // Rewind truncates the REPL array. Commits whose archived span
        // was past the rewind point can't be projected anymore
        // (projectView silently skips them) but the staged queue and ID
        // maps reference stale uuids. Simplest safe reset: drop
        // everything. The ctx-agent will re-stage on the next
        // threshold crossing.
      }

      // Restore state from the message we're rewinding to
      const permMode = message.executionMode as InternalExecutionMode | undefined;
      setAppState(prev => ({
        ...prev,
        // Restore permission mode from the message
        toolSafetyContext:
          permMode && prev.toolSafetyContext.mode !== permMode
            ? {
                ...prev.toolSafetyContext,
                mode: permMode,
              }
            : prev.toolSafetyContext,
      }));
    },
    [setMessages, setAppState],
  );

  // Synchronous rewind + input population. Used directly by auto-restore on
  // interrupt (so React batches with the abort's setMessages → single render,
  // no flicker). MessageSelector wraps this in setImmediate via handleRestoreMessage.
  const restoreMessageSync = useCallback(
    (message: UserMessage) => {
      rewindConversationTo(message);

      const r = textForResubmit(message);
      if (r) {
        setInputValue(r.text);
        setInputMode(r.mode);
      }

      // Restore pasted images
      if (Array.isArray(message.message.content) && message.message.content.some(block => block.type === 'image')) {
        const imageBlocks: Array<ImageBlockParam> = message.message.content.filter(block => block.type === 'image');
        if (imageBlocks.length > 0) {
          const newPastedContents: Record<number, PastedContent> = {};
          imageBlocks.forEach((block, index) => {
            if (block.source.type === 'base64') {
              const id = (message.imagePasteIds as number[] | undefined)?.[index] ?? index + 1;
              newPastedContents[id] = {
                id,
                type: 'image',
                content: block.source.data,
                mediaType: block.source.media_type,
              };
            }
          });
          setPastedContents(newPastedContents);
        }
      }
    },
    [rewindConversationTo, setInputValue],
  );
  restoreMessageSyncRef.current = restoreMessageSync;

  // MessageSelector path: defer via setImmediate so the "Interrupted" message
  // renders to static output before rewind — otherwise it remains vestigial
  // at the top of the screen.
  const handleRestoreMessage = useCallback(
    async (message: UserMessage) => {
      setImmediate((restore, message) => restore(message), restoreMessageSync, message);
    },
    [restoreMessageSync],
  );

  // Not memoized — hook stores caps via ref, reads latest closure at dispatch.
  // 24-char prefix: deriveUUID preserves first 24, renderable uuid prefix-matches raw source.
  const findRawIndex = (uuid: string) => {
    const prefix = uuid.slice(0, 24);
    return messages.findIndex(m => m.uuid.slice(0, 24) === prefix);
  };
  const messageActionCaps: MessageActionCaps = {
    copy: text =>
      // setClipboard RETURNS OSC 52 — caller must stdout.write (tmux side-effects load-buffer, but that's tmux-only).
      void setClipboard(text).then(raw => {
        if (raw) process.stdout.write(raw);
        addNotification({
          // Same key as text-selection copy — repeated copies replace toast, don't queue.
          key: 'selection-copied',
          text: 'copied',
          color: 'success',
          priority: 'immediate',
          timeoutMs: 2000,
        });
      }),
    edit: async msg => {
      // Same skip-confirm check as /rewind: lossless → direct, else confirm dialog.
      const rawIdx = findRawIndex(msg.uuid);
      const raw = rawIdx >= 0 ? messages[rawIdx] : undefined;
      if (!raw || !selectableUserMessagesFilter(raw)) return;
      const noFileChanges = !(await fileHistoryHasAnyChanges(fileHistory, raw.uuid));
      const onlySynthetic = messagesAfterAreOnlySynthetic(messages, rawIdx);
      if (noFileChanges && onlySynthetic) {
        // rewindConversationTo's setMessages races stream appends — cancel first (idempotent).
        onCancel();
        // handleRestoreMessage also restores pasted images.
        void handleRestoreMessage(raw);
      } else {
        // Dialog path: onPreRestore (= onCancel) fires when user CONFIRMS, not on nevermind.
        setMessageSelectorPreselect(raw);
        setIsMessageSelectorVisible(true);
      }
    },
  };
  const { enter: enterMessageActions, handlers: messageActionHandlers } = useMessageActions(
    cursor,
    setCursor,
    cursorNavRef,
    messageActionCaps,
  );

  async function onInit() {
    // Always verify API key on startup, so we can show the user an error in the
    // bottom right corner of the screen if the API key is invalid.
    void reverify();

    // Populate readFileState with SOPHIA.md files at startup
    const memoryFiles = await getMemoryFiles();
    if (memoryFiles.length > 0) {
      const fileList = memoryFiles
        .map(f => `  [${f.type}] ${f.path} (${f.content.length} chars)${f.parent ? ` (included by ${f.parent})` : ''}`)
        .join('\n');
      logForDebugging(`Loaded ${memoryFiles.length} SOPHIA.md/rules files:\n${fileList}`);
    } else {
      logForDebugging('No SOPHIA.md/rules files found');
    }
    for (const file of memoryFiles) {
      // When the injected content doesn't match disk (stripped HTML comments,
      // stripped frontmatter, MEMORY.md truncation), cache the RAW disk bytes
      // with isPartialView so Edit/Write require a real Read first while
      // getChangedFiles + nested_memory dedup still work.
      readFileState.current.set(file.path, {
        content: file.contentDiffersFromDisk ? (file.rawContent ?? file.content) : file.content,
        timestamp: Date.now(),
        offset: undefined,
        limit: undefined,
        isPartialView: file.contentDiffersFromDisk,
      });
    }

    // Initial message handling is done via the initialMessage effect
  }

  // Register cost summary tracker
  useCostSummary(useFpsMetrics());

  // Record transcripts locally, for debugging and conversation recovery
  // Don't record conversation if we only have initial messages; optimizes
  // the case where user resumes a conversation then quites before doing
  // anything else
  useLogMessages(messages, messages.length === initialMessages?.length);

  // REPL Bridge: replicate user/assistant messages to the bridge session
  // for remote access via claude.ai. No-op in external builds or when not enabled.

  useAfterFirstRender();

  // Track prompt queue usage for analytics. Fire once per transition from
  // empty to non-empty, not on every length change -- otherwise a render loop
  // (concurrent onQuery thrashing, etc.) spams saveGlobalConfig, which hits
  // ELOCKED under concurrent sessions and falls back to unlocked writes.
  // That write storm is the primary trigger for ~/.sophia.json corruption
  // (GH #3117).
  const hasCountedQueueUseRef = useRef(false);
  useEffect(() => {
    if (queuedCommands.length < 1) {
      hasCountedQueueUseRef.current = false;
      return;
    }
    if (hasCountedQueueUseRef.current) return;
    hasCountedQueueUseRef.current = true;
    saveGlobalConfig(current => ({
      ...current,
      promptQueueUseCount: (current.promptQueueUseCount ?? 0) + 1,
    }));
  }, [queuedCommands.length]);

  // Process queued commands when query completes and queue has items

  const executeQueuedInput = useCallback(
    async (queuedCommands: QueuedCommand[]) => {
      await handlePromptSubmit({
        helpers: {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {},
        },
        queryGuard,
        commands,
        onInputChange: () => {},
        setPastedContents: () => {},
        setToolJSX,
        getToolUseContext,
        messages,
        mainLoopModel,
        ideSelection,
        setUserInputOnProcessing,
        setAbortController,
        onQuery,
        setAppState,
        querySource: getQuerySourceForREPL(),
        onBeforeQuery,
        canUseTool,
        addNotification,
        setMessages,
        queuedCommands,
      });
    },
    [
      queryGuard,
      commands,
      setToolJSX,
      getToolUseContext,
      messages,
      mainLoopModel,
      ideSelection,
      setUserInputOnProcessing,
      canUseTool,
      setAbortController,
      onQuery,
      addNotification,
      setAppState,
      onBeforeQuery,
    ],
  );

  useQueueProcessor({
    executeQueuedInput,
    hasActiveLocalJsxUI: isShowingLocalJSXCommand,
    queryGuard,
  });

  // We'll use the global lastInteractionTime from state.ts

  // Update last interaction time when input changes.
  // Must be immediate because useEffect runs after the Ink render cycle flush.
  useEffect(() => {
    activityManager.recordUserActivity();
    updateLastInteractionTime(true);
  }, [inputValue, submitCount]);

  useEffect(() => {
    if (submitCount === 1) {
      startBackgroundHousekeeping();
    }
  }, [submitCount]);

  // Show notification when Claude is done responding and user is idle
  useEffect(() => {
    // Don't set up notification if Claude is busy
    if (isLoading) return;

    // Only enable notifications after the first new interaction in this session
    if (submitCount === 0) return;

    // No query has completed yet
    if (lastQueryCompletionTime === 0) return;

    // Set timeout to check idle state
    const timer = setTimeout(
      (lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal) => {
        // Check if user has interacted since the response ended
        const lastUserInteraction = getLastInteractionTime();

        if (lastUserInteraction > lastQueryCompletionTime) {
          // User has interacted since Claude finished - they're not idle, don't notify
          return;
        }

        // User hasn't interacted since response ended, check other conditions
        const idleTimeSinceResponse = Date.now() - lastQueryCompletionTime;
        if (
          !isLoading &&
          !toolJSX &&
          // Use ref to get current dialog state, avoiding stale closure
          focusedInputDialogRef.current === undefined &&
          idleTimeSinceResponse >= getGlobalConfig().messageIdleNotifThresholdMs
        ) {
          void sendNotification(
            {
              message: 'Claude is waiting for your input',
              notificationType: 'idle_prompt',
            },
            terminal,
          );
        }
      },
      getGlobalConfig().messageIdleNotifThresholdMs,
      lastQueryCompletionTime,
      isLoading,
      toolJSX,
      focusedInputDialogRef,
      terminal,
    );

    return () => clearTimeout(timer);
  }, [isLoading, toolJSX, submitCount, lastQueryCompletionTime, terminal]);

  // Idle-return hint: show notification when idle threshold is exceeded.
  // Timer fires after the configured idle period; notification persists until
  // dismissed or the user submits.
  useEffect(() => {
    if (lastQueryCompletionTime === 0) return;
    if (isLoading) return;
    const willowMode: string = getFeatureValue_CACHED_MAY_BE_STALE('tengu_willow_mode', 'off');
    if (willowMode !== 'hint' && willowMode !== 'hint_v2') return;
    if (getGlobalConfig().idleReturnDismissed) return;

    const tokenThreshold = Number(process.env.SOPHIA_IDLE_TOKEN_THRESHOLD ?? 100_000);
    if (getTotalInputTokens() < tokenThreshold) return;

    const idleThresholdMs = Number(process.env.SOPHIA_IDLE_THRESHOLD_MINUTES ?? 75) * 60_000;
    const elapsed = Date.now() - lastQueryCompletionTime;
    const remaining = idleThresholdMs - elapsed;

    const timer = setTimeout(
      (lqct, addNotif, msgsRef, mode, hintRef) => {
        if (msgsRef.current.length === 0) return;
        const totalTokens = getTotalInputTokens();
        const formattedTokens = formatTokens(totalTokens);
        const idleMinutes = (Date.now() - lqct) / 60_000;
        addNotif({
          key: 'idle-return-hint',
          jsx:
            mode === 'hint_v2' ? (
              <>
                <Text dimColor>new task? </Text>
                <Text color="suggestion">/new</Text>
                <Text dimColor> to save </Text>
                <Text color="suggestion">{formattedTokens} tokens</Text>
              </>
            ) : (
              <Text color="warning">new task? /new to save {formattedTokens} tokens</Text>
            ),
          priority: 'medium',
          // Persist until submit — the hint fires at T+75min idle, user may
          // not return for hours. removeNotification in useEffect cleanup
          // handles dismissal. 0x7FFFFFFF = setTimeout max (~24.8 days).
          timeoutMs: 0x7fffffff,
        });
        hintRef.current = mode;
        logEvent('tengu_idle_return_action', {
          action: 'hint_shown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          variant: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          idleMinutes: Math.round(idleMinutes),
          messageCount: msgsRef.current.length,
          totalInputTokens: totalTokens,
        });
      },
      Math.max(0, remaining),
      lastQueryCompletionTime,
      addNotification,
      messagesRef,
      willowMode,
      idleHintShownRef,
    );

    return () => {
      clearTimeout(timer);
      removeNotification('idle-return-hint');
      idleHintShownRef.current = false;
    };
  }, [lastQueryCompletionTime, isLoading, addNotification, removeNotification]);

  // Submits incoming prompts from teammate messages or tasks mode as new turns
  // Returns true if submission succeeded, false if a query is already running
  const handleIncomingPrompt = useCallback(
    (input: string | QueuedCommand, options?: { isMeta?: boolean }): boolean => {
      if (queryGuard.isActive) return false;

      // Defer to user-queued commands — user input always takes priority
      // over system messages (teammate messages, task list items, etc.)
      // Read from the module-level store at call time (not the render-time
      // snapshot) to avoid a stale closure — this callback's deps don't
      // include the queue.
      if (getCommandQueue().some(cmd => cmd.mode === 'prompt' || cmd.mode === 'bash')) {
        return false;
      }

      const queuedCommand =
        typeof input === 'string'
          ? ({
              value: input,
              mode: 'prompt',
              isMeta: options?.isMeta ? true : undefined,
            } satisfies QueuedCommand)
          : input;

      void (async () => {
        const claim = await claimConsumableQueuedAutonomyCommands([queuedCommand]);
        const command = claim.attachmentCommands[0];
        if (!command) return;

        const newAbortController = createAbortController();
        setAbortController(newAbortController);

        // Create a user message with the formatted content (includes XML wrapper)
        const userMessage = createUserMessage({
          content: command.value,
          isMeta: command.isMeta ? true : undefined,
          origin: command.origin,
        });

        let executed = false;
        try {
          executed = (await onQuery([userMessage], newAbortController, true, [], mainLoopModel)) !== false;
        } catch (error: unknown) {
          try {
            await finalizeAutonomyCommandsForTurn({
              commands: claim.claimedCommands,
              outcome: { type: 'failed', error },
              currentDir: getCwd(),
              priority: 'later',
            });
          } catch (finalizeError: unknown) {
            logError(toError(finalizeError));
          }
          logError(toError(error));
          return;
        }

        // Only finalize as completed when onQuery actually executed the turn
        // (it returns false from the concurrent-guard path without running).
        // Keep this finalize in its own try/catch so a failure here does not
        // trigger a second finalize as `failed` for the same commands.
        if (!executed) {
          return;
        }
        try {
          const nextCommands = await finalizeAutonomyCommandsForTurn({
            commands: claim.claimedCommands,
            outcome: { type: 'completed' },
            currentDir: getCwd(),
            priority: 'later',
          });
          for (const nextCommand of nextCommands) {
            enqueue(nextCommand);
          }
        } catch (finalizeError: unknown) {
          logError(toError(finalizeError));
        }
      })().catch((error: unknown) => {
        logError(toError(error));
      });
      return true;
    },
    [onQuery, mainLoopModel, store],
  );

  const { relayPipeMessage, pipeReturnHadErrorRef } = usePipeRelay();

  useInboxPoller({
    enabled: isAgentSwarmsEnabled(),
    isLoading,
    focusedInputDialog,
    onSubmitMessage: handleIncomingPrompt,
  });

  useMailboxBridge({ isLoading, onSubmitMessage: handleIncomingPrompt });
  useMasterMonitor();
  useSlaveNotifications();
  const _pipeIpcState = useAppState(s => getPipeIpc(s));

  usePipeMuteSync();

  // Pipe IPC lifecycle — extracted to usePipeIpc hook
  usePipeIpc({ store, handleIncomingPrompt });
  const { routeToSelectedPipes } = usePipeRouter({ store, setAppState, addNotification });

  // Scheduled tasks from .sophia/scheduled_tasks.json (CronCreate/Delete/List)
  useScheduledTasks({ isLoading, assistantMode: false, setMessages });

  // Note: Permission polling is now handled by useInboxPoller
  // - Workers receive permission responses via mailbox messages
  // - Leaders receive permission requests via mailbox messages

  if (process.env.USER_TYPE === 'ant') {
    // Tasks mode: watch for tasks and auto-process them
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useTaskListWatcher({
      taskListId,
      isLoading,
      onSubmitTask: handleIncomingPrompt,
    });
  }

  // Abort the current operation when a 'now' priority message arrives
  // (e.g. from a chat UI client via UDS).
  useEffect(() => {
    if (queuedCommands.some(cmd => cmd.priority === 'now')) {
      abortControllerRef.current?.abort('interrupt');
    }
  }, [queuedCommands]);

  const onInitRef = useRef(onInit);
  onInitRef.current = onInit;
  const diagnosticTrackerRef = useRef(diagnosticTracker);
  diagnosticTrackerRef.current = diagnosticTracker;

  // Initial load
  useEffect(() => {
    void onInitRef.current();

    // Cleanup on unmount
    return () => {
      void diagnosticTrackerRef.current.shutdown();
    };
  }, []);

  // Listen for suspend/resume events
  const { internal_eventEmitter } = useStdin();
  const [remountKey, setRemountKey] = useState(0);
  useEffect(() => {
    const handleSuspend = () => {
      // Print suspension instructions
      process.stdout.write(
        `\nSophia Agent has been suspended. Run \`fg\` to bring Sophia Agent back.\nNote: ctrl + z now suspends Sophia Agent, ctrl + _ undoes input.\n`,
      );
    };

    const handleResume = () => {
      // Force complete component tree replacement instead of terminal clear
      // Ink now handles line count reset internally on SIGCONT
      setRemountKey(prev => prev + 1);
    };

    internal_eventEmitter?.on('suspend', handleSuspend);
    internal_eventEmitter?.on('resume', handleResume);
    return () => {
      internal_eventEmitter?.off('suspend', handleSuspend);
      internal_eventEmitter?.off('resume', handleResume);
    };
  }, [internal_eventEmitter]);

  // Derive stop hook spinner suffix from messages state
  const stopHookSpinnerSuffix = useMemo(() => {
    if (!isLoading) return null;

    // Find stop hook progress messages
    const progressMsgs = messages.filter((m): m is ProgressMessage<HookProgress> => {
      if (m.type !== 'progress') return false;
      const data = m.data as Record<string, unknown>;
      return data.type === 'hook_progress' && (data.hookEvent === 'Stop' || data.hookEvent === 'SubagentStop');
    });
    if (progressMsgs.length === 0) return null;

    // Get the most recent stop hook execution
    const currentToolUseID = progressMsgs.at(-1)?.toolUseID;
    if (!currentToolUseID) return null;

    // Check if there's already a summary message for this execution (hooks completed)
    const hasSummaryForCurrentExecution = messages.some(
      m => m.type === 'system' && m.subtype === 'stop_hook_summary' && m.toolUseID === currentToolUseID,
    );
    if (hasSummaryForCurrentExecution) return null;

    const currentHooks = progressMsgs.filter(p => p.toolUseID === currentToolUseID);
    const total = currentHooks.length;

    // Count completed hooks
    const completedCount = count(messages, m => {
      if (m.type !== 'attachment') return false;
      const attachment = m.attachment!;
      return (
        'hookEvent' in attachment &&
        (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop') &&
        'toolUseID' in attachment &&
        attachment.toolUseID === currentToolUseID
      );
    });

    // Check if any hook has a custom status message
    const customMessage = currentHooks.find(p => p.data.statusMessage)?.data.statusMessage;

    if (customMessage) {
      // Use custom message with progress counter if multiple hooks
      return total === 1 ? `${customMessage}…` : `${customMessage}… ${completedCount}/${total}`;
    }

    // Fall back to default behavior
    const hookType = currentHooks[0]?.data.hookEvent === 'SubagentStop' ? 'subagent stop' : 'stop';

    if (process.env.USER_TYPE === 'ant') {
      const cmd = currentHooks[completedCount]?.data.command;
      const label = cmd ? ` '${truncateToWidth(cmd, 40)}'` : '';
      return total === 1
        ? `running ${hookType} hook${label}`
        : `running ${hookType} hook${label}\u2026 ${completedCount}/${total}`;
    }

    return total === 1 ? `running ${hookType} hook` : `running stop hooks… ${completedCount}/${total}`;
  }, [messages, isLoading]);

  // Callback to capture frozen state when entering transcript mode
  const handleEnterTranscript = useCallback(() => {
    setFrozenTranscriptState({
      messagesLength: messages.length,
      streamingToolUsesLength: streamingToolUses.length,
    });
  }, [messages.length, streamingToolUses.length]);

  // Callback to clear frozen state when exiting transcript mode
  const handleExitTranscript = useCallback(() => {
    setFrozenTranscriptState(null);
  }, []);

  // Props for GlobalKeybindingHandlers component (rendered inside KeybindingSetup)
  const virtualScrollActive = isFullscreenEnvEnabled() && !disableVirtualScroll;

  // Transcript search state. Hooks must be unconditional so they live here
  // (not inside the `if (screen === 'transcript')` branch below); isActive
  // gates the useInput. Query persists across bar open/close so n/N keep
  // working after Enter dismisses the bar (less semantics).
  const jumpRef = useRef<JumpHandle | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCount, setSearchCount] = useState(0);
  const [searchCurrent, setSearchCurrent] = useState(0);
  const onSearchMatchesChange = useCallback((count: number, current: number) => {
    setSearchCount(count);
    setSearchCurrent(current);
  }, []);

  useInput(
    (input, key, event) => {
      if (key.ctrl || key.meta) return;
      // No Esc handling here — less has no navigating mode. Search state
      // (highlights, n/N) is just state. Esc/q/ctrl+c → transcript:exit
      // (ungated). Highlights clear on exit via the screen-change effect.
      if (input === '/') {
        // Capture scrollTop NOW — typing is a preview, 0-matches snaps
        // back here. Synchronous ref write, fires before the bar's
        // mount-effect calls setSearchQuery.
        jumpRef.current?.setAnchor();
        setSearchOpen(true);
        event.stopImmediatePropagation();
        return;
      }
      // Held-key batching: tokenizer coalesces to 'nnn'. Same uniform-batch
      // pattern as modalPagerAction in ScrollKeybindingHandler.tsx. Each
      // repeat is a step (n isn't idempotent like g).
      const c = input[0];
      if ((c === 'n' || c === 'N') && input === c.repeat(input.length) && searchCount > 0) {
        const fn = c === 'n' ? jumpRef.current?.nextMatch : jumpRef.current?.prevMatch;
        if (fn) for (let i = 0; i < input.length; i++) fn();
        event.stopImmediatePropagation();
      }
    },
    // Search needs virtual scroll (jumpRef drives VirtualMessageList). [
    // kills it, so !dumpMode — after [ there's nothing to jump in.
    {
      isActive: screen === 'transcript' && virtualScrollActive && !searchOpen && !dumpMode,
    },
  );
  const { setQuery: setHighlight, scanElement, setPositions } = useSearchHighlight();

  // Resize → abort search. Positions are (msg, query, WIDTH)-keyed —
  // cached positions are stale after a width change (new layout, new
  // wrapping). Clearing searchQuery triggers VML's setSearchQuery('')
  // which clears positionsCache + setPositions(null). Bar closes.
  // User hits / again → fresh everything.
  const transcriptCols = useTerminalSize().columns;
  const prevColsRef = React.useRef(transcriptCols);
  React.useEffect(() => {
    if (prevColsRef.current !== transcriptCols) {
      prevColsRef.current = transcriptCols;
      if (searchQuery || searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchCount(0);
        setSearchCurrent(0);
        jumpRef.current?.disarmSearch();
        setHighlight('');
      }
    }
  }, [transcriptCols, searchQuery, searchOpen, setHighlight]);

  // Transcript escape hatches. Bare letters in modal context (no prompt
  // competing for input) — same class as g/G/j/k in ScrollKeybindingHandler.
  useInput(
    (input, key, event) => {
      if (key.ctrl || key.meta) return;
      if (input === 'q') {
        // less: q quits the pager. ctrl+o toggles; q is the lineage exit.
        handleExitTranscript();
        event.stopImmediatePropagation();
        return;
      }
      if (input === '[' && !dumpMode) {
        // Force dump-to-scrollback. Also expand + uncap — no point dumping
        // a subset. Terminal/tmux cmd-F can now find anything. Guard here
        // (not in isActive) so v still works post-[ — dump-mode footer at
        // ~4898 wires editorStatus, confirming v is meant to stay live.
        setDumpMode(true);
        setShowAllInTranscript(true);
        event.stopImmediatePropagation();
      } else if (input === 'v') {
        // less-style: v opens the file in $VISUAL/$EDITOR. Render the full
        // transcript (same path /export uses), write to tmp, hand off.
        // openFileInExternalEditor handles alt-screen suspend/resume for
        // terminal editors; GUI editors spawn detached.
        event.stopImmediatePropagation();
        // Drop double-taps: the render is async and a second press before it
        // completes would run a second parallel render (double memory, two
        // tempfiles, two editor spawns). editorGenRef only guards
        // transcript-exit staleness, not same-session concurrency.
        if (editorRenderingRef.current) return;
        editorRenderingRef.current = true;
        // Capture generation + make a staleness-aware setter. Each write
        // checks gen (transcript exit bumps it → late writes from the
        // async render go silent).
        const gen = editorGenRef.current;
        const setStatus = (s: string): void => {
          if (gen !== editorGenRef.current) return;
          clearTimeout(editorTimerRef.current);
          setEditorStatus(s);
        };
        setStatus(`rendering ${deferredMessages.length} messages…`);
        void (async () => {
          try {
            // Width = terminal minus vim's line-number gutter (4 digits +
            // space + slack). Floor at 80. PassThrough has no .columns so
            // without this Ink defaults to 80. Trailing-space strip: right-
            // aligned timestamps still leave a flexbox spacer run at EOL.
            // eslint-disable-next-line custom-rules/prefer-use-terminal-size -- one-shot at keypress time, not a reactive render dep
            const w = Math.max(80, (process.stdout.columns ?? 80) - 6);
            const raw = await renderMessagesToPlainText(deferredMessages, tools, w);
            const text = raw.replace(/[ \t]+$/gm, '');
            const path = join(tmpdir(), `cc-transcript-${Date.now()}.txt`);
            await writeFile(path, text);
            const opened = openFileInExternalEditor(path);
            setStatus(opened ? `opening ${path}` : `wrote ${path} · no $VISUAL/$EDITOR set`);
          } catch (e) {
            setStatus(`render failed: ${e instanceof Error ? e.message : String(e)}`);
          }
          editorRenderingRef.current = false;
          if (gen !== editorGenRef.current) return;
          editorTimerRef.current = setTimeout(s => s(''), 4000, setEditorStatus);
        })();
      }
    },
    // !searchOpen: typing 'v' or '[' in the search bar is search input, not
    // a command. No !dumpMode here — v should work after [ (the [ handler
    // guards itself inline).
    { isActive: screen === 'transcript' && virtualScrollActive && !searchOpen },
  );

  // Fresh `less` per transcript entry. Prevents stale highlights matching
  // unrelated normal-mode text (overlay is alt-screen-global) and avoids
  // surprise n/N on re-entry. Same exit resets [ dump mode — each ctrl+o
  // entry is a fresh instance.
  const inTranscript = screen === 'transcript' && virtualScrollActive;
  useEffect(() => {
    if (!inTranscript) {
      setSearchQuery('');
      setSearchCount(0);
      setSearchCurrent(0);
      setSearchOpen(false);
      editorGenRef.current++;
      clearTimeout(editorTimerRef.current);
      setDumpMode(false);
      setEditorStatus('');
    }
  }, [inTranscript]);
  useEffect(() => {
    setHighlight(inTranscript ? searchQuery : '');
    // Clear the position-based CURRENT (yellow) overlay too. setHighlight
    // only clears the scan-based inverse. Without this, the yellow box
    // persists at its last screen coords after ctrl-c exits transcript.
    if (!inTranscript) setPositions(null);
  }, [inTranscript, searchQuery, setHighlight, setPositions]);

  const globalKeybindingProps = {
    screen,
    setScreen,
    showAllInTranscript,
    setShowAllInTranscript,
    messageCount: messages.length,
    onEnterTranscript: handleEnterTranscript,
    onExitTranscript: handleExitTranscript,
    virtualScrollActive,
    // Bar-open is a mode (owns keystrokes — j/k type, Esc cancels).
    // Navigating (query set, bar closed) is NOT — Esc exits transcript,
    // same as less q with highlights still visible. useSearchInput
    // doesn't stopPropagation, so without this gate transcript:exit
    // would fire on the same Esc that cancels the bar (child registers
    // first, fires first, bubbles).
    searchBarOpen: searchOpen,
  };

  // Use frozen lengths to slice arrays, avoiding memory overhead of cloning
  const transcriptMessages = frozenTranscriptState
    ? deferredMessages.slice(0, frozenTranscriptState.messagesLength)
    : deferredMessages;
  const transcriptStreamingToolUses = frozenTranscriptState
    ? streamingToolUses.slice(0, frozenTranscriptState.streamingToolUsesLength)
    : streamingToolUses;

  // Handle shift+down for teammate navigation and background task management.
  // Guard onOpenBackgroundTasks when a local-jsx dialog (for example, /config) is open —
  // otherwise Shift+Down stacks BackgroundTasksDialog on top and deadlocks input.
  // Third case: Shift+Down toggles the pipe IPC selector panel when pipes are active.
  useBackgroundTaskNavigation({
    onOpenBackgroundTasks: isShowingLocalJSXCommand ? undefined : () => setShowBashesDialog(true),
    onTogglePipeSelector: () => {
      setAppState((prev: any) => {
        const pIpc = prev.pipeIpc ?? {};
        return { ...prev, pipeIpc: { ...pIpc, selectorOpen: !pIpc.selectorOpen } };
      });
    },
  });
  // Auto-exit viewing mode when teammate completes or errors
  useTeammateViewAutoExit();

  // Get viewed agent task (inlined from selectors for explicit data flow).
  // viewedAgentTask: teammate OR local_agent — drives the boolean checks
  // below. viewedTeammateTask: teammate-only narrowed, for teammate-specific
  // field access (inProgressToolUseIDs).
  const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const viewedTeammateTask = viewedTask && isInProcessTeammateTask(viewedTask) ? viewedTask : undefined;
  const viewedAgentTask = viewedTeammateTask ?? (viewedTask && isLocalAgentTask(viewedTask) ? viewedTask : undefined);

  // Bypass useDeferredValue when streaming text is showing so Messages renders
  // the final message in the same frame streaming text clears. Also bypass when
  // not loading — deferredMessages only matters during streaming (keeps input
  // responsive); after the turn ends, showing messages immediately prevents a
  // jitter gap where the spinner is gone but the answer hasn't appeared yet.
  // Only reducedMotion users keep the deferred path during loading.
  const usesSyncMessages = showStreamingText || !isLoading;
  // When viewing an agent, never fall through to leader — empty until
  // bootstrap/stream fills. Closes the see-leader-type-agent footgun.
  const rawAgentMessages = viewedAgentTask?.messages;
  // Fork sidechain encodes the user prompt inside a mixed user message alongside
  // tool_result blocks; surface the prompt as a standalone bubble and strip the
  // boilerplate text from its original carrier while preserving tool_results.
  const displayedAgentMessages = useMemo(() => {
    if (!viewedAgentTask) return undefined;
    const agentMessages = rawAgentMessages ?? [];
    if (
      !isLocalAgentTask(viewedAgentTask) ||
      viewedAgentTask.agentType !== FORK_SUBAGENT_TYPE ||
      !viewedAgentTask.prompt
    ) {
      return agentMessages;
    }
    // Single pass: locate boilerplate carrier, check whether the prompt text is
    // already present elsewhere, and find the fallback insertion point (after
    // the last parent assistant tool_use).
    const trimmedPrompt = viewedAgentTask.prompt.trim();
    let boilerplateIndex = -1;
    let lastAssistantToolUseIndex = -1;
    let promptAlreadyRendered = false;
    for (let i = 0; i < agentMessages.length; i++) {
      const m = agentMessages[i]!;
      if (m.type === 'user' && Array.isArray(m.message?.content)) {
        const hasBoilerplate = m.message.content.some(isForkBoilerplateTextBlock);
        if (hasBoilerplate) {
          boilerplateIndex = i;
        } else if (!promptAlreadyRendered) {
          const firstText = m.message.content.find(b => b.type === 'text' && typeof b.text === 'string') as
            | { type: 'text'; text: string }
            | undefined;
          if (firstText && firstText.text.trim() === trimmedPrompt) promptAlreadyRendered = true;
        }
        continue;
      }
      if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        if (m.message.content.some(b => b.type === 'tool_use')) lastAssistantToolUseIndex = i;
      }
    }

    const stripped =
      boilerplateIndex === -1
        ? agentMessages
        : agentMessages.map((m, i) => {
            if (i !== boilerplateIndex) return m;
            if (!Array.isArray(m.message?.content)) return m;
            return {
              ...m,
              message: {
                ...m.message,
                content: m.message.content.filter(b => !isForkBoilerplateTextBlock(b)),
              },
            };
          });

    if (promptAlreadyRendered) return stripped;

    const insertAt = boilerplateIndex !== -1 ? boilerplateIndex + 1 : lastAssistantToolUseIndex + 1;
    const synthetic = createUserMessage({
      content: viewedAgentTask.prompt,
      timestamp: new Date(viewedAgentTask.startTime).toISOString(),
    });
    return [...stripped.slice(0, insertAt), synthetic, ...stripped.slice(insertAt)];
  }, [viewedAgentTask, rawAgentMessages]);
  const displayedMessages = viewedAgentTask
    ? (displayedAgentMessages ?? [])
    : usesSyncMessages
      ? messages
      : deferredMessages;

  if (screen === 'transcript') {
    // Virtual scroll replaces the 30-message cap: everything is scrollable
    // and memory is bounded by the viewport. Without it, wrapping transcript
    // in a ScrollBox would mount all messages (~250 MB on long sessions —
    // the exact problem), so the kill switch and non-fullscreen paths must
    // fall through to the legacy render: no alt screen, dump to terminal
    // scrollback, 30-cap + Ctrl+E. Reusing scrollRef is safe — normal-mode
    // and transcript-mode are mutually exclusive (this early return), so
    // only one ScrollBox is ever mounted at a time.
    const transcriptScrollRef = isFullscreenEnvEnabled() && !disableVirtualScroll && !dumpMode ? scrollRef : undefined;
    const transcriptMessagesElement = (
      <Messages
        messages={transcriptMessages}
        tools={tools}
        commands={commands}
        verbose={true}
        toolJSX={null}
        inProgressToolUseIDs={inProgressToolUseIDs}
        isMessageSelectorVisible={false}
        conversationId={conversationId}
        screen={screen}
        agentDefinitions={agentDefinitions}
        streamingToolUses={transcriptStreamingToolUses}
        showAllInTranscript={showAllInTranscript}
        isLoading={isLoading}
        hidePastThinking={true}
        streamingThinking={streamingThinking}
        scrollRef={transcriptScrollRef}
        jumpRef={jumpRef}
        onSearchMatchesChange={onSearchMatchesChange}
        scanElement={scanElement}
        setPositions={setPositions}
        disableRenderCap={dumpMode}
      />
    );
    const transcriptToolJSX = toolJSX && (
      <Box flexDirection="column" width="100%">
        {toolJSX.jsx}
      </Box>
    );
    const transcriptReturn = (
      <KeybindingSetup>
        <AnimatedTerminalTitle
          isAnimating={titleIsAnimating}
          title={terminalTitle}
          disabled={titleDisabled}
          noPrefix={showStatusInTerminalTab}
        />
        <GlobalKeybindingHandlers {...globalKeybindingProps} />
        <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!toolJSX?.isLocalJSXCommand} />
        {transcriptScrollRef ? (
          // ScrollKeybindingHandler must mount before CancelRequestHandler so
          // ctrl+c-with-selection copies instead of cancelling the active task.
          // Its raw useInput handler only stops propagation when a selection
          // exists — without one, ctrl+c falls through to CancelRequestHandler.
          <ScrollKeybindingHandler
            scrollRef={scrollRef}
            isActive
            // g/G/j/k/ctrl+u/ctrl+d would eat keystrokes the search bar
            // wants. Off while searching.
            isModal={!searchOpen}
            // Manual scroll exits the search context — clear the yellow
            // current-match marker. Positions are (msg, rowOffset)-keyed;
            // j/k changes scrollTop so rowOffset is stale → wrong row
            // gets yellow. Next n/N re-establishes via step()→jump().
            onScroll={() => jumpRef.current?.disarmSearch()}
          />
        ) : null}
        <CancelRequestHandler {...cancelRequestProps} />
        {transcriptScrollRef ? (
          <FullscreenLayout
            scrollRef={scrollRef}
            scrollable={
              <>
                {transcriptMessagesElement}
                {transcriptToolJSX}
                <SandboxViolationExpandedView />
              </>
            }
            bottom={
              searchOpen ? (
                <TranscriptSearchBar
                  jumpRef={jumpRef}
                  // Seed was tried (c01578c8) — broke /hello muscle
                  // memory (cursor lands after 'foo', /hello → foohello).
                  // Cancel-restore handles the 'don't lose prior search'
                  // concern differently (onCancel re-applies searchQuery).
                  initialQuery=""
                  count={searchCount}
                  current={searchCurrent}
                  onClose={q => {
                    // Enter — commit. 0-match guard: junk query shouldn't
                    // persist (badge hidden, n/N dead anyway).
                    setSearchQuery(searchCount > 0 ? q : '');
                    setSearchOpen(false);
                    // onCancel path: bar unmounts before its useEffect([query])
                    // can fire with ''. Without this, searchCount stays stale
                    // (n guard at :4956 passes) and VML's matches[] too
                    // (nextMatch walks the old array). Phantom nav, no
                    // highlight. onExit (Enter, q non-empty) still commits.
                    if (!q) {
                      setSearchCount(0);
                      setSearchCurrent(0);
                      jumpRef.current?.setSearchQuery('');
                    }
                  }}
                  onCancel={() => {
                    // Esc/ctrl+c/ctrl+g — undo. Bar's effect last fired
                    // with whatever was typed. searchQuery (REPL state)
                    // is unchanged since / (onClose = commit, didn't run).
                    // Two VML calls: '' restores anchor (0-match else-
                    // branch), then searchQuery re-scans from anchor's
                    // nearest. Both synchronous — one React batch.
                    // setHighlight explicit: REPL's sync-effect dep is
                    // searchQuery (unchanged), wouldn't re-fire.
                    setSearchOpen(false);
                    jumpRef.current?.setSearchQuery('');
                    jumpRef.current?.setSearchQuery(searchQuery);
                    setHighlight(searchQuery);
                  }}
                  setHighlight={setHighlight}
                />
              ) : (
                <TranscriptModeFooter
                  showAllInTranscript={showAllInTranscript}
                  virtualScroll={true}
                  status={editorStatus || undefined}
                  searchBadge={
                    searchQuery && searchCount > 0 ? { current: searchCurrent, count: searchCount } : undefined
                  }
                />
              )
            }
          />
        ) : (
          <>
            {transcriptMessagesElement}
            {transcriptToolJSX}
            <SandboxViolationExpandedView />
            <TranscriptModeFooter
              showAllInTranscript={showAllInTranscript}
              virtualScroll={false}
              suppressShowAll={dumpMode}
              status={editorStatus || undefined}
            />
          </>
        )}
      </KeybindingSetup>
    );
    // The virtual-scroll branch (FullscreenLayout above) needs
    // <AlternateScreen>'s <Box height={rows}> constraint — without it,
    // ScrollBox's flexGrow has no ceiling, viewport = content height,
    // scrollTop pins at 0, and Ink's screen buffer sizes to the full
    // spacer (200×5k+ rows on long sessions). Same root type + props as
    // normal mode's wrap below so React reconciles and the alt buffer
    // stays entered across toggle. The 30-cap dump branch stays
    // unwrapped — it wants native terminal scrollback.
    if (transcriptScrollRef) {
      return <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>{transcriptReturn}</AlternateScreen>;
    }
    return transcriptReturn;
  }

  // In fullscreen, ALL local-jsx slash commands float in the modal slot —
  // FullscreenLayout wraps them in an absolute-positioned bottom-anchored
  // pane (▔ divider, ModalContext). Pane/Dialog inside detect the context
  // and skip their own top-level frame. Non-fullscreen keeps the inline
  // render paths below. All current local JSX commands use this path.
  const toolJsxCentered = isFullscreenEnvEnabled() && toolJSX?.isLocalJSXCommand === true;
  const centeredModal: React.ReactNode = toolJsxCentered ? toolJSX!.jsx : null;
  // <AlternateScreen> at the root: everything below is inside its
  // <Box height={rows}>. Handlers/contexts are zero-height so ScrollBox's
  // flexGrow in FullscreenLayout resolves against this Box. The transcript
  // early return above wraps its virtual-scroll branch the same way; only
  // the 30-cap dump branch stays unwrapped for native terminal scrollback.

  const mainReturn = (
    <KeybindingSetup>
      <AnimatedTerminalTitle
        isAnimating={titleIsAnimating}
        title={terminalTitle}
        disabled={titleDisabled}
        noPrefix={showStatusInTerminalTab}
      />
      <GlobalKeybindingHandlers {...globalKeybindingProps} />
      <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!toolJSX?.isLocalJSXCommand} />
      {/* ScrollKeybindingHandler must mount before CancelRequestHandler so
          ctrl+c-with-selection copies instead of cancelling the active task.
          Its raw useInput handler only stops propagation when a selection
          exists — without one, ctrl+c falls through to CancelRequestHandler.
          PgUp/PgDn/wheel always scroll the transcript behind the modal —
          the modal's inner ScrollBox is not keyboard-driven. onScroll
          stays suppressed while a modal is showing so scroll doesn't
          stamp divider/pill state. */}
      <ScrollKeybindingHandler
        scrollRef={scrollRef}
        isActive={
          isFullscreenEnvEnabled() &&
          (centeredModal != null || !focusedInputDialog || focusedInputDialog === 'user-question')
        }
        onScroll={composedOnScroll}
      />
      {feature('MESSAGE_ACTIONS') && isFullscreenEnvEnabled() && !disableMessageActions ? (
        <MessageActionsKeybindings handlers={messageActionHandlers} isActive={cursor !== null} />
      ) : null}
      <CancelRequestHandler {...cancelRequestProps} />
      <MCPConnectionManager key={remountKey} dynamicMcpConfig={dynamicMcpConfig} isStrictMcpConfig={strictMcpConfig}>
        <FullscreenLayout
          scrollRef={scrollRef}
          modal={centeredModal}
          modalScrollRef={modalScrollRef}
          dividerYRef={dividerYRef}
          hidePill={!!viewedAgentTask}
          hideSticky={!!viewedTeammateTask}
          newMessageCount={unseenDivider?.count ?? 0}
          onPillClick={() => {
            setCursor(null);
            jumpToNew(scrollRef.current);
          }}
          scrollable={
            <>
              <TeammateViewHeader />
              <Messages
                messages={displayedMessages}
                tools={tools}
                commands={commands}
                verbose={verbose}
                toolJSX={toolJSX}
                inProgressToolUseIDs={
                  viewedTeammateTask ? (viewedTeammateTask.inProgressToolUseIDs ?? new Set()) : inProgressToolUseIDs
                }
                isMessageSelectorVisible={isMessageSelectorVisible}
                conversationId={conversationId}
                screen={screen}
                streamingToolUses={streamingToolUses}
                showAllInTranscript={showAllInTranscript}
                agentDefinitions={agentDefinitions}
                isLoading={isLoading}
                streamingText={isLoading && !viewedAgentTask ? visibleStreamingText : null}
                unseenDivider={viewedAgentTask ? undefined : unseenDivider}
                scrollRef={isFullscreenEnvEnabled() ? scrollRef : undefined}
                trackStickyPrompt={isFullscreenEnvEnabled() ? true : undefined}
                cursor={cursor}
                setCursor={setCursor}
                cursorNavRef={cursorNavRef}
              />
              {toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) && !toolJsxCentered && (
                <Box flexDirection="column" width="100%">
                  {toolJSX.jsx}
                </Box>
              )}
              {/* WebBrowserPanel removed — browser-lite, no panel */}
              <Box flexGrow={1} />
              {showSpinner && (
                <SpinnerWithVerb
                  mode={streamMode}
                  spinnerTip={spinnerTip}
                  responseLengthRef={responseLengthRef}
                  apiMetricsRef={apiMetricsRef}
                  compactProgressActiveRef={compactProgressActiveRef}
                  overrideMessage={spinnerMessage}
                  spinnerSuffix={stopHookSpinnerSuffix}
                  verbose={verbose}
                  loadingStartTimeRef={loadingStartTimeRef}
                  totalPausedMsRef={totalPausedMsRef}
                  pauseStartTimeRef={pauseStartTimeRef}
                  overrideColor={spinnerColor}
                  overrideShimmerColor={spinnerShimmerColor}
                  hasActiveTools={inProgressToolUseIDs.size > 0}
                  leaderIsIdle={!isLoading}
                />
              )}
            </>
          }
          bottom={
            <Box flexDirection="row" width="100%" alignItems="flex-end">
              <Box flexDirection="column" flexGrow={1}>
                {isFullscreenEnvEnabled() && <PromptInputQueuedCommands />}
                {/* Immediate local JSX commands render here, outside the
                  scrollable transcript. They stay mounted while the main
                  conversation streams behind them, so ScrollBox relayouts
                  cannot move the dialog. Non-immediate command content stays
                  in the transcript because the main loop is paused. */}
                {toolJSX?.isLocalJSXCommand && toolJSX.isImmediate && !toolJsxCentered && (
                  <Box flexDirection="column" width="100%">
                    {toolJSX.jsx}
                  </Box>
                )}
                {!showSpinner && !toolJSX?.isLocalJSXCommand && showExpandedTodos && tasksV2 && tasksV2.length > 0 && (
                  <Box width="100%" flexDirection="column">
                    <TaskListV2 tasks={tasksV2} isStandalone={true} />
                  </Box>
                )}
                {focusedInputDialog === 'sandbox-permission' && (
                  <SandboxPermissionRequest
                    key={sandboxPermissionRequestQueue[0]!.hostPattern.host}
                    hostPattern={sandboxPermissionRequestQueue[0]!.hostPattern}
                    onUserResponse={(response: { allow: boolean; persistToSettings: boolean }) => {
                      const { allow, persistToSettings } = response;
                      const currentRequest = sandboxPermissionRequestQueue[0];
                      if (!currentRequest) return;

                      const approvedHost = currentRequest.hostPattern.host;

                      if (persistToSettings) {
                        const update = {
                          type: 'addRules' as const,
                          rules: [
                            {
                              toolName: WEB_FETCH_TOOL_NAME,
                              ruleContent: `domain:${approvedHost}`,
                            },
                          ],
                          behavior: (allow ? 'allow' : 'deny') as 'allow' | 'deny',
                          destination: 'localSettings' as const,
                        };

                        setAppState(prev => ({
                          ...prev,
                          toolSafetyContext: applySafetyRuleUpdate(prev.toolSafetyContext, update),
                        }));

                        persistSafetyRuleUpdate(update);

                        // Immediately update sandbox in-memory config to prevent race conditions
                        // where pending requests slip through before settings change is detected
                        SandboxManager.refreshConfig();
                      }

                      // Resolve ALL pending requests for the same host (not just the first one)
                      // This handles the case where multiple parallel requests came in for the same domain
                      setSandboxPermissionRequestQueue(queue => {
                        queue
                          .filter(item => item.hostPattern.host === approvedHost)
                          .forEach(item => item.resolvePromise(allow));
                        return queue.filter(item => item.hostPattern.host !== approvedHost);
                      });
                    }}
                  />
                )}
                {focusedInputDialog === 'user-question' && userQuestionQueue[0] && (
                  <UserQuestionDialog
                    key={userQuestionQueue[0].toolUseID}
                    request={userQuestionQueue[0]}
                    onDone={() => {
                      const requestId = userQuestionQueue[0]?.toolUseID;
                      if (!requestId) return;
                      setUserQuestionQueue(queue => queue.filter(item => item.toolUseID !== requestId));
                    }}
                    onReject={() => {}}
                  />
                )}
                {focusedInputDialog === 'prompt' && (
                  <PromptDialog
                    key={promptQueue[0]!.request.prompt}
                    title={promptQueue[0]!.title}
                    toolInputSummary={promptQueue[0]!.toolInputSummary}
                    request={promptQueue[0]!.request}
                    onRespond={selectedKey => {
                      const item = promptQueue[0];
                      if (!item) return;
                      item.resolve({
                        prompt_response: item.request.prompt,
                        selected: selectedKey,
                      });
                      setPromptQueue(([, ...tail]) => tail);
                    }}
                    onAbort={() => {
                      const item = promptQueue[0];
                      if (!item) return;
                      item.reject(new Error('Prompt cancelled by user'));
                      setPromptQueue(([, ...tail]) => tail);
                    }}
                  />
                )}
                {/* Show pending indicator for sandbox permission on worker side */}
                {pendingSandboxRequest && (
                  <WorkerPendingPermission
                    toolName="Network Access"
                    description={`Waiting for leader to approve network access to ${pendingSandboxRequest.host}`}
                  />
                )}
                {/* Worker sandbox permission requests from swarm workers */}
                {focusedInputDialog === 'worker-sandbox-permission' && (
                  <SandboxPermissionRequest
                    key={workerSandboxPermissions.queue[0]!.requestId}
                    hostPattern={
                      {
                        host: workerSandboxPermissions.queue[0]!.host,
                        port: undefined,
                      } as NetworkHostPattern
                    }
                    onUserResponse={(response: { allow: boolean; persistToSettings: boolean }) => {
                      const { allow, persistToSettings } = response;
                      const currentRequest = workerSandboxPermissions.queue[0];
                      if (!currentRequest) return;

                      const approvedHost = currentRequest.host;

                      // Send response via mailbox to the worker
                      void sendSandboxPermissionResponseViaMailbox(
                        currentRequest.workerName,
                        currentRequest.requestId,
                        approvedHost,
                        allow,
                        teamContext?.teamName,
                      );

                      if (persistToSettings && allow) {
                        const update = {
                          type: 'addRules' as const,
                          rules: [
                            {
                              toolName: WEB_FETCH_TOOL_NAME,
                              ruleContent: `domain:${approvedHost}`,
                            },
                          ],
                          behavior: 'allow' as const,
                          destination: 'localSettings' as const,
                        };

                        setAppState(prev => ({
                          ...prev,
                          toolSafetyContext: applySafetyRuleUpdate(prev.toolSafetyContext, update),
                        }));

                        persistSafetyRuleUpdate(update);
                        SandboxManager.refreshConfig();
                      }

                      // Remove from queue
                      setAppState(prev => ({
                        ...prev,
                        workerSandboxPermissions: {
                          ...prev.workerSandboxPermissions,
                          queue: prev.workerSandboxPermissions.queue.slice(1),
                        },
                      }));
                    }}
                  />
                )}
                {focusedInputDialog === 'elicitation' && (
                  <ElicitationDialog
                    key={elicitation.queue[0]!.serverName + ':' + String(elicitation.queue[0]!.requestId)}
                    event={elicitation.queue[0]!}
                    onResponse={(action, content) => {
                      const currentRequest = elicitation.queue[0];
                      if (!currentRequest) return;
                      // Call respond callback to resolve Promise
                      currentRequest.respond({ action, content });
                      // For URL accept, keep in queue for phase 2
                      const isUrlAccept = currentRequest.params.mode === 'url' && action === 'accept';
                      if (!isUrlAccept) {
                        setAppState(prev => ({
                          ...prev,
                          elicitation: {
                            queue: prev.elicitation.queue.slice(1),
                          },
                        }));
                      }
                    }}
                    onWaitingDismiss={action => {
                      const currentRequest = elicitation.queue[0];
                      // Remove from queue
                      setAppState(prev => ({
                        ...prev,
                        elicitation: {
                          queue: prev.elicitation.queue.slice(1),
                        },
                      }));
                      currentRequest?.onWaitingDismiss?.(action);
                    }}
                  />
                )}
                {focusedInputDialog === 'idle-return' && idleReturnPending && (
                  <IdleReturnDialog
                    idleMinutes={idleReturnPending.idleMinutes}
                    totalInputTokens={getTotalInputTokens()}
                    onDone={async action => {
                      const pending = idleReturnPending;
                      setIdleReturnPending(null);
                      logEvent('tengu_idle_return_action', {
                        action: action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        idleMinutes: Math.round(pending.idleMinutes),
                        messageCount: messagesRef.current.length,
                        totalInputTokens: getTotalInputTokens(),
                      });
                      if (action === 'dismiss') {
                        setInputValue(pending.input);
                        return;
                      }
                      if (action === 'never') {
                        saveGlobalConfig(current => {
                          if (current.idleReturnDismissed) return current;
                          return { ...current, idleReturnDismissed: true };
                        });
                      }
                      if (action === 'clear') {
                        const { clearConversation } = await import('../commands/clear/conversation.js');
                        await clearConversation({
                          setMessages,
                          readFileState: readFileState.current,
                          loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
                          getAppState: () => store.getState(),
                          setAppState,
                          setConversationId,
                        });
                        haikuTitleAttemptedRef.current = false;
                        setHaikuTitle(undefined);
                        bashTools.current.clear();
                        bashToolsProcessedIdx.current = 0;
                      }
                      skipIdleCheckRef.current = true;
                      void onSubmitRef.current(pending.input, {
                        setCursorOffset: () => {},
                        clearBuffer: () => {},
                        resetHistory: () => {},
                      });
                    }}
                  />
                )}
                {process.env.USER_TYPE === 'ant' && focusedInputDialog === 'model-switch' && AntModelSwitchCallout && (
                  <AntModelSwitchCallout
                    onDone={(selection: string, modelAlias?: string) => {
                      setShowModelSwitchCallout(false);
                      if (selection === 'switch' && modelAlias) {
                        setAppState(prev => ({
                          ...prev,
                          mainLoopModel: modelAlias,
                          mainLoopModelForSession: null,
                        }));
                      }
                    }}
                  />
                )}
                {process.env.USER_TYPE === 'ant' &&
                  focusedInputDialog === 'undercover-callout' &&
                  UndercoverAutoCallout && <UndercoverAutoCallout onDone={() => setShowUndercoverCallout(false)} />}
                {exitFlow}

                {mrRender()}

                {!toolJSX?.shouldHidePromptInput && !focusedInputDialog && !isExiting && !disabled && !cursor && (
                  <>
                    {showIssueFlagBanner && <IssueFlagBanner />}
                    {}
                    <PromptInput
                      debug={debug}
                      ideSelection={ideSelection}
                      hasSuppressedDialogs={!!hasSuppressedDialogs}
                      isLocalJSXCommandActive={isShowingLocalJSXCommand}
                      getToolUseContext={getToolUseContext}
                      toolSafetyContext={toolSafetyContext}
                      setToolSafetyContext={setToolSafetyContext}
                      apiKeyStatus={apiKeyStatus}
                      commands={commands}
                      agents={agentDefinitions.activeAgents}
                      isLoading={isLoading}
                      onExit={handleExit}
                      verbose={verbose}
                      messages={messages}
                      input={inputValue}
                      onInputChange={setInputValue}
                      mode={inputMode}
                      onModeChange={setInputMode}
                      stashedPrompt={stashedPrompt}
                      setStashedPrompt={setStashedPrompt}
                      submitCount={submitCount}
                      onShowMessageSelector={handleShowMessageSelector}
                      onMessageActionsEnter={
                        // Works during isLoading — edit cancels first; uuid selection survives appends.
                        feature('MESSAGE_ACTIONS') && isFullscreenEnvEnabled() && !disableMessageActions
                          ? enterMessageActions
                          : undefined
                      }
                      mcpClients={mcpClients}
                      pastedContents={pastedContents}
                      setPastedContents={setPastedContents}
                      vimMode={vimMode}
                      setVimMode={setVimMode}
                      showBashesDialog={showBashesDialog}
                      setShowBashesDialog={setShowBashesDialog}
                      onSubmit={onSubmit}
                      onAgentSubmit={onAgentSubmit}
                      isSearchingHistory={isSearchingHistory}
                      setIsSearchingHistory={setIsSearchingHistory}
                      helpOpen={isHelpOpen}
                      setHelpOpen={setIsHelpOpen}
                      insertTextRef={undefined}
                      voiceInterimRange={null}
                    />
                    <TaskBackgroundHandler />
                    <BackgroundAgentSelector />
                  </>
                )}
                {cursor && (
                  // inputValue is REPL state; typed text survives the round-trip.
                  <MessageActionsBar cursor={cursor} />
                )}
                {focusedInputDialog === 'message-selector' && (
                  <MessageSelector
                    messages={messages}
                    preselectedMessage={messageSelectorPreselect}
                    onPreRestore={onCancel}
                    onRestoreCode={async (message: UserMessage) => {
                      await fileHistoryRewind((updater: (prev: FileHistoryState) => FileHistoryState) => {
                        setAppState(prev => ({
                          ...prev,
                          fileHistory: updater(prev.fileHistory),
                        }));
                      }, message.uuid);
                    }}
                    onSummarize={async (
                      message: UserMessage,
                      feedback?: string,
                      direction: PartialCompactDirection = 'from',
                    ) => {
                      // Project snipped messages so the compact model
                      // doesn't summarize content that was intentionally removed.
                      const compactMessages = getMessagesAfterCompactBoundary(messages);

                      const messageIndex = compactMessages.indexOf(message);
                      if (messageIndex === -1) {
                        // Selected a snipped or pre-compact message that the
                        // selector still shows (REPL keeps full history for
                        // scrollback). Surface why nothing happened instead
                        // of silently no-oping.
                        setMessages(prev => [
                          ...prev,
                          createSystemMessage(
                            'That message is no longer in the active context (snipped or pre-compact). Choose a more recent message.',
                            'warning',
                          ),
                        ]);
                        return;
                      }

                      const newAbortController = createAbortController();
                      const context = getToolUseContext(compactMessages, [], newAbortController, mainLoopModel);

                      const appState = context.getAppState();
                      const defaultSysPrompt = await getSystemPrompt(
                        context.options.tools,
                        context.options.mainLoopModel,
                        Array.from(appState.toolSafetyContext.additionalWorkingDirectories.keys()),
                        context.options.mcpClients,
                      );
                      const systemPrompt = buildEffectiveSystemPrompt({
                        mainThreadAgentDefinition: undefined,
                        toolUseContext: context,
                        customSystemPrompt: context.options.customSystemPrompt,
                        defaultSystemPrompt: defaultSysPrompt,
                        appendSystemPrompt: context.options.appendSystemPrompt,
                      });
                      const [userContext, systemContext] = await Promise.all([getUserContext(), getSystemContext()]);

                      const result = await partialCompactConversation(
                        compactMessages,
                        messageIndex,
                        context,
                        {
                          systemPrompt,
                          userContext,
                          systemContext,
                          toolUseContext: context,
                          forkContextMessages: compactMessages,
                        },
                        feedback,
                        direction,
                      );

                      const kept = result.messagesToKeep ?? [];
                      const ordered =
                        direction === 'up_to'
                          ? [...result.summaryMessages, ...kept]
                          : [...kept, ...result.summaryMessages];
                      const postCompact = [
                        result.boundaryMarker,
                        ...ordered,
                        ...result.attachments,
                        ...result.hookResults,
                      ];
                      // Fullscreen 'from' keeps scrollback; 'up_to' must not
                      // (old[0] unchanged + grown array means incremental
                      // useLogMessages path, so boundary never persisted).
                      // Find by uuid since old is raw REPL history and snipped
                      // entries can shift the projected messageIndex.
                      if (isFullscreenEnvEnabled() && direction === 'from') {
                        setMessages(old => {
                          const rawIdx = old.findIndex(m => m.uuid === message.uuid);
                          return [...old.slice(0, rawIdx === -1 ? 0 : rawIdx), ...postCompact];
                        });
                      } else {
                        setMessages(postCompact);
                      }
                      setConversationId(randomUUID());
                      runPostCompactCleanup(context.options.querySource);

                      if (direction === 'from') {
                        const r = textForResubmit(message);
                        if (r) {
                          setInputValue(r.text);
                          setInputMode(r.mode);
                        }
                      }

                      // Show notification with ctrl+o hint
                      const historyShortcut = getShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
                      addNotification({
                        key: 'summarize-ctrl-o-hint',
                        text: `Conversation summarized (${historyShortcut} for history)`,
                        priority: 'medium',
                        timeoutMs: 8000,
                      });
                    }}
                    onRestoreMessage={handleRestoreMessage}
                    onClose={() => {
                      setIsMessageSelectorVisible(false);
                      setMessageSelectorPreselect(undefined);
                    }}
                  />
                )}
                {process.env.USER_TYPE === 'ant' && <DevBar />}
              </Box>
            </Box>
          }
        />
      </MCPConnectionManager>
    </KeybindingSetup>
  );
  if (isFullscreenEnvEnabled()) {
    return <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>{mainReturn}</AlternateScreen>;
  }
  return mainReturn;
}
