// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { useMemo } from 'react';
import type { VimMode, PromptInputMode } from '../../types/textInputTypes.js';
import type { ToolSafetyContext } from '../../Tool.js';
import { isVimModeEnabled } from './utils.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { BackgroundTaskStatus } from '../tasks/BackgroundTaskStatus.js';
import { isBackgroundTask } from '../../tasks/types.js';
import { isPanelAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { getVisibleAgentTasks } from '../AgentTaskStatus.js';
import { count } from '../../utils/array.js';
import { shouldHideTasksFooter } from '../tasks/taskStatusUtils.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { AgentRosterStatus } from '../teams/TeamStatus.js';
import { isInProcessEnabled } from '../../utils/swarm/backends/registry.js';
import { useAppState } from 'src/state/AppState.js';
import HistorySearchInput from './HistorySearchInput.js';
import { usePrStatus } from '../../hooks/usePrStatus.js';
import { Byline, KeyboardShortcutHint } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useTasksV2 } from '../../hooks/useTasksV2.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { isXtermJs, useHasSelection, useSelection } from '@anthropic/ink';
import { getGlobalConfig } from '../../utils/config.js';
import { getPlatform } from '../../utils/platform.js';
import { PrBadge } from '../PrBadge.js';

type Props = {
  exitMessage: {
    show: boolean;
    key?: string;
  };
  vimMode: VimMode | undefined;
  mode: PromptInputMode;
  toolSafetyContext: ToolSafetyContext;
  suppressHint: boolean;
  isLoading: boolean;
  showMemoryTypeSelector?: boolean;
  tasksSelected: boolean;
  agentsSelected: boolean;
  tmuxSelected: boolean;
  teammateFooterIndex?: number;
  isPasting?: boolean;
  isSearching: boolean;
  historyQuery: string;
  setHistoryQuery: (query: string) => void;
  historyFailedMatch: boolean;
  onOpenTasksDialog?: (taskId?: string) => void;
};

/** Compact "goal (1h22min)" pill for the footer — colored by status. */
export function PromptInputFooterLeftSide({
  exitMessage,
  vimMode,
  mode,
  toolSafetyContext,
  suppressHint,
  isLoading,
  tasksSelected,
  agentsSelected,
  tmuxSelected,
  teammateFooterIndex,
  isPasting,
  isSearching,
  historyQuery,
  setHistoryQuery,
  historyFailedMatch,
  onOpenTasksDialog,
}: Props): React.ReactNode {
  if (exitMessage.show) {
    return (
      <Text dimColor key="exit-message">
        Press {exitMessage.key} again to exit
      </Text>
    );
  }
  if (isPasting) {
    return (
      <Text dimColor key="pasting-message">
        Pasting text…
      </Text>
    );
  }

  const showVim = isVimModeEnabled() && vimMode === 'INSERT' && !isSearching;

  return (
    <Box justifyContent="flex-start" gap={1}>
      {isSearching && (
        <HistorySearchInput value={historyQuery} onChange={setHistoryQuery} historyFailedMatch={historyFailedMatch} />
      )}
      {showVim ? (
        <Text dimColor key="vim-insert">
          -- INSERT --
        </Text>
      ) : null}
      <ModeIndicator
        mode={mode}
        toolSafetyContext={toolSafetyContext}
        showHint={!suppressHint && !showVim}
        isLoading={isLoading}
        tasksSelected={tasksSelected}
        agentsSelected={agentsSelected}
        teammateFooterIndex={teammateFooterIndex}
        tmuxSelected={tmuxSelected}
        onOpenTasksDialog={onOpenTasksDialog}
      />
    </Box>
  );
}

type ModeIndicatorProps = {
  mode: PromptInputMode;
  toolSafetyContext: ToolSafetyContext;
  showHint: boolean;
  isLoading: boolean;
  tasksSelected: boolean;
  agentsSelected: boolean;
  tmuxSelected: boolean;
  teammateFooterIndex?: number;
  onOpenTasksDialog?: (taskId?: string) => void;
};

