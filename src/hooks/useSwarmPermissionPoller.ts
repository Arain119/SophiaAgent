import { logForDebugging } from '../utils/debug.js'

export type SandboxPermissionResponseCallback = {
  requestId: string
  host: string
  resolve: (allow: boolean) => void
}

const pendingSandboxCallbacks = new Map<
  string,
  SandboxPermissionResponseCallback
>()

export function clearAllPendingCallbacks(): void {
  pendingSandboxCallbacks.clear()
}

export function registerSandboxPermissionCallback(
  callback: SandboxPermissionResponseCallback,
): void {
  pendingSandboxCallbacks.set(callback.requestId, callback)
}

export function hasSandboxPermissionCallback(requestId: string): boolean {
  return pendingSandboxCallbacks.has(requestId)
}

export function processSandboxPermissionResponse(params: {
  requestId: string
  host: string
  allow: boolean
}): boolean {
  const callback = pendingSandboxCallbacks.get(params.requestId)
  if (!callback) {
    logForDebugging(
      `[SandboxSync] No callback registered for ${params.requestId}`,
    )
    return false
  }

  pendingSandboxCallbacks.delete(params.requestId)
  callback.resolve(params.allow)
  return true
}
