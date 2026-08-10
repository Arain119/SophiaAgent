import * as React from 'react';
import { Box, useAnimationFrame, useTerminalSize } from '@anthropic/ink';
import { executeEffort } from '../../commands/effort/effort.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useSetAppState } from '../../state/AppState.js';
import { type EffortValue, getDisplayedEffortLevel, getEffortEnvOverride } from '../../utils/effort.js';
import { EffortRippleSurface } from './EffortRippleSurface.js';
import {
  CANCEL_MESSAGE,
  computeConfirmOutcome,
  END_POSITION,
  getInitialCursor,
  HOME_POSITION,
  moveLeft,
  moveRight,
  PANEL_POSITIONS,
  type PanelPosition,
} from './effortPanelState.js';

const MIN_SEGMENT_WIDTH = 7;
const APPLY_ANIMATION_MS = 720;
const REDUCED_MOTION_APPLY_MS = 160;

function computeSegmentWidth(terminalColumns: number): number {
  const available = Math.max(0, terminalColumns - 2);
  return Math.max(MIN_SEGMENT_WIDTH, Math.floor(available / PANEL_POSITIONS.length));
}

type Props = {
  appStateEffort: EffortValue | undefined;
  onDone: (message: string) => void;
};

export function EffortPanel({ appStateEffort, onDone }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const model = useMainLoopModel();
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
  const [waveRef, time] = useAnimationFrame(reducedMotion ? null : 60);
  const { columns } = useTerminalSize();
  const segmentWidth = React.useMemo(() => computeSegmentWidth(columns), [columns]);
  const panelWidth = segmentWidth * PANEL_POSITIONS.length;

  const initialCursor = getInitialCursor({
    envOverride: getEffortEnvOverride(),
    appStateEffort,
    displayed: getDisplayedEffortLevel(model, appStateEffort),
  });
  const [cursor, setCursor] = React.useState<PanelPosition>(initialCursor);
  const [waveStartedAt, setWaveStartedAt] = React.useState(time);
  const [pendingMessage, setPendingMessage] = React.useState<string>();
  const cursorRef = React.useRef(cursor);
  const timeRef = React.useRef(time);
  const doneRef = React.useRef(false);
  cursorRef.current = cursor;
  timeRef.current = time;

  const finish = React.useCallback(
    (message: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone(message);
    },
    [onDone],
  );

  React.useEffect(() => {
    if (!pendingMessage) return;
    const timer = setTimeout(finish, reducedMotion ? REDUCED_MOTION_APPLY_MS : APPLY_ANIMATION_MS, pendingMessage);
    return () => clearTimeout(timer);
  }, [finish, pendingMessage, reducedMotion]);

  const handleConfirm = React.useCallback(() => {
    if (doneRef.current || pendingMessage) return;
    const selected = cursorRef.current;
    const outcome = computeConfirmOutcome(selected, executeEffort);
    if (outcome.effortUpdate) {
      setAppState(previous => ({
        ...previous,
        effortValue: outcome.effortUpdate?.value,
      }));
    }
    setWaveStartedAt(timeRef.current);
    setPendingMessage(outcome.message);
  }, [pendingMessage, setAppState]);

  const handleCancel = React.useCallback(() => {
    if (pendingMessage) return;
    finish(CANCEL_MESSAGE);
  }, [finish, pendingMessage]);

  const updateCursor = React.useCallback(
    (update: (position: PanelPosition) => PanelPosition) => {
      if (pendingMessage) return;
      const next = update(cursorRef.current);
      if (next === cursorRef.current) return;
      cursorRef.current = next;
      setCursor(next);
      setWaveStartedAt(timeRef.current);
    },
    [pendingMessage],
  );

  useKeybindings(
    {
      'effortPanel:decrease': () => updateCursor(moveLeft),
      'effortPanel:increase': () => updateCursor(moveRight),
      'effortPanel:home': () => updateCursor(() => HOME_POSITION),
      'effortPanel:end': () => updateCursor(() => END_POSITION),
      'effortPanel:confirm': handleConfirm,
      'effortPanel:cancel': handleCancel,
    },
    { context: 'EffortPanel' },
  );

  const envOverride = getEffortEnvOverride();
  const envText =
    envOverride !== undefined
      ? 'SOPHIA_EFFORT_LEVEL=' + process.env.SOPHIA_EFFORT_LEVEL + ' overrides this session'
      : undefined;
  const status = pendingMessage ? 'Applying ' + cursor + '...' : '<- -> adjust | Enter confirm | Esc cancel';

  return (
    <Box ref={waveRef} flexDirection="column" paddingX={1} width={panelWidth + 2}>
      <EffortRippleSurface
        cursor={cursor}
        elapsed={Math.max(0, time - waveStartedAt)}
        envText={envText}
        reducedMotion={reducedMotion}
        segmentWidth={segmentWidth}
        status={status}
        width={panelWidth}
      />
    </Box>
  );
}
