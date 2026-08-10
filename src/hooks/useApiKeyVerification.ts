import { useCallback } from 'react'

export type VerificationStatus =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'missing'
  | 'error'

export type ApiKeyVerificationResult = {
  status: VerificationStatus
  reverify: () => Promise<void>
  error: Error | null
}

/**
 * Provider profiles own API credentials. Request failures are reported by the
 * Responses adapter, so the REPL no longer performs an Anthropic auth probe.
 */
export function useApiKeyVerification(): ApiKeyVerificationResult {
  const reverify = useCallback(async (): Promise<void> => {}, [])
  return { status: 'valid', reverify, error: null }
}