function ModeIndicator({
  mode,
  toolSafetyContext,
  showHint,
  isLoading,
  tasksSelected,
  agentsSelected,
  tmuxSelected,
  teammateFooterIndex,
  onOpenTasksDialog,
}: ModeIndicatorProps): React.ReactNode {
  const { columns } = useTerminalSize();
  const tasks = useAppState(s => s.tasks);
  const teamContext = useAppState(s => s.teamContext);
  const viewSelectionMode = useAppState(s => s.viewSelectionMode);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const expandedView = useAppState(s => s.expandedView);
  const showSpinnerTree = expandedView === 'teammates';
  const prStatus = usePrStatus(isLoading, isPrStatusEnabled());
  const hasTmuxSession = useAppState(s => process.env.USER_TYPE === 'ant' && s.tungstenActiveSession !== undefined);

  const hasSelection = useHasSelection();
  const selGetState = useSelection().getState;
  const runningTaskCount = useMemo(
    () =>
      count(
        Object.values(tasks),
        t => isBackgroundTask(t) && !(process.env.USER_TYPE === 'ant' && isPanelAgentTask(t)),
      ),
    [tasks],
  );
  const tasksV2 = useTasksV2();
  const hasTaskItems = tasksV2 !== undefined && tasksV2.length > 0;
  const escShortcut = useShortcutDisplay('chat:cancel', 'Chat', 'esc').toLowerCase();
  const todosShortcut = useShortcutDisplay('app:toggleTodos', 'Global', 'ctrl+t');
  const killAgentsShortcut = useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k');
  const isKillAgentsConfirmShowing = useAppState(s => s.notifications.current?.key === 'kill-agents-confirm');

  // Derive team info from teamContext (no filesystem I/O needed)
  // Match the same logic as TeamStatus to avoid trailing separator
  // In-process mode uses Shift+Down/Up navigation, not footer teams menu
  const hasTeams =
    isAgentSwarmsEnabled() &&
    !isInProcessEnabled() &&
    teamContext !== undefined &&
    count(Object.values(teamContext.teammates), t => t.name !== 'team-lead') > 0;

  if (mode === 'bash') {
    return <Text color="bashBorder">! for bash mode</Text>;
  }

  const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const isViewingTeammate = viewSelectionMode === 'viewing-agent' && viewedTask?.type === 'in_process_teammate';
  const isViewingCompletedTeammate = isViewingTeammate && viewedTask != null && viewedTask.status !== 'running';
  const hasBackgroundTasks = runningTaskCount > 0 || isViewingTeammate;

  // Count primary items (permission mode, background tasks, and teams)
  const primaryItemCount = (hasBackgroundTasks ? 1 : 0) + (hasTeams ? 1 : 0);

  // PR indicator is short (~10 chars) — unlike the old diff indicator the
  // >=100 threshold was tuned for. Now that auto mode is effectively the
  // baseline, primaryItemCount is ≥1 for most sessions; keep the threshold
  // low enough to show PR status on standard 80-col terminals.
  const shouldShowPrStatus =
    isPrStatusEnabled() &&
    prStatus.number !== null &&
    prStatus.reviewState !== null &&
    prStatus.url !== null &&
    primaryItemCount < 2 &&
    (primaryItemCount === 0 || columns >= 80);

  // Check if we have in-process teammates (showing pills)
  // In spinner-tree mode, pills are disabled - teammates appear in the spinner tree instead
  const hasInProcessTeammates =
    !showSpinnerTree && hasBackgroundTasks && Object.values(tasks).some(t => t.type === 'in_process_teammate');
  const hasTeammatePills = hasInProcessTeammates || (!showSpinnerTree && isViewingTeammate);

  const modePart = null;

  // Build parts array - exclude BackgroundTaskStatus when we have teammate pills
  // (teammate pills get their own row)
  const parts = [
    // BackgroundTaskStatus is NOT in parts — it renders as a Box sibling so
    // its click-target Box isn't nested inside the <Text wrap="truncate">
    // wrapper (reconciler throws on Box-in-Text).
    // Tmux pill (ant-only) — appears right after tasks in nav order
    ...(process.env.USER_TYPE === 'ant' && hasTmuxSession ? [<TungstenPill key="tmux" selected={tmuxSelected} />] : []),
    ...(isAgentSwarmsEnabled() && hasTeams && !hasBackgroundTasks
      ? [<AgentRosterStatus key="agents" agentsSelected={agentsSelected} showHint={showHint && !hasBackgroundTasks} />]
      : []),
    ...(shouldShowPrStatus
      ? [<PrBadge key="pr-status" number={prStatus.number!} url={prStatus.url!} reviewState={prStatus.reviewState!} />]
      : []),
  ];

  // Check if any in-process teammates exist (for hint text cycling)
  const hasAnyInProcessTeammates = Object.values(tasks).some(
    t => t.type === 'in_process_teammate' && t.status === 'running',
  );
  const hasRunningAgentTasks = Object.values(tasks).some(t => t.type === 'local_agent' && t.status === 'running');

  // Get hint parts separately for potential second-line rendering
  const hintParts = showHint
    ? getSpinnerHintParts(
        todosShortcut,
        killAgentsShortcut,
        hasTaskItems,
        expandedView,
        hasAnyInProcessTeammates,
        hasRunningAgentTasks,
        isKillAgentsConfirmShowing,
      )
    : [];

  if (isViewingCompletedTeammate) {
    parts.push(
      <Text dimColor key="esc-return">
        <KeyboardShortcutHint shortcut={escShortcut} action="return to team lead" />
      </Text>,
    );
  } else if (!hasTeammatePills && showHint) {
    parts.push(...hintParts);
  }

  // When we have teammate pills, always render them on their own line above other parts
  if (hasTeammatePills) {
    // The return-to-leader hint already occupies this slot.
    const otherParts = [...(modePart ? [modePart] : []), ...parts, ...(isViewingCompletedTeammate ? [] : hintParts)];
    return (
      <Box flexDirection="column">
        <Box>
          <BackgroundTaskStatus
            tasksSelected={tasksSelected}
            isViewingTeammate={isViewingTeammate}
            teammateFooterIndex={teammateFooterIndex}
            isLeaderIdle={!isLoading}
            onOpenDialog={onOpenTasksDialog}
          />
        </Box>
        {otherParts.length > 0 && (
          <Box>
            <Byline>{otherParts}</Byline>
          </Box>
        )}
      </Box>
    );
  }

  // Add "↓ to manage tasks" hint when panel has visible rows
  const hasAgentTasks = process.env.USER_TYPE === 'ant' && getVisibleAgentTasks(tasks).length > 0;

  // Tasks pill renders as a Box sibling (not a parts entry) so its
  // click-target Box isn't nested inside <Text wrap="truncate"> — the
  // reconciler throws on Box-in-Text. Computed here so the empty-checks
  // below still treat "pill present" as non-empty.
  const tasksPart =
    hasBackgroundTasks && !hasTeammatePills && !shouldHideTasksFooter(tasks, showSpinnerTree) ? (
      <BackgroundTaskStatus
        tasksSelected={tasksSelected}
        isViewingTeammate={isViewingTeammate}
        teammateFooterIndex={teammateFooterIndex}
        isLeaderIdle={!isLoading}
        onOpenDialog={onOpenTasksDialog}
      />
    ) : null;

  // Only replace the idle voice hint when there's something to say — otherwise
  // Keep only copy and native-selection guidance in this state.
  const copyOnSelect = getGlobalConfig().copyOnSelect ?? true;
  const selectionHintHasContent = hasSelection && (!copyOnSelect || isXtermJs());

  if (isFullscreenEnvEnabled() && selectionHintHasContent) {
    // xterm.js (VS Code/Cursor/Windsurf) force-selection modifier is
    // platform-specific and gated on macOS (SelectionService.shouldForceSelection):
    //   macOS:     altKey && macOptionClickForcesSelection (VS Code default: false)
    //   non-macOS: shiftKey
    // On macOS, if we RECEIVED an alt+click (lastPressHadAlt), the VS Code
    // setting is off — xterm.js would have consumed the event otherwise.
    // Tell the user the exact setting to flip instead of repeating the
    // option+click hint they just tried.
    // Non-reactive getState() read is safe: lastPressHadAlt is immutable
    // while hasSelection is true (set pre-drag, cleared with selection).
    const isMac = getPlatform() === 'macos';
    const altClickFailed = isMac && (selGetState()?.lastPressHadAlt ?? false);
    parts.push(
      <Text dimColor key="selection-copy">
        <Byline>
          {!copyOnSelect && <KeyboardShortcutHint shortcut="ctrl+c" action="copy" />}
          {isXtermJs() &&
            (altClickFailed ? (
              <Text>set macOptionClickForcesSelection in VS Code settings</Text>
            ) : (
              <KeyboardShortcutHint shortcut={isMac ? 'option+click' : 'shift+click'} action="native select" />
            ))}
        </Byline>
      </Text>,
    );
  }

  if ((tasksPart || hasAgentTasks) && showHint && !hasTeams) {
    parts.push(
      <Text dimColor key="manage-tasks">
        {tasksSelected ? (
          <KeyboardShortcutHint shortcut="Enter" action="view tasks" />
        ) : (
          <KeyboardShortcutHint shortcut="↓" action="manage" />
        )}
      </Text>,
    );
  }

  // In fullscreen the bottom section is flexShrink:0 — every row here
  // is a row stolen from the ScrollBox. This component must have a STABLE
  // height so the footer never grows/shrinks and shifts scroll content.
  // Returning null when parts is empty would let a later-added part grow the
  // column from zero to one row. Always reserve one row in fullscreen without
  // painting anything visible.
  if (parts.length === 0 && !tasksPart && !modePart) {
    return isFullscreenEnvEnabled() ? <Text> </Text> : null;
  }

  // flexShrink=0 keeps mode + pill at natural width; the remaining parts
  // truncate at the tail as one string inside the Text wrapper.
  return (
    <Box height={1} overflow="hidden">
      {modePart && (
        <Box flexShrink={0}>
          {modePart}
          {(tasksPart || parts.length > 0) && <Text dimColor> · </Text>}
        </Box>
      )}
      {tasksPart && (
        <Box flexShrink={0}>
          {tasksPart}
          {parts.length > 0 && <Text dimColor> · </Text>}
        </Box>
      )}
      {parts.length > 0 && (
        <Text wrap="truncate">
          <Byline>{parts}</Byline>
        </Text>
      )}
    </Box>
  );
}

