import React from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Text } from '@anthropic/ink';
import { jsonParse } from 'src/utils/slowOperations.js';
import type { Input, SendMessageToolOutput } from './SendMessageTool.js';

export function renderToolUseMessage(_input: Partial<Input>): React.ReactNode {
  return null;
}

export function renderToolResultMessage(
  content: SendMessageToolOutput | string,
  _progressMessages: unknown,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const result: SendMessageToolOutput = typeof content === 'string' ? jsonParse(content) : content;

  if ('routing' in result && result.routing) {
    return null;
  }

  if ('request_id' in result && 'target' in result) {
    return null;
  }

  return (
    <MessageResponse>
      <Text dimColor>{result.message}</Text>
    </MessageResponse>
  );
}
