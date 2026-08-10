import { Byline, Text } from '@anthropic/ink';
import React from 'react';
import type { z } from 'zod/v4';
import type { inputSchema, Output } from './AutoPluginTool.js';

type Input = z.infer<ReturnType<typeof inputSchema>>;

export function renderToolUseMessage({ task }: Partial<Input>): React.ReactNode {
  return task ? `Finding a plugin for: ${task.slice(0, 80)}` : 'Finding a plugin';
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const status = output.success
    ? output.activated
      ? 'Automatically installed and activated'
      : 'Automatically installed; restart required'
    : 'No plugin installed';
  return (
    <Text>
      <Byline>{[status, output.pluginId ?? '']}</Byline>
    </Text>
  );
}
