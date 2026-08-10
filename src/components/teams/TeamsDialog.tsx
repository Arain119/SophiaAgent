import { randomUUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { useRegisterOverlay } from '../../context/overlayContext.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw j/k/arrow dialog navigation
import { Box, Text, useInput, stringWidth } from '@anthropic/ink';
import { type AppState, useSetAppState } from '../../state/AppState.js';
import { AGENT_COLOR_TO_THEME_COLOR } from '@sophia-agent/builtin-tools/tools/AgentTool/agentColorManager.js';
import { logForDebugging } from '../../utils/debug.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { truncateToWidth } from '../../utils/format.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { IT2_COMMAND, isInsideTmuxSync } from '../../utils/swarm/backends/detection.js';
import { ensureBackendsRegistered, getBackendByType, getCachedBackend } from '../../utils/swarm/backends/registry.js';
import { isPaneBackend, type PaneBackendType } from '../../utils/swarm/backends/types.js';
import { getSwarmSocketName, TMUX_COMMAND } from '../../utils/swarm/constants.js';
import { removeMemberFromTeam } from '../../utils/swarm/teamHelpers.js';
import { listTasks, type Task, unassignTeammateTasks } from '../../utils/tasks.js';
import { getTeammateStatuses, type TeammateStatus, type TeamSummary } from '../../utils/teamDiscovery.js';
import { sendShutdownRequestToMailbox } from '../../utils/teammateMailbox.js';
import { Dialog } from '@anthropic/ink';
import ThemedText from '../design-system/ThemedText.js';

type Props = {
  initialTeams?: TeamSummary[];
  onDone: () => void;
};

type DialogLevel =
  | { type: 'teammateList'; teamName: string }
  | { type: 'teammateDetail'; teamName: string; memberName: string };

/**
 * Dialog for viewing persistent agents in the current collaboration context.
 * The storage layer still calls this context a team for coordination purposes.
 */
export function AgentsDialog({ initialTeams, onDone }: Props): React.ReactNode {
  // Register as overlay so CancelRequestHandler doesn't intercept escape
  useRegisterOverlay('agents-dialog');

  // initialTeams is derived from teamContext in PromptInput (no filesystem I/O)
  const setAppState = useSetAppState();

  // Initialize dialogLevel with first team name if available
  const firstTeamName = initialTeams?.[0]?.name ?? '';
  const [dialogLevel, setDialogLevel] = useState<DialogLevel>({
    type: 'teammateList',
    teamName: firstTeamName,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // initialTeams is now always provided from PromptInput (derived from teamContext)
  // No filesystem I/O needed here

  const teammateStatuses = useMemo(() => {
    return getTeammateStatuses(dialogLevel.teamName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogLevel.teamName, refreshKey]);

  // Periodically refresh to pick up mode changes from teammates
  useInterval(() => {
    setRefreshKey(k => k + 1);
  }, 1000);

  const currentTeammate = useMemo(() => {
    if (dialogLevel.type !== 'teammateDetail') return null;
    return teammateStatuses.find(t => t.name === dialogLevel.memberName) ?? null;
  }, [dialogLevel, teammateStatuses]);

  const goBackToList = (): void => {
    setDialogLevel({ type: 'teammateList', teamName: dialogLevel.teamName });
    setSelectedIndex(0);
  };

  useInput((input, key) => {
    // Handle left arrow to go back
    if (key.leftArrow) {
      if (dialogLevel.type === 'teammateDetail') {
        goBackToList();
      }
      return;
    }

    // Handle up/down navigation
    if (key.upArrow || key.downArrow) {
      const maxIndex = getMaxIndex();
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else {
        setSelectedIndex(prev => Math.min(maxIndex, prev + 1));
      }
      return;
    }

    // Handle Enter to drill down or view output
    if (key.return) {
      if (dialogLevel.type === 'teammateList' && teammateStatuses[selectedIndex]) {
        setDialogLevel({
          type: 'teammateDetail',
          teamName: dialogLevel.teamName,
          memberName: teammateStatuses[selectedIndex].name,
        });
      } else if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
        // View output - switch to tmux pane
        void viewTeammateOutput(
          currentTeammate.tmuxPaneId,
          currentTeammate.backendType && isPaneBackend(currentTeammate.backendType)
            ? currentTeammate.backendType
            : undefined,
        );
        onDone();
      }
      return;
    }

    // Handle 'k' to kill teammate
    if (input === 'k') {
      if (dialogLevel.type === 'teammateList' && teammateStatuses[selectedIndex]) {
        void killTeammate(
          teammateStatuses[selectedIndex].tmuxPaneId,
          teammateStatuses[selectedIndex].backendType && isPaneBackend(teammateStatuses[selectedIndex].backendType)
            ? teammateStatuses[selectedIndex].backendType
            : undefined,
          dialogLevel.teamName,
          teammateStatuses[selectedIndex].agentId,
          teammateStatuses[selectedIndex].name,
          setAppState,
        ).then(() => {
          setRefreshKey(k => k + 1);
          // Adjust selection if needed
          setSelectedIndex(prev => Math.max(0, Math.min(prev, teammateStatuses.length - 2)));
        });
      } else if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
        void killTeammate(
          currentTeammate.tmuxPaneId,
          currentTeammate.backendType && isPaneBackend(currentTeammate.backendType)
            ? currentTeammate.backendType
            : undefined,
          dialogLevel.teamName,
          currentTeammate.agentId,
          currentTeammate.name,
          setAppState,
        );
        goBackToList();
      }
      return;
    }

    // Handle 's' for shutdown of selected teammate
    if (input === 's') {
      if (dialogLevel.type === 'teammateList' && teammateStatuses[selectedIndex]) {
        const teammate = teammateStatuses[selectedIndex];
        void sendShutdownRequestToMailbox(
          teammate.name,
          dialogLevel.teamName,
          'Graceful shutdown requested by team lead',
        );
      } else if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
        void sendShutdownRequestToMailbox(
          currentTeammate.name,
          dialogLevel.teamName,
          'Graceful shutdown requested by team lead',
        );
        goBackToList();
      }
      return;
    }

    // Handle 'h' to hide/show individual teammate (only for backends that support it)
    if (input === 'h') {
      const backend = getCachedBackend();
      const teammate =
        dialogLevel.type === 'teammateList'
          ? teammateStatuses[selectedIndex]
          : dialogLevel.type === 'teammateDetail'
            ? currentTeammate
            : null;

      if (teammate && backend?.supportsHideShow) {
        void toggleTeammateVisibility(teammate, dialogLevel.teamName).then(() => {
          // Force refresh of teammate statuses
          setRefreshKey(k => k + 1);
        });
        if (dialogLevel.type === 'teammateDetail') {
          goBackToList();
        }
      }
      return;
    }

    // Handle 'H' to hide/show all teammates (only for backends that support it)
    if (input === 'H' && dialogLevel.type === 'teammateList') {
      const backend = getCachedBackend();
      if (backend?.supportsHideShow && teammateStatuses.length > 0) {
        // If any are visible, hide all. Otherwise, show all.
        const anyVisible = teammateStatuses.some(t => !t.isHidden);
        void Promise.all(
          teammateStatuses.map(t =>
            anyVisible ? hideTeammate(t, dialogLevel.teamName) : showTeammate(t, dialogLevel.teamName),
          ),
        ).then(() => {
          // Force refresh of teammate statuses
          setRefreshKey(k => k + 1);
        });
      }
      return;
    }

    // Handle 'p' to prune (kill) all idle teammates
    if (input === 'p' && dialogLevel.type === 'teammateList') {
      const idleTeammates = teammateStatuses.filter(t => t.status === 'idle');
      if (idleTeammates.length > 0) {
        void Promise.all(
          idleTeammates.map(t =>
            killTeammate(
              t.tmuxPaneId,
              t.backendType && isPaneBackend(t.backendType) ? t.backendType : undefined,
              dialogLevel.teamName,
              t.agentId,
              t.name,
              setAppState,
            ),
          ),
        ).then(() => {
          setRefreshKey(k => k + 1);
          setSelectedIndex(prev => Math.max(0, Math.min(prev, teammateStatuses.length - idleTeammates.length - 1)));
        });
      }
      return;
    }
  });

  function getMaxIndex(): number {
    if (dialogLevel.type === 'teammateList') {
      return Math.max(0, teammateStatuses.length - 1);
    }
    return 0;
  }

  // Render based on dialog level
  if (dialogLevel.type === 'teammateList') {
    return (
      <TeamDetailView
        teamName={dialogLevel.teamName}
        teammates={teammateStatuses}
        selectedIndex={selectedIndex}
        onCancel={onDone}
      />
    );
  }

  if (dialogLevel.type === 'teammateDetail' && currentTeammate) {
    return <TeammateDetailView teammate={currentTeammate} teamName={dialogLevel.teamName} onCancel={goBackToList} />;
  }

  return null;
}

type TeamDetailViewProps = {
  teamName: string;
  teammates: TeammateStatus[];
  selectedIndex: number;
  onCancel: () => void;
};

function TeamDetailView({ teamName, teammates, selectedIndex, onCancel }: TeamDetailViewProps): React.ReactNode {
  const subtitle = `${teammates.length} ${teammates.length === 1 ? 'agent' : 'agents'}`;
  // Check if the backend supports hide/show
  const supportsHideShow = getCachedBackend()?.supportsHideShow ?? false;
  // Get the display text for the cycle mode shortcut

  return (
    <>
      <Dialog title={`Agents · ${teamName}`} subtitle={subtitle} onCancel={onCancel} color="background" hideInputGuide>
        {teammates.length === 0 ? (
          <Text dimColor>No agents</Text>
        ) : (
          <Box flexDirection="column">
            {teammates.map((teammate, index) => (
              <TeammateListItem key={teammate.agentId} teammate={teammate} isSelected={index === selectedIndex} />
            ))}
          </Box>
        )}
      </Dialog>
      <Box marginLeft={1}>
        <Text dimColor>
          {figures.arrowUp}/{figures.arrowDown} select · Enter view · k kill · s shutdown · p prune idle
          {supportsHideShow && ' · h hide/show · H hide/show all'}
          {' · '}
          Esc close
        </Text>
      </Box>
    </>
  );
}

type TeammateListItemProps = {
  teammate: TeammateStatus;
  isSelected: boolean;
};

function TeammateListItem({ teammate, isSelected }: TeammateListItemProps): React.ReactNode {
  const isIdle = teammate.status === 'idle';
  // Only dim if idle AND not selected - selection highlighting takes precedence
  const shouldDim = isIdle && !isSelected;

  return (
    <Text color={isSelected ? 'suggestion' : undefined} dimColor={shouldDim}>
      {isSelected ? figures.pointer + ' ' : '  '}
      {teammate.isHidden && <Text dimColor>[hidden] </Text>}
      {isIdle && <Text dimColor>[idle] </Text>}@{teammate.name}
      {teammate.model && <Text dimColor> ({teammate.model})</Text>}
    </Text>
  );
}

type TeammateDetailViewProps = {
  teammate: TeammateStatus;
  teamName: string;
  onCancel: () => void;
};

function TeammateDetailView({ teammate, teamName, onCancel }: TeammateDetailViewProps): React.ReactNode {
  const [promptExpanded, setPromptExpanded] = useState(false);
  // Get the display text for the cycle mode shortcut
  const themeColor = teammate.color
    ? AGENT_COLOR_TO_THEME_COLOR[teammate.color as keyof typeof AGENT_COLOR_TO_THEME_COLOR]
    : undefined;

  // Get tasks assigned to this teammate
  const [teammateTasks, setTeammateTasks] = useState<Task[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listTasks(teamName).then(allTasks => {
      if (cancelled) return;
      // Filter tasks owned by this teammate (by agentId or name)
      setTeammateTasks(allTasks.filter(task => task.owner === teammate.agentId || task.owner === teammate.name));
    });
    return () => {
      cancelled = true;
    };
  }, [teamName, teammate.agentId, teammate.name]);

  useInput(input => {
    // Handle 'p' to expand/collapse prompt
    if (input === 'p') {
      setPromptExpanded(prev => !prev);
    }
  });

  // Determine working directory display
  const workingPath = teammate.worktreePath || teammate.cwd;

  // Build subtitle with metadata
  const subtitleParts: string[] = [];
  if (teammate.model) subtitleParts.push(teammate.model);
  if (workingPath) {
    subtitleParts.push(teammate.worktreePath ? `worktree: ${workingPath}` : workingPath);
  }
  const subtitle = subtitleParts.join(' · ') || undefined;

  // Build title with colored name if applicable
  const title = (
    <>{themeColor ? <ThemedText color={themeColor}>{`@${teammate.name}`}</ThemedText> : `@${teammate.name}`}</>
  );

  return (
    <>
      <Dialog title={title} subtitle={subtitle} onCancel={onCancel} color="background" hideInputGuide>
        {/* Tasks section */}
        {teammateTasks.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Tasks</Text>
            {teammateTasks.map(task => (
              <Text key={task.id} color={task.status === 'completed' ? 'success' : undefined}>
                {task.status === 'completed' ? figures.tick : '◼'} {task.subject}
              </Text>
            ))}
          </Box>
        )}

        {/* Prompt section */}
        {teammate.prompt && (
          <Box flexDirection="column">
            <Text bold>Prompt</Text>
            <Text>
              {promptExpanded ? teammate.prompt : truncateToWidth(teammate.prompt, 80)}
              {stringWidth(teammate.prompt) > 80 && !promptExpanded && <Text dimColor> (p to expand)</Text>}
            </Text>
          </Box>
        )}
      </Dialog>
      <Box marginLeft={1}>
        <Text dimColor>
          {figures.arrowLeft} back · Esc close · k kill · s shutdown
          {getCachedBackend()?.supportsHideShow && ' · h hide/show'}
          {' · '}
        </Text>
      </Box>
    </>
  );
}

