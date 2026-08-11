import figures from 'figures';
import React, { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { enterTeammateView, exitTeammateView } from 'src/state/teammateViewHelpers.js';
import type { LocalJSXCommandContext } from 'src/types/command.js';
import { InProcessTeammateTask } from 'src/tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js';
import type { LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { LocalAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import { LocalShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
import { killWorkflowTask, type LocalWorkflowTaskState } from 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import { type BackgroundTaskState, isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { intersperse } from 'src/utils/array.js';
import { TEAM_LEAD_NAME } from 'src/utils/swarm/constants.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { type KeyboardEvent, Box, Text } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { count } from '../../utils/array.js';
import { Byline, Dialog, KeyboardShortcutHint } from '@anthropic/ink';
import { AsyncAgentDetailDialog } from './AsyncAgentDetailDialog.js';
import { BackgroundTask as BackgroundTaskComponent } from './BackgroundTask.js';
import { InProcessTeammateDetailDialog } from './InProcessTeammateDetailDialog.js';
import { ShellDetailDialog } from './ShellDetailDialog.js';
import { WorkflowsPanel } from '../../workflow/panel/WorkflowsPanel.js';
import { SentryErrorBoundary } from '../SentryErrorBoundary.js';

type ViewState = { mode: 'list' } | { mode: 'detail'; itemId: string };

type Props = {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  toolUseContext: LocalJSXCommandContext;
  initialDetailTaskId?: string;
};

type ListItem =
  | {
      id: string;
      type: 'local_bash';
      label: string;
      status: string;
      task: DeepImmutable<LocalShellTaskState>;
    }
  | {
      id: string;
      type: 'local_agent';
      label: string;
      status: string;
      task: DeepImmutable<LocalAgentTaskState>;
    }
  | {
      id: string;
      type: 'in_process_teammate';
      label: string;
      status: string;
      task: DeepImmutable<InProcessTeammateTaskState>;
    }
  | {
      id: string;
      type: 'local_workflow';
      label: string;
      status: string;
      task: DeepImmutable<LocalWorkflowTaskState>;
    }
  | {
      id: string;
      type: 'leader';
      label: string;
      status: 'running';
    };

function getSelectableBackgroundTasks(tasks: Record<string, TaskState> | undefined): TaskState[] {
  return Object.values(tasks ?? {}).filter(isBackgroundTask);
}

export function BackgroundTasksDialog({ onDone, toolUseContext, initialDetailTaskId }: Props): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const showSpinnerTree = useAppState(s => s.expandedView) === 'teammates';
  const setAppState = useSetAppState();
  const killAgentsShortcut = useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k');
  const typedTasks = tasks as Record<string, TaskState> | undefined;

  // Track if we skipped list view on mount (for back button behavior)
  const skippedListOnMount = useRef(false);

  // Compute initial view state - skip list if caller provided a specific task,
  // or if there's exactly one task
  const [viewState, setViewState] = useState<ViewState>(() => {
    if (initialDetailTaskId) {
      skippedListOnMount.current = true;
      return { mode: 'detail', itemId: initialDetailTaskId };
    }
    const allItems = getSelectableBackgroundTasks(typedTasks);
    if (allItems.length === 1) {
      skippedListOnMount.current = true;
      return { mode: 'detail', itemId: allItems[0]!.id };
    }
    return { mode: 'list' };
  });
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Register as modal overlay so parent Chat keybindings (up/down for history)
  // are deactivated while this dialog is open
  useRegisterOverlay('background-tasks-dialog');

  // Memoize the sorted and categorized items together to ensure stable references
  const { bashTasks, agentTasks, teammateTasks, workflowTasks, allSelectableItems } = useMemo(() => {
    // Filter to only show running/pending background tasks, matching the status bar count
    const backgroundTasks = Object.values(typedTasks ?? {}).filter(isBackgroundTask);
    const allItems = backgroundTasks.map(toListItem);
    const sorted = allItems.sort((a, b) => {
      const aStatus = a.status;
      const bStatus = b.status;
      if (aStatus === 'running' && bStatus !== 'running') return -1;
      if (aStatus !== 'running' && bStatus === 'running') return 1;
      const aTime = 'task' in a ? a.task.startTime : 0;
      const bTime = 'task' in b ? b.task.startTime : 0;
      return bTime - aTime;
    });
    const bash = sorted.filter(item => item.type === 'local_bash');
    const agent = sorted.filter(item => item.type === 'local_agent');
    const workflows = sorted.filter(item => item.type === 'local_workflow');
    // In spinner-tree mode, exclude teammates from the dialog (they appear in the tree)
    const teammates = showSpinnerTree ? [] : sorted.filter(item => item.type === 'in_process_teammate');
    // Add leader entry when there are teammates, so users can foreground back to leader
    const leaderItem: ListItem[] =
      teammates.length > 0
        ? [
            {
              id: '__leader__',
              type: 'leader',
              label: `@${TEAM_LEAD_NAME}`,
              status: 'running',
            },
          ]
        : [];
    return {
      bashTasks: bash,
      agentTasks: agent,
      workflowTasks: workflows,
      teammateTasks: [...leaderItem, ...teammates],
      // Order MUST match JSX render order (teammates \u2192 bash \u2192 monitorMcp \u2192
      // remote \u2192 agent \u2192 workflows) so \u2193/\u2191 navigation moves the cursor
      // visually downward.
      allSelectableItems: [...leaderItem, ...teammates, ...agent, ...bash, ...workflows],
    };
  }, [typedTasks, showSpinnerTree]);

  const currentSelection = allSelectableItems[selectedIndex] ?? null;

  // Use configurable keybindings for standard navigation and confirm/cancel.
  // confirm:no is handled by Dialog's onCancel prop.
  useKeybindings(
    {
      'confirm:previous': () => setSelectedIndex(prev => Math.max(0, prev - 1)),
      'confirm:next': () => setSelectedIndex(prev => Math.min(allSelectableItems.length - 1, prev + 1)),
      'confirm:yes': () => {
        const current = allSelectableItems[selectedIndex];
        if (current) {
          if (current.type === 'leader') {
            exitTeammateView(setAppState);
            onDone('Viewing leader', { display: 'system' });
          } else {
            setViewState({ mode: 'detail', itemId: current.id });
          }
        }
      },
    },
    { context: 'Confirmation', isActive: viewState.mode === 'list' },
  );

  // Component-specific shortcuts (x=stop, f=foreground, right=zoom) shown in UI.
  // These are task-type and status dependent, not standard dialog keybindings.
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only handle input when in list mode
    if (viewState.mode !== 'list') return;

    if (e.key === 'left') {
      e.preventDefault();
      onDone('Background tasks dialog dismissed', { display: 'system' });
      return;
    }

    // Compute current selection at the time of the key press
    const currentSelection = allSelectableItems[selectedIndex];
    if (!currentSelection) return; // everything below requires a selection

    if (e.key === 'x') {
      e.preventDefault();
      if (currentSelection.type === 'local_bash' && currentSelection.status === 'running') {
        void killShellTask(currentSelection.id);
      } else if (
        currentSelection.type === 'local_agent' &&
        (currentSelection.status === 'running' || currentSelection.status === 'pending')
      ) {
        void killAgentTask(currentSelection.id);
      } else if (currentSelection.type === 'in_process_teammate' && currentSelection.status === 'running') {
        void killTeammateTask(currentSelection.id);
      } else if (currentSelection.type === 'local_workflow' && currentSelection.status === 'running') {
        killWorkflowTask(currentSelection.id, setAppState);
      }
    }

    if (e.key === 'f') {
      if (currentSelection.type === 'in_process_teammate' && currentSelection.status === 'running') {
        e.preventDefault();
        enterTeammateView(currentSelection.id, setAppState);
        onDone('Viewing agent', { display: 'system' });
      } else if (currentSelection.type === 'leader') {
        e.preventDefault();
        exitTeammateView(setAppState);
        onDone('Viewing leader', { display: 'system' });
      }
    }
  };

  async function killShellTask(taskId: string): Promise<void> {
    await LocalShellTask.kill(taskId, setAppState);
  }

  async function killAgentTask(taskId: string): Promise<void> {
    await LocalAgentTask.kill(taskId, setAppState);
  }

  async function killTeammateTask(taskId: string): Promise<void> {
    await InProcessTeammateTask.kill(taskId, setAppState);
  }

  // Wrap onDone in useEffectEvent to get a stable reference that always calls
  // the current onDone callback without causing the effect to re-fire.
  const onDoneEvent = useEffectEvent(onDone);

  useEffect(() => {
    if (viewState.mode !== 'list') {
      const task = (typedTasks ?? {})[viewState.itemId];
      // Workflow tasks get a grace: their detail view stays open through
      // completion so the user sees the final state before eviction.
      if (!task || (task.type !== 'local_workflow' && !isBackgroundTask(task))) {
        // Task was removed or is no longer a background task (e.g. killed).
        // If we skipped the list on mount, close the dialog entirely.
        if (skippedListOnMount.current) {
          onDoneEvent('Background tasks dialog dismissed', {
            display: 'system',
          });
        } else {
          setViewState({ mode: 'list' });
        }
      }
    }

    const totalItems = allSelectableItems.length;
    if (selectedIndex >= totalItems && totalItems > 0) {
      setSelectedIndex(totalItems - 1);
    }
  }, [viewState, typedTasks, selectedIndex, allSelectableItems, onDoneEvent]);

  // Helper to go back to list view (or close dialog if we skipped list on
  // mount AND there's still only ≤1 item). Checking current count prevents
  // the stale-state trap: if you opened with 1 task (auto-skipped to detail),
  // then a second task started, 'back' should show the list — not close.
  const goBackToList = () => {
    if (skippedListOnMount.current && allSelectableItems.length <= 1) {
      onDone('Background tasks dialog dismissed', { display: 'system' });
    } else {
      skippedListOnMount.current = false;
      setViewState({ mode: 'list' });
    }
  };

  // If an item is selected, show the appropriate view
  if (viewState.mode !== 'list' && typedTasks) {
    const task = typedTasks[viewState.itemId];
    if (!task) {
      return null;
    }

    // Detail mode - show appropriate detail dialog
    switch (task.type) {
      case 'local_bash':
        return (
          <ShellDetailDialog
            shell={task}
            onDone={onDone}
            onKillShell={() => void killShellTask(task.id)}
            onBack={goBackToList}
            key={`shell-${task.id}`}
          />
        );
      case 'local_agent':
        return (
          <AsyncAgentDetailDialog
            agent={task}
            onDone={onDone}
            onKillAgent={() => void killAgentTask(task.id)}
            onBack={goBackToList}
            key={`agent-${task.id}`}
          />
        );
      case 'in_process_teammate':
        return (
          <InProcessTeammateDetailDialog
            teammate={task}
            onDone={onDone}
            onKill={task.status === 'running' ? () => void killTeammateTask(task.id) : undefined}
            onBack={goBackToList}
            onForeground={
              task.status === 'running'
                ? () => {
                    enterTeammateView(task.id, setAppState);
                    onDone('Viewing agent', { display: 'system' });
                  }
                : undefined
            }
            key={`teammate-${task.id}`}
          />
        );
      case 'local_workflow': {
        return (
          <SentryErrorBoundary name="WorkflowTaskDetail" key={`workflow-${task.id}`}>
            <WorkflowsPanel context={toolUseContext} initialRunId={task.runId} onDone={goBackToList} />
          </SentryErrorBoundary>
        );
      }
    }
  }

  const runningBashCount = count(bashTasks, _ => _.status === 'running');
  const runningAgentCount = count(agentTasks, _ => _.status === 'running');
  const runningTeammateCount = count(teammateTasks, _ => _.status === 'running');
  const totalAgentCount = count(teammateTasks, item => item.type !== 'leader') + agentTasks.length;
  const runningTotalAgentCount = runningTeammateCount + runningAgentCount;
  const subtitle = intersperse(
    [
      ...(runningTotalAgentCount > 0
        ? [
            <Text key="agents">
              {runningTotalAgentCount} {runningTotalAgentCount !== 1 ? 'active agents' : 'active agent'}
            </Text>,
          ]
        : []),
      ...(runningBashCount > 0
        ? [
            <Text key="shells">
              {runningBashCount} {runningBashCount !== 1 ? 'active shells' : 'active shell'}
            </Text>,
          ]
        : []),
    ],
    index => <Text key={`separator-${index}`}> · </Text>,
  );

  const actions = [
    <KeyboardShortcutHint key="upDown" shortcut="↑/↓" action="select" />,
    <KeyboardShortcutHint key="enter" shortcut="Enter" action="view" />,
    ...(currentSelection?.type === 'in_process_teammate' && currentSelection.status === 'running'
      ? [<KeyboardShortcutHint key="foreground" shortcut="f" action="foreground" />]
      : []),
    ...((currentSelection?.type === 'local_bash' ||
      currentSelection?.type === 'local_agent' ||
      currentSelection?.type === 'in_process_teammate' ||
      currentSelection?.type === 'local_workflow') &&
    (currentSelection.status === 'running' ||
      (currentSelection.type === 'local_agent' && currentSelection.status === 'pending'))
      ? [<KeyboardShortcutHint key="kill" shortcut="x" action="stop" />]
      : []),
    ...(agentTasks.some(t => t.status === 'running' || t.status === 'pending')
      ? [<KeyboardShortcutHint key="kill-all" shortcut={killAgentsShortcut} action="stop all agents" />]
      : []),
    <KeyboardShortcutHint key="esc" shortcut="←/Esc" action="close" />,
  ];

  const handleCancel = () => onDone('Background tasks dialog dismissed', { display: 'system' });

  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <Byline>{actions}</Byline>;
  }

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Activity"
        subtitle={<>{subtitle}</>}
        onCancel={handleCancel}
        color="background"
        inputGuide={renderInputGuide}
      >
        {allSelectableItems.length === 0 ? (
          <Text dimColor>No activity currently running</Text>
        ) : (
          <Box flexDirection="column">
            {totalAgentCount > 0 && (
              <Box flexDirection="column">
                <Text dimColor>
                  <Text bold>{'  '}Agents</Text> ({totalAgentCount})
                </Text>
                <Box flexDirection="column">
                  <TeammateTaskGroups teammateTasks={teammateTasks} currentSelectionId={currentSelection?.id} />
                  {agentTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {bashTasks.length > 0 && (
              <Box flexDirection="column" marginTop={totalAgentCount > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Shells</Text> ({bashTasks.length})
                </Text>
                <Box flexDirection="column">
                  {bashTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {workflowTasks.length > 0 && (
              <Box flexDirection="column" marginTop={totalAgentCount > 0 || bashTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Workflows</Text> ({workflowTasks.length})
                </Text>
                <Box flexDirection="column">
                  {workflowTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Dialog>
    </Box>
  );
}

function toListItem(task: BackgroundTaskState): ListItem {
  switch (task.type) {
    case 'local_bash':
      return {
        id: task.id,
        type: 'local_bash',
        label: task.command,
        status: task.memoryPaused ? 'memory paused' : task.status,
        task,
      };
    case 'local_agent':
      return {
        id: task.id,
        type: 'local_agent',
        label: task.description,
        status: task.status,
        task,
      };
    case 'in_process_teammate':
      return {
        id: task.id,
        type: 'in_process_teammate',
        label: `@${task.identity.agentName}`,
        status: task.status,
        task,
      };
    case 'local_workflow':
      return {
        id: task.id,
        type: 'local_workflow',
        label: task.summary ?? task.description,
        status: task.status,
        task,
      };
  }
}

function Item({ item, isSelected }: { item: ListItem; isSelected: boolean }): ReactNode {
  const { columns } = useTerminalSize();
  // Dialog border (2) + padding (2) + pointer prefix (2) + name/status overhead (~20)
  const maxActivityWidth = Math.max(30, columns - 26);
  return (
    <Box flexDirection="row">
      <Text>{isSelected ? figures.pointer + ' ' : '  '}</Text>
      <Text color={isSelected ? 'suggestion' : undefined}>
        {item.type === 'leader' ? (
          <Text>@{TEAM_LEAD_NAME}</Text>
        ) : (
          <BackgroundTaskComponent task={item.task} maxActivityWidth={maxActivityWidth} />
        )}
      </Text>
    </Box>
  );
}

function TeammateTaskGroups({
  teammateTasks,
  currentSelectionId,
}: {
  teammateTasks: ListItem[];
  currentSelectionId: string | undefined;
}): ReactNode {
  // Separate leader from teammates, group teammates by team
  const leaderItems = teammateTasks.filter(i => i.type === 'leader');
  const teammateItems = teammateTasks.filter(i => i.type === 'in_process_teammate');
  const teams = new Map<string, typeof teammateItems>();
  for (const item of teammateItems) {
    const teamName = item.task.identity.teamName;
    const group = teams.get(teamName);
    if (group) {
      group.push(item);
    } else {
      teams.set(teamName, [item]);
    }
  }
  const teamEntries = [...teams.entries()];
  return (
    <>
      {teamEntries.map(([teamName, items]) => {
        const memberCount = items.length + leaderItems.length;
        return (
          <Box key={teamName} flexDirection="column">
            <Text dimColor>
              {'  '}Team: {teamName} ({memberCount})
            </Text>
            {/* Render leader first within each team */}
            {leaderItems.map(item => (
              <Item key={`${item.id}-${teamName}`} item={item} isSelected={item.id === currentSelectionId} />
            ))}
            {items.map(item => (
              <Item key={item.id} item={item} isSelected={item.id === currentSelectionId} />
            ))}
          </Box>
        );
      })}
    </>
  );
}
