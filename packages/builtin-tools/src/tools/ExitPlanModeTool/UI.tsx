import * as React from 'react';
import { Markdown } from 'src/components/Markdown.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { getModeColor } from 'src/utils/safety/ExecutionMode.js';
import { Box, Text } from '@anthropic/ink';
import type { ToolProgressData } from 'src/Tool.js';
import type { ProgressMessage } from 'src/types/message.js';
import { getDisplayPath } from 'src/utils/file.js';
import type { ThemeName } from 'src/utils/theme.js';
import type { Output } from './ExitPlanModeV2Tool.js';

export function renderToolUseMessage(): React.ReactNode {
  return null;
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { theme: _theme }: { theme: ThemeName },
): React.ReactNode {
  const { plan, filePath } = output;
  const isEmpty = !plan || plan.trim() === '';
  const displayPath = filePath ? getDisplayPath(filePath) : '';

  // Simplified message for empty plans
  if (isEmpty) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
          <Text> Exited plan mode</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
        <Text> Plan ready for implementation</Text>
      </Box>
      <MessageResponse>
        <Box flexDirection="column">
          {filePath && <Text dimColor>Plan saved to: {displayPath}</Text>}
          <Markdown>{plan}</Markdown>
        </Box>
      </MessageResponse>
    </Box>
  );
}
