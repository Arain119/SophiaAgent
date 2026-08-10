// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { feature } from 'bun:bundle';
import sample from 'lodash-es/sample.js';
import { formatDuration, formatNumber } from '../utils/format.js';
import type { Theme } from 'src/utils/theme.js';
import type { SpinnerColor } from './Spinner/types.js';
import { activityManager } from '../utils/activityManager.js';
import { getSpinnerVerbs } from '../constants/spinnerVerbs.js';
import { MessageResponse } from './MessageResponse.js';
import { TaskListV2 } from './TaskListV2.js';
import { useTasksV2 } from '../hooks/useTasksV2.js';
import type { Task } from '../utils/tasks.js';
import { useAppState } from '../state/AppState.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { SpinnerMode } from './Spinner/index.js';
import { SpinnerAnimationRow } from './Spinner/SpinnerAnimationRow.js';
import { MODEL_SPINNER_FRAME_MS, ModelSpinnerGlyph, MODEL_SPINNER_WIDTH } from './Spinner/SpinnerGlyph.js';
import { useSettings } from '../hooks/useSettings.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import { isLocalAgentTask } from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { getAllInProcessTeammateTasks } from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import { getEffortSuffix } from '../utils/effort.js';
import { getMainLoopModel } from '../utils/model/model.js';
import { getViewedTeammateTask } from '../state/selectors.js';
import { SOPHIA_MARK } from '../constants/figures.js';
import figures from 'figures';
import { getCurrentTurnTokenBudget, getTurnOutputTokens } from '../bootstrap/state.js';

import { TeammateSpinnerTree } from './Spinner/TeammateSpinnerTree.js';
import { useAnimationFrame } from '@anthropic/ink';
export type { SpinnerMode } from './Spinner/index.js';

type Props = {
  mode: SpinnerMode;
  loadingStartTimeRef: React.RefObject<number>;
  totalPausedMsRef: React.RefObject<number>;
  pauseStartTimeRef: React.RefObject<number | null>;
  spinnerTip?: string;
  responseLengthRef: React.RefObject<number>;
  apiMetricsRef?: React.RefObject<
    Array<{
      ttftMs: number;
      firstTokenTime: number;
      lastTokenTime: number;
      responseLengthBaseline: number;
      endResponseLength: number;
    }>
  >;
  overrideColor?: keyof Theme | null;
  overrideShimmerColor?: keyof Theme | null;
  overrideMessage?: string | null;
  spinnerSuffix?: string | null;
  verbose: boolean;
  /** True while a compaction summary is streaming — shows a token progress bar. */
  compactProgressActiveRef?: React.RefObject<boolean>;
  hasActiveTools?: boolean;
  /** Leader's turn has completed (no active query). Used to suppress stall-red spinner when only teammates are running. */
  leaderIsIdle?: boolean;
};

export function SpinnerWithVerb(props: Props): React.ReactNode {
  return <SpinnerWithVerbInner {...props} />;
}

