import { describe, expect, test } from 'bun:test';
import { renderToString } from 'src/utils/staticRender.js';
import { renderToolResultMessage, renderToolUseMessage } from '../UI.js';

describe('EnterPlanModeTool UI', () => {
  test('hides the empty tool-use activity row', () => {
    expect(renderToolUseMessage()).toBeNull();
  });

  test('renders only the plan-mode result without a completed activity marker', async () => {
    const output = await renderToString(
      renderToolResultMessage({ message: 'Entered plan mode.' }, [], { theme: 'dark' }),
    );

    expect(output).toContain('● Entered plan mode');
    expect(output).toContain('Sophia is now exploring and designing an implementation approach.');
    expect(output).not.toContain('✓');
  });
});
