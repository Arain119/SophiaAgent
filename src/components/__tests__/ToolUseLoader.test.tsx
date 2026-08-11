import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from '../../utils/staticRender.js';
import { ToolUseLoader } from '../ToolUseLoader.js';

describe('ToolUseLoader visual hierarchy', () => {
  test('renders completed work as a check mark', async () => {
    const output = await renderToString(<ToolUseLoader isError={false} isUnresolved={false} shouldAnimate={false} />);
    expect(output.trim()).toBe('✓');
  });

  test('renders failures as a cross', async () => {
    const output = await renderToString(<ToolUseLoader isError isUnresolved={false} shouldAnimate={false} />);
    expect(output.trim()).toBe('×');
  });
});
