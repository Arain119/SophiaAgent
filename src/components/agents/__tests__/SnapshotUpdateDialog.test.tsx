import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { launchSnapshotUpdateDialog } from '../../../dialogLaunchers.js';
import { buildMergePrompt, SnapshotUpdateDialog } from '../SnapshotUpdateDialog.js';
import { Select } from '../../CustomSelect/index.js';

function getSnapshotDialogFromRenderedTree(rendered: React.ReactElement) {
  const themeProvider = rendered as React.ReactElement<{
    children: React.ReactElement;
  }>;
  const appStateProvider = themeProvider.props.children as React.ReactElement<{
    children: React.ReactElement;
  }>;
  const keybindingSetup = appStateProvider.props.children as React.ReactElement<{
    children: React.ReactElement;
  }>;
  return keybindingSetup.props.children as React.ReactElement<{
    agentType: string;
    scope: string;
    snapshotTimestamp: string;
    onComplete: (choice: 'merge' | 'keep' | 'replace') => void;
    onCancel: () => void;
  }>;
}

async function waitForRender(getRendered: () => React.ReactElement | null): Promise<React.ReactElement> {
  for (let i = 0; i < 10; i++) {
    const rendered = getRendered();
    if (rendered) return rendered;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Snapshot update dialog was not rendered');
}

describe('SnapshotUpdateDialog', () => {
  test('launchSnapshotUpdateDialog keeps current memory on cancel', async () => {
    let rendered: React.ReactElement | null = null;
    const root = {
      render(node: React.ReactElement) {
        rendered = node;
      },
    } as any;

    const resultPromise = launchSnapshotUpdateDialog(root, {
      agentType: 'researcher',
      scope: 'project',
      snapshotTimestamp: '2026-04-15T12:00:00.000Z',
    });

    const dialogElement = getSnapshotDialogFromRenderedTree(await waitForRender(() => rendered));
    expect(dialogElement.type).toBe(SnapshotUpdateDialog);
    dialogElement.props.onCancel();
    await expect(resultPromise).resolves.toBe('keep');
  });

  test('buildMergePrompt varies with agent type and scope', () => {
    const projectPrompt = buildMergePrompt('researcher', 'project');
    expect(projectPrompt).toContain('researcher');
    expect(projectPrompt).toContain('project');
    expect(projectPrompt).not.toBe(buildMergePrompt('researcher', 'user'));
    expect(projectPrompt).not.toBe(buildMergePrompt('planner', 'project'));
  });

  test('renders snapshot choices', () => {
    const element = SnapshotUpdateDialog({
      agentType: 'researcher',
      scope: 'project',
      snapshotTimestamp: '2026-04-15T12:00:00.000Z',
      onComplete: () => {},
      onCancel: () => {},
    }) as React.ReactElement<{
      title: string;
      children: React.ReactNode[];
    }>;
    expect(element.props.title).toBe('Agent memory snapshot update');
    const [, select] = element.props.children as Array<React.ReactElement<Record<string, unknown>>>;
    expect(select?.type).toBe(Select);
  });
});
