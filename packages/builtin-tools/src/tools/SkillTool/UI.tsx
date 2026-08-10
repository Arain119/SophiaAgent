import { Byline, Text } from '@anthropic/ink';
import React from 'react';
import type { z } from 'zod/v4';
import type { inputSchema, Output } from './SkillTool.js';

type Input = z.infer<ReturnType<typeof inputSchema>>;

export function renderToolUseMessage({ task }: Partial<Input>): React.ReactNode {
  return task ? `Finding a skill for: ${task.slice(0, 80)}` : 'Finding a skill';
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  return (
    <Text>
      <Byline>
        {output.success ? [`Loaded ${output.source} skill`, output.skillName ?? ''] : ['No matching skill']}
      </Byline>
    </Text>
  );
}
