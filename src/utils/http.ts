/**
 * HTTP utility constants and helpers
 */

import { getWorkload } from './workloadContext.js'

export function getUserAgent(): string {
  const agentSdkVersion = process.env.CLAUDE_AGENT_SDK_VERSION
    ? `, agent-sdk/${process.env.CLAUDE_AGENT_SDK_VERSION}`
    : ''
  // SDK consumers can identify their app/library via CLAUDE_AGENT_SDK_CLIENT_APP
  // e.g., "my-app/1.0.0" or "my-library/2.1"
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
    ? `, client-app/${process.env.CLAUDE_AGENT_SDK_CLIENT_APP}`
    : ''
  const workload = getWorkload()
  const workloadSuffix = workload ? `, workload/${workload}` : ''
  return `sophia-agent/${MACRO.VERSION} (${process.env.SOPHIA_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp}${workloadSuffix})`
}

export function getMCPUserAgent(): string {
  const parts: string[] = []
  if (process.env.SOPHIA_ENTRYPOINT) {
    parts.push(process.env.SOPHIA_ENTRYPOINT)
  }
  if (process.env.CLAUDE_AGENT_SDK_VERSION) {
    parts.push(`agent-sdk/${process.env.CLAUDE_AGENT_SDK_VERSION}`)
  }
  if (process.env.CLAUDE_AGENT_SDK_CLIENT_APP) {
    parts.push(`client-app/${process.env.CLAUDE_AGENT_SDK_CLIENT_APP}`)
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `sophia-agent/${MACRO.VERSION}${suffix}`
}

export function getWebFetchUserAgent(): string {
  return `Sophia-Agent/${MACRO.VERSION}`
}

export type AuthHeaders = {
  headers: Record<string, string>
  error?: string
}

/**
 * Hosted telemetry endpoints are not authenticated by the model provider key.
 */
export function getAuthHeaders(): AuthHeaders {
  return {
    headers: {},
    error: 'No hosted service credentials are configured',
  }
}

/** Execute an API-key-authenticated request. */
export async function withAuthRequest<T>(
  request: () => Promise<T>,
  _opts?: { also403Revoked?: boolean },
): Promise<T> {
  return request()
}
