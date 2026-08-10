import * as React from 'react';
import { Box, Text } from '@anthropic/ink';

export function CompactBoundaryMessage(): React.ReactNode {
  return (
    <Box marginY={1}>
      <Text dimColor>{'\u25cf Conversation compacted'}</Text>
    </Box>
  );
}
