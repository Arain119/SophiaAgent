import * as React from 'react';
import { Box, useAnimationFrame } from '@anthropic/ink';
import { EffortPanel } from '../../components/EffortPanel/EffortPanel.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useSettings } from '../../hooks/useSettings.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import {
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortValueDescription,
  isEffortLevel,
  toPersistableEffort,
} from '../../utils/effort.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { EffortWave, EFFORT_WAVE_WIDTH } from '../../components/Spinner/SpinnerGlyph.js';

const COMMON_HELP_ARGS = ['help', '-h', '--help'];

type EffortCommandResult = {
  message: string;
  effortUpdate?: { value: EffortValue | undefined };
};

function setEffortValue(effortValue: EffortValue): EffortCommandResult {
  const persistable = toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable,
    });
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`,
      };
    }
  }
  logEvent('tengu_effort_command', {
    effort: effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts. If env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.SOPHIA_EFFORT_LEVEL;
    if (persistable === undefined) {
      return {
        message: `Not applied: SOPHIA_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: { value: effortValue },
      };
    }
    return {
      message: `SOPHIA_EFFORT_LEVEL=${envRaw} overrides this session; clear it and ${effortValue} takes over`,
      effortUpdate: { value: effortValue },
    };
  }

  const description = getEffortValueDescription(effortValue);
  const suffix = persistable !== undefined ? '' : ' (this session only)';
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: { value: effortValue },
  };
}

export function showCurrentEffort(appStateEffort: EffortValue | undefined, model: string): EffortCommandResult {
  const envOverride = getEffortEnvOverride();
  const effectiveValue = envOverride ?? appStateEffort ?? getDisplayedEffortLevel(model, appStateEffort);
  const description = getEffortValueDescription(effectiveValue);
  return {
    message: `Current effort level: ${effectiveValue} (${description})`,
  };
}

export function executeEffort(args: string): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: low, medium, high, xhigh, max`,
    };
  }

  return setEffortValue(normalized);
}

function ShowCurrentEffort({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue);
  const model = useMainLoopModel();
  const { message } = showCurrentEffort(effortValue, model);
  onDone(message);
  return null;
}

function ApplyEffortAndClose({
  result,
  onDone,
}: {
  result: EffortCommandResult;
  onDone: (result: string) => void;
}): React.ReactNode {
  const setAppState = useSetAppState();
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
  const [waveRef, time] = useAnimationFrame(reducedMotion ? null : 60);
  const effortValue = result.effortUpdate?.value;
  const effortLevel = typeof effortValue === 'string' && isEffortLevel(effortValue) ? effortValue : undefined;

  React.useEffect(() => {
    if (result.effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue,
      }));
    }
    if (!effortLevel) {
      onDone(result.message);
      return;
    }
    const timer = setTimeout(onDone, reducedMotion ? 160 : 720, result.message);
    return () => clearTimeout(timer);
  }, [effortLevel, effortValue, onDone, reducedMotion, result.effortUpdate, result.message, setAppState]);

  if (!effortLevel) return null;
  return (
    <Box ref={waveRef} justifyContent="center" marginY={1} width={EFFORT_WAVE_WIDTH + 2}>
      <EffortWave effortLevel={effortLevel} frame={Math.floor(time / 120)} reducedMotion={reducedMotion} time={time} />
    </Box>
  );
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Usage: /effort [low|medium|high|xhigh|max]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extended reasoning beyond high, short of max; including OpenAI reasoning models\n- max: Maximum capability with deepest reasoning',
    );
    return;
  }

  if (!args || args === 'current' || args === 'status') {
    if (args === 'current' || args === 'status') {
      return <ShowCurrentEffort onDone={onDone} />;
    }
    // No argument opens the interactive panel.
    return <EffortPanelWrapper onDone={onDone} />;
  }

  const result = executeEffort(args);
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
}

function EffortPanelWrapper({ onDone }: { onDone: (result: string) => void }): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue);
  return <EffortPanel appStateEffort={effortValue} onDone={onDone} />;
}
