import { feature } from 'bun:bundle';
import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import {
  calculateTokenWarningState,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
} from '../services/compact/autoCompact.js';
import { useCompactWarningSuppression } from '../services/compact/compactWarningHook.js';

type Props = {
  tokenUsage: number;
  model: string;
};

export function TokenWarning({ tokenUsage, model }: Props): React.ReactNode {
  const { percentLeft, isAboveWarningThreshold, isAboveErrorThreshold } = calculateTokenWarningState(tokenUsage, model);
  const suppressWarning = useCompactWarningSuppression();

  if (!isAboveWarningThreshold || suppressWarning) return null;

  const showAutoCompactWarning = isAutoCompactEnabled();

  let displayPercentLeft = percentLeft;
  let reactiveOnlyMode = false;

  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      reactiveOnlyMode = true;
      const effectiveWindow = getEffectiveContextWindowSize(model);
      displayPercentLeft = Math.max(0, Math.round(((effectiveWindow - tokenUsage) / effectiveWindow) * 100));
    }
  }

  const autocompactLabel = reactiveOnlyMode
    ? `${100 - displayPercentLeft}% context used`
    : `${displayPercentLeft}% until auto-compact`;

  return (
    <Box flexDirection="row">
      {showAutoCompactWarning ? (
        <Text dimColor wrap="truncate">
          {autocompactLabel}
        </Text>
      ) : (
        <Text color={isAboveErrorThreshold ? 'error' : 'warning'} wrap="truncate">
          {`Context low (${percentLeft}% remaining) \u00b7 Sophia will compact older messages automatically`}
        </Text>
      )}
    </Box>
  );
}
