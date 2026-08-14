import { describe, expect, test } from 'bun:test';
import { compactVisibleItems } from '../UI.js';

const blocks = Array.from({ length: 5 }, (_, index) => ({
  type: 'text' as const,
  text: `block-${index + 1}`,
}));

describe('MCPTool result UI', () => {
  test('limits content blocks in the default view', async () => {
    const result = compactVisibleItems(blocks, false);
    expect(result.visible.map(block => block.text)).toEqual(['block-1', 'block-2', 'block-3']);
    expect(result.hiddenCount).toBe(2);
  });

  test('shows every content block in verbose mode', async () => {
    const result = compactVisibleItems(blocks, true);
    expect(result.visible).toEqual(blocks);
    expect(result.hiddenCount).toBe(0);
  });
});