async function killTeammate(
  paneId: string,
  backendType: PaneBackendType | undefined,
  teamName: string,
  teammateId: string,
  teammateName: string,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<void> {
  // Kill the pane using the backend that created it (handles -s / -L flags correctly).
  // Wrapped in try/catch so cleanup (removeMemberFromTeam, unassignTeammateTasks,
  // setAppState) always runs — matches useInboxPoller.ts error isolation.
  if (backendType) {
    try {
      // Use ensureBackendsRegistered (not detectAndGetBackend) — this process may
      // be a teammate that never ran detection, but we only need class imports
      // here, not subprocess probes that could throw in a different environment.
      await ensureBackendsRegistered();
      await getBackendByType(backendType).killPane(paneId, !isInsideTmuxSync());
    } catch (error) {
      logForDebugging(`[TeamsDialog] Failed to kill pane ${paneId}: ${error}`);
    }
  } else {
    // backendType undefined: old team files predating this field, or in-process.
    // Old tmux-file case is a migration gap — the pane is orphaned. In-process
    // teammates have no pane to kill, so this is correct for them.
    logForDebugging(`[TeamsDialog] Skipping pane kill for ${paneId}: no backendType recorded`);
  }
  // Remove from team config file
  removeMemberFromTeam(teamName, paneId);

  // Unassign tasks and build notification message
  const { notificationMessage } = await unassignTeammateTasks(teamName, teammateId, teammateName, 'terminated');

  // Update AppState to keep status line in sync and notify the lead
  setAppState(prev => {
    if (!prev.teamContext?.teammates) return prev;
    if (!(teammateId in prev.teamContext.teammates)) return prev;
    const { [teammateId]: _, ...remainingTeammates } = prev.teamContext.teammates;
    return {
      ...prev,
      teamContext: {
        ...prev.teamContext,
        teammates: remainingTeammates,
      },
      inbox: {
        messages: [
          ...prev.inbox.messages,
          {
            id: randomUUID(),
            from: 'system',
            text: jsonStringify({
              type: 'teammate_terminated',
              message: notificationMessage,
            }),
            timestamp: new Date().toISOString(),
            status: 'pending' as const,
          },
        ],
      },
    };
  });
  logForDebugging(`[TeamsDialog] Removed ${teammateId} from teamContext`);
}

async function viewTeammateOutput(paneId: string, backendType: PaneBackendType | undefined): Promise<void> {
  if (backendType === 'iterm2') {
    // -s is required to target a specific session (ITermBackend.ts:216-217)
    await execFileNoThrow(IT2_COMMAND, ['session', 'focus', '-s', paneId]);
  } else if (backendType === 'windows-terminal') {
    // Windows Terminal spawns each teammate as a separate window/tab; wt.exe
    // does not expose an API to focus a pre-existing tab by name. The user
    // switches tabs manually (Ctrl+Tab) — dialog closing is enough here.
    logForDebugging(`[TeamsDialog] viewTeammateOutput: Windows Terminal pane ${paneId} — manual tab switch required`);
  } else {
    // External-tmux teammates live on the swarm socket — without -L, this
    // targets the default server and silently no-ops. Mirrors runTmuxInSwarm
    // in TmuxBackend.ts:85-89.
    const args = isInsideTmuxSync()
      ? ['select-pane', '-t', paneId]
      : ['-L', getSwarmSocketName(), 'select-pane', '-t', paneId];
    await execFileNoThrow(TMUX_COMMAND, args);
  }
}

/**
 * Toggle visibility of a teammate pane (hide if visible, show if hidden)
 */
async function toggleTeammateVisibility(teammate: TeammateStatus, teamName: string): Promise<void> {
  if (teammate.isHidden) {
    await showTeammate(teammate, teamName);
  } else {
    await hideTeammate(teammate, teamName);
  }
}

/**
 * Hide a teammate pane using the backend abstraction.
 * Only available for ant users (gated for dead code elimination in external builds)
 */
async function hideTeammate(_teammate: TeammateStatus, _teamName: string): Promise<void> {}

/**
 * Show a previously hidden teammate pane using the backend abstraction.
 * Only available for ant users (gated for dead code elimination in external builds)
 */
async function showTeammate(_teammate: TeammateStatus, _teamName: string): Promise<void> {}
