import { Byline, Text } from '@anthropic/ink';
import React from 'react';
import type { z } from 'zod/v4';
import type { inputSchema, Output } from './AutoMcpTool.js';

type Input = z.infer<ReturnType<typeof inputSchema>>;

export function renderToolUseMessage({ task }: Partial<Input>): React.ReactNode {
  return task ? `Finding MCP capability for: ${task.slice(0, 80)}` : 'Finding MCP capability';
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  return (
    <Text>
      <Byline>
        {output.success
          ? [`Connected MCP server`, output.serverName ?? '']
          : [output.requirements?.length ? 'MCP setup required' : 'No MCP found']}
      </Byline>
    </Text>
  );
}
