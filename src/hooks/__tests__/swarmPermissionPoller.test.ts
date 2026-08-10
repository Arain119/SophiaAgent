import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearAllPendingCallbacks,
  hasSandboxPermissionCallback,
  processSandboxPermissionResponse,
  registerSandboxPermissionCallback,
} from '../../hooks/useSwarmPermissionPoller.js'

afterEach(() => clearAllPendingCallbacks())

describe('sandbox permission callback registry', () => {
  test('resolves and removes a registered callback', () => {
    let allowed: boolean | undefined
    registerSandboxPermissionCallback({
      requestId: 'sandbox-1',
      host: 'example.com',
      resolve: value => {
        allowed = value
      },
    })

    expect(hasSandboxPermissionCallback('sandbox-1')).toBe(true)
    expect(
      processSandboxPermissionResponse({
        requestId: 'sandbox-1',
        host: 'example.com',
        allow: true,
      }),
    ).toBe(true)
    expect(allowed).toBe(true)
    expect(hasSandboxPermissionCallback('sandbox-1')).toBe(false)
  })

  test('returns false for an unknown request', () => {
    expect(
      processSandboxPermissionResponse({
        requestId: 'missing',
        host: 'example.com',
        allow: false,
      }),
    ).toBe(false)
  })
})