function getSpinnerHintParts(
  todosShortcut: string,
  killAgentsShortcut: string,
  hasTaskItems: boolean,
  expandedView: 'none' | 'tasks' | 'teammates',
  hasTeammates: boolean,
  hasRunningAgentTasks: boolean,
  isKillAgentsConfirmShowing: boolean,
): React.ReactElement[] {
  let toggleAction: string;
  if (hasTeammates) {
    // Cycling: none → tasks → teammates → none
    switch (expandedView) {
      case 'none':
        toggleAction = 'show tasks';
        break;
      case 'tasks':
        toggleAction = 'show teammates';
        break;
      case 'teammates':
        toggleAction = 'hide';
        break;
    }
  } else {
    toggleAction = expandedView === 'tasks' ? 'hide tasks' : 'show tasks';
  }

  // Show the toggle hint only when there are task items to display or
  // teammates to cycle to
  const showToggleHint = hasTaskItems || hasTeammates;

  return [
    ...(hasRunningAgentTasks && !isKillAgentsConfirmShowing
      ? [
          <Text dimColor key="kill-agents">
            <KeyboardShortcutHint shortcut={killAgentsShortcut} action="stop agents" />
          </Text>,
        ]
      : []),
    ...(showToggleHint
      ? [
          <Text dimColor key="toggle-tasks">
            <KeyboardShortcutHint shortcut={todosShortcut} action={toggleAction} />
          </Text>,
        ]
      : []),
  ];
}

function isPrStatusEnabled(): boolean {
  return getGlobalConfig().prStatusFooterEnabled ?? true;
}