function SpinnerWithVerbInner({
  mode,
  loadingStartTimeRef,
  totalPausedMsRef,
  pauseStartTimeRef,
  spinnerTip,
  responseLengthRef,
  overrideColor,
  overrideShimmerColor,
  overrideMessage,
  spinnerSuffix,
  verbose,
  compactProgressActiveRef,
  hasActiveTools = false,
  leaderIsIdle = false,
}: Props): React.ReactNode {
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;

  // NOTE: useAnimationFrame(50) lives in SpinnerAnimationRow, not here.
  // This component only re-renders when props or app state change —
  // it is no longer on the 50ms clock. All `time`-derived values
  // (frame, glimmer, stalled intensity, token counter, thinking shimmer,
  // elapsed-time timer) are computed inside the child.

  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const expandedView = useAppState(s => s.expandedView);
  const showExpandedTodos = expandedView === 'tasks';
  const showSpinnerTree = expandedView === 'teammates';
  const selectedIPAgentIndex = useAppState(s => s.selectedIPAgentIndex);
  const viewSelectionMode = useAppState(s => s.viewSelectionMode);
  // Get foregrounded teammate (if viewing a teammate's transcript)
  const foregroundedTeammate = viewingAgentTaskId ? getViewedTeammateTask({ viewingAgentTaskId, tasks }) : undefined;
  const { columns } = useTerminalSize();
  const tasksV2 = useTasksV2();

  // Track thinking status: 'thinking' | number (duration in ms) | null
  // Shows each state for minimum 2s to avoid UI jank
  const [thinkingStatus, setThinkingStatus] = useState<'thinking' | number | null>(null);
  const thinkingStartRef = useRef<number | null>(null);

  useEffect(() => {
    let showDurationTimer: ReturnType<typeof setTimeout> | null = null;
    let clearStatusTimer: ReturnType<typeof setTimeout> | null = null;

    if (mode === 'thinking') {
      // Started thinking
      if (thinkingStartRef.current === null) {
        thinkingStartRef.current = Date.now();
        setThinkingStatus('thinking');
      }
    } else if (thinkingStartRef.current !== null) {
      // Stopped thinking - calculate duration and ensure 2s minimum display
      const duration = Date.now() - thinkingStartRef.current;
      const elapsed = Date.now() - thinkingStartRef.current;
      const remainingThinkingTime = Math.max(0, 2000 - elapsed);

      thinkingStartRef.current = null;

      // Show "thinking..." for remaining time if < 2s elapsed, then show duration
      const showDuration = (): void => {
        setThinkingStatus(duration);
        // Clear after 2s
        clearStatusTimer = setTimeout(setThinkingStatus, 2000, null);
      };

      if (remainingThinkingTime > 0) {
        showDurationTimer = setTimeout(showDuration, remainingThinkingTime);
      } else {
        showDuration();
      }
    }

    return () => {
      if (showDurationTimer) clearTimeout(showDurationTimer);
      if (clearStatusTimer) clearTimeout(clearStatusTimer);
    };
  }, [mode]);

  // Find the current in-progress task and next pending task
  const currentTodo = tasksV2?.find(task => task.status !== 'pending' && task.status !== 'completed');
  const nextTask = findNextPendingTask(tasksV2);

  // Use useState with initializer to pick a random verb once on mount
  const [randomVerb] = useState(() => sample(getSpinnerVerbs()));

  // Leader's own verb (always the leader's, regardless of who is foregrounded)
  const leaderVerb = overrideMessage ?? currentTodo?.activeForm ?? currentTodo?.subject ?? randomVerb;

  const effectiveVerb =
    foregroundedTeammate && !foregroundedTeammate.isIdle
      ? (foregroundedTeammate.spinnerVerb ?? randomVerb)
      : leaderVerb;
  const message = effectiveVerb + '…';

  // Track CLI activity when spinner is active
  useEffect(() => {
    const operationId = 'spinner-' + mode;
    activityManager.startCLIActivity(operationId);
    return () => {
      activityManager.endCLIActivity(operationId);
    };
  }, [mode]);

  const effortValue = useAppState(s => s.effortValue);
  const effortSuffix = getEffortSuffix(getMainLoopModel(), effortValue);

  // Check if any running in-process teammates exist (needed for both modes)
  const runningTeammates = getAllInProcessTeammateTasks(tasks).filter(t => t.status === 'running');
  const hasRunningTeammates = runningTeammates.length > 0;
  const allIdle = hasRunningTeammates && runningTeammates.every(t => t.isIdle);

  // Gather aggregate token stats from all running agents.
  // In spinner-tree mode, skip in-process teammates (they have their own
  // per-teammate lines in the tree) but still count local-agent tasks
  // (background agents) which have no dedicated tree rows.
  let teammateTokens = 0;
  for (const task of Object.values(tasks)) {
    if (task.status !== 'running') continue;
    if (isInProcessTeammateTask(task)) {
      if (!showSpinnerTree && task.progress?.tokenCount) {
        teammateTokens += task.progress.tokenCount;
      }
      continue;
    }
    if (isLocalAgentTask(task)) {
      if (task.progress?.tokenCount) {
        teammateTokens += task.progress.tokenCount;
      }
    }
  }

  // This only updates when props/app state change, which is sufficient for
  // the coarse long-running-task threshold.
  const elapsedSnapshot =
    pauseStartTimeRef.current !== null
      ? pauseStartTimeRef.current - loadingStartTimeRef.current - totalPausedMsRef.current
      : Date.now() - loadingStartTimeRef.current - totalPausedMsRef.current;

  // Leader token count for TeammateSpinnerTree — read raw (non-animated) from
  // the ref. The tree is only shown when teammates are running; teammate
  // progress updates to s.tasks trigger re-renders that keep this fresh.
  const leaderTokenCount = Math.round(responseLengthRef.current / 4);

  const defaultColor: SpinnerColor = 'sophiaPink';
  const defaultShimmerColor: SpinnerColor = 'sophiaPinkShimmer';
  const messageColor = overrideColor ?? defaultColor;
  const shimmerColor = overrideShimmerColor ?? defaultShimmerColor;

  // TTFT display is gated to internal builds — apiMetricsRef was removed from
  // props during a refactor, so skip this until it's re-threaded.
  const _ttftText: string | null = null;

  // When leader is idle but teammates are running (and we're viewing the leader),
  // show a static dim idle display instead of the animated spinner — otherwise
  // useStalledAnimation detects no new tokens after 3s and turns the spinner red.
  if (leaderIsIdle && hasRunningTeammates && !foregroundedTeammate) {
    return (
      <Box flexDirection="column" width="100%" alignItems="flex-start">
        <Box flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
          <Text dimColor>
            {SOPHIA_MARK} Idle
            {!allIdle && ' · agents running'}
          </Text>
        </Box>
        {showSpinnerTree && (
          <TeammateSpinnerTree
            selectedIndex={selectedIPAgentIndex}
            isInSelectionMode={viewSelectionMode === 'selecting-agent'}
            allIdle={allIdle}
            leaderTokenCount={leaderTokenCount}
            leaderIdleText="Idle"
          />
        )}
      </Box>
    );
  }

  // When viewing an idle teammate, show static idle display instead of animated spinner
  if (foregroundedTeammate?.isIdle) {
    const idleText = allIdle
      ? `${SOPHIA_MARK} Worked for ${formatDuration(Date.now() - foregroundedTeammate.startTime)}`
      : `${SOPHIA_MARK} Idle`;
    return (
      <Box flexDirection="column" width="100%" alignItems="flex-start">
        <Box flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
          <Text dimColor>{idleText}</Text>
        </Box>
        {showSpinnerTree && hasRunningTeammates && (
          <TeammateSpinnerTree
            selectedIndex={selectedIPAgentIndex}
            isInSelectionMode={viewSelectionMode === 'selecting-agent'}
            allIdle={allIdle}
            leaderVerb={leaderIsIdle ? undefined : leaderVerb}
            leaderIdleText={leaderIsIdle ? 'Idle' : undefined}
            leaderTokenCount={leaderTokenCount}
          />
        )}
      </Box>
    );
  }

  // Time-based tip overrides: coarse thresholds so a stale ref read (we're
  // off the 50ms clock) is fine. Other triggers (mode change, setMessages)
  // cause re-renders that refresh this in practice.
  let contextTipsActive = false;
  const tipsEnabled = settings.spinnerTipsEnabled !== false;
  const showClearTip = tipsEnabled && elapsedSnapshot > 1_800_000;

  const effectiveTip = contextTipsActive
    ? undefined
    : showClearTip && !nextTask
      ? 'Use /new to start fresh when switching topics and free up context'
      : spinnerTip;

  // Budget text (ant-only) — shown above the tip line
  let budgetText: string | null = null;
  if (feature('TOKEN_BUDGET')) {
    const budget = getCurrentTurnTokenBudget();
    if (budget !== null && budget > 0) {
      const tokens = getTurnOutputTokens();
      if (tokens >= budget) {
        budgetText = `Target: ${formatNumber(tokens)} used (${formatNumber(budget)} min ${figures.tick})`;
      } else {
        const pct = Math.round((tokens / budget) * 100);
        const remaining = budget - tokens;
        const rate = elapsedSnapshot > 5000 && tokens >= 2000 ? tokens / elapsedSnapshot : 0;
        const eta = rate > 0 ? ` \u00B7 ~${formatDuration(remaining / rate, { mostSignificantOnly: true })}` : '';
        budgetText = `Target: ${formatNumber(tokens)} / ${formatNumber(budget)} (${pct}%)${eta}`;
      }
    }
  }

  return (
    <Box flexDirection="column" width="100%" alignItems="flex-start">
      <SpinnerAnimationRow
        mode={mode}
        reducedMotion={reducedMotion}
        hasActiveTools={hasActiveTools}
        responseLengthRef={responseLengthRef}
        message={message}
        messageColor={messageColor}
        shimmerColor={shimmerColor}
        overrideColor={overrideColor}
        loadingStartTimeRef={loadingStartTimeRef}
        totalPausedMsRef={totalPausedMsRef}
        pauseStartTimeRef={pauseStartTimeRef}
        spinnerSuffix={spinnerSuffix}
        verbose={verbose}
        columns={columns}
        compactProgressActiveRef={compactProgressActiveRef}
        hasRunningTeammates={hasRunningTeammates}
        teammateTokens={teammateTokens}
        foregroundedTeammate={foregroundedTeammate}
        leaderIsIdle={leaderIsIdle}
        thinkingStatus={thinkingStatus}
        effortSuffix={effortSuffix}
      />
      {showSpinnerTree && hasRunningTeammates ? (
        <TeammateSpinnerTree
          selectedIndex={selectedIPAgentIndex}
          isInSelectionMode={viewSelectionMode === 'selecting-agent'}
          allIdle={allIdle}
          leaderVerb={leaderIsIdle ? undefined : leaderVerb}
          leaderIdleText={leaderIsIdle ? 'Idle' : undefined}
          leaderTokenCount={leaderTokenCount}
        />
      ) : showExpandedTodos && tasksV2 && tasksV2.length > 0 ? (
        <Box width="100%" flexDirection="column">
          <MessageResponse>
            <TaskListV2 tasks={tasksV2} />
          </MessageResponse>
        </Box>
      ) : nextTask || effectiveTip || budgetText ? (
        // IMPORTANT: we need this width="100%" to avoid an Ink bug where the
        // tip gets duplicated over and over while the spinner is running if
        // the terminal is very small. TODO: fix this in Ink.
        <Box width="100%" flexDirection="column">
          {budgetText && (
            <MessageResponse>
              <Text dimColor>{budgetText}</Text>
            </MessageResponse>
          )}
          {(nextTask || effectiveTip) && (
            <MessageResponse>
              <Text dimColor>{nextTask ? `Next: ${nextTask.subject}` : `Tip: ${effectiveTip}`}</Text>
            </MessageResponse>
          )}
        </Box>
      ) : null}
    </Box>
  );
}

export function Spinner(): React.ReactNode {
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
  const [ref, time] = useAnimationFrame(reducedMotion ? null : MODEL_SPINNER_FRAME_MS);

  return (
    <Box ref={ref} flexWrap="wrap" height={1} width={MODEL_SPINNER_WIDTH}>
      <ModelSpinnerGlyph
        frame={Math.floor(time / MODEL_SPINNER_FRAME_MS)}
        messageColor="sophiaPink"
        reducedMotion={reducedMotion}
        time={time}
      />
    </Box>
  );
}

function findNextPendingTask(tasks: Task[] | undefined): Task | undefined {
  if (!tasks) {
    return undefined;
  }
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  if (pendingTasks.length === 0) {
    return undefined;
  }
  const unresolvedIds = new Set(tasks.filter(t => t.status !== 'completed').map(t => t.id));
  return pendingTasks.find(t => !t.blockedBy.some(id => unresolvedIds.has(id))) ?? pendingTasks[0];
}
