/**
 * Shared minimal ToolUseContext stub for tool unit tests.
 *
 * Provides only the fields tools actually access in tests:
 *  - getAppState() returns a context with empty rule arrays for every source
 *  - toolUseId / parentMessageId / assistantMessageId / turnId can be
 *    overridden per test for budget tracking tests
 *
 * Usage:
 *   import { mockToolContext } from 'tests/mocks/toolContext'
 *   const ctx = mockToolContext({ toolUseId: 't1' })
 *
 * Per memory feedback "Mock dependency not subject" — this exists so each
 * tool test file does not redefine the same partial stub.
 */

const emptyRules = {
  user: [],
  project: [],
  local: [],
  session: [],
  cliArg: [],
}

export interface MockToolContextOptions {
  toolUseId?: string
  parentMessageId?: string
  assistantMessageId?: string
  turnId?: string
  /** Override toolSafetyContext fields (e.g. mode, allowRules). */
  permissionOverrides?: Record<string, unknown>
}

export function mockToolContext(opts: MockToolContextOptions = {}): never {
  return {
    toolUseId: opts.toolUseId,
    parentMessageId: opts.parentMessageId,
    assistantMessageId: opts.assistantMessageId,
    turnId: opts.turnId,
    getAppState: () => ({
      toolSafetyContext: {
        mode: 'default',
        additionalWorkingDirectories: new Set(),
        allowRules: { ...emptyRules },
        denyRules: { ...emptyRules },
        ...(opts.permissionOverrides ?? {}),
      },
    }),
  } as never
}
