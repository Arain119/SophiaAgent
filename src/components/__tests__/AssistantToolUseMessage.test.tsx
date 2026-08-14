import { describe, expect, test } from 'bun:test';
import { hasVisibleToolName } from '../messages/AssistantToolUseMessage.js';

describe('AssistantToolUseMessage display contract', () => {
  test('internal tool names must not render a standalone completion indicator', () => {
    expect(hasVisibleToolName('Bash')).toBe(true);
    expect(hasVisibleToolName('')).toBe(false);
    expect(hasVisibleToolName('   ')).toBe(false);
    expect(hasVisibleToolName(undefined)).toBe(false);
    expect(hasVisibleToolName(null)).toBe(false);
  });
});
