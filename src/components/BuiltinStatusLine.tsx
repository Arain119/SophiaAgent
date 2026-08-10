import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { formatTokens } from '../utils/format.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

type BuiltinStatusLineProps = {
  modelName: string;
  contextUsedPct: number;
  usedTokens: number;
  contextWindowSize: number;
};

function Separator() {
  return <Text dimColor>{' \u2502 '}</Text>;
}

function BuiltinStatusLineInner({ modelName, contextUsedPct, usedTokens, contextWindowSize }: BuiltinStatusLineProps) {
  const { columns } = useTerminalSize();

  // Model display uses two words when the provider supplies a display label.
  const modelParts = modelName.split(' ');
  const shortModel = modelParts.length >= 2 ? `${modelParts[0]} ${modelParts[1]}` : modelName;

  const narrow = columns < 60;

  // Token display: "50k/1M"
  const tokenDisplay = `${formatTokens(usedTokens)}/${formatTokens(contextWindowSize)}`;

  return (
    <Box>
      {/* Model name */}
      <Text>{shortModel}</Text>

      {/* Context usage with token counts */}
      <Separator />
      <Text dimColor>Context </Text>
      <Text>{contextUsedPct}%</Text>
      {!narrow && <Text dimColor> ({tokenDisplay})</Text>}
    </Box>
  );
}

export const BuiltinStatusLine = React.memo(BuiltinStatusLineInner);
