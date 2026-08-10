import React from 'react';
import { ExitFlow } from '../../components/ExitFlow.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  if (getCurrentWorktreeSession() !== null) {
    return <ExitFlow showWorktree onDone={onDone} onCancel={() => onDone()} />;
  }

  onDone('Goodbye!');
  await gracefulShutdown(0, 'prompt_input_exit');
  return null;
}
