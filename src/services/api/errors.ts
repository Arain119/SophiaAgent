import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from '@anthropic-ai/sdk'
import type { SDKAssistantMessageError } from '../../entrypoints/agentSdkTypes.js'
import type { AssistantMessage } from '../../types/message.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import {
  API_PDF_MAX_PAGES,
  PDF_TARGET_RAW_SIZE,
} from '../../constants/apiLimits.js'
import { formatFileSize } from '../../utils/format.js'

export const API_ERROR_MESSAGE_PREFIX = 'API Error'
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'
export const INVALID_API_KEY_ERROR_MESSAGE = 'API key missing. Run /model.'
export const INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL =
  'Invalid provider API key. Run /model.'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY =
  'The provider rejected this account.'
export const REPEATED_529_ERROR_MESSAGE = 'Repeated 529 Overloaded errors'
export const API_TIMEOUT_ERROR_MESSAGE = 'Request timed out'

export function startsWithApiErrorPrefix(text: string): boolean {
  return text.startsWith(API_ERROR_MESSAGE_PREFIX)
}

export function isPromptTooLongMessage(message: AssistantMessage): boolean {
  if (!message.isApiErrorMessage || !Array.isArray(message.message.content)) {
    return false
  }
  return message.message.content.some(
    block =>
      block.type === 'text' &&
      block.text.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE),
  )
}

export function parsePromptTooLongTokenCounts(rawMessage: string): {
  actualTokens: number | undefined
  limitTokens: number | undefined
} {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  )
  return {
    actualTokens: match ? Number.parseInt(match[1]!, 10) : undefined,
    limitTokens: match ? Number.parseInt(match[2]!, 10) : undefined,
  }
}

export function getPromptTooLongTokenGap(
  message: AssistantMessage,
): number | undefined {
  if (!isPromptTooLongMessage(message) || !message.errorDetails) {
    return undefined
  }
  const { actualTokens, limitTokens } = parsePromptTooLongTokenCounts(
    message.errorDetails as string,
  )
  if (actualTokens === undefined || limitTokens === undefined) return undefined
  const gap = actualTokens - limitTokens
  return gap > 0 ? gap : undefined
}

function isMediaSizeError(raw: string): boolean {
  return (
    (raw.includes('image exceeds') && raw.includes('maximum')) ||
    (raw.includes('image dimensions exceed') && raw.includes('many-image')) ||
    /maximum of \d+ PDF pages/.test(raw)
  )
}

export function isMediaSizeErrorMessage(message: AssistantMessage): boolean {
  return (
    message.isApiErrorMessage === true &&
    typeof message.errorDetails === 'string' &&
    isMediaSizeError(message.errorDetails)
  )
}

export function getPdfTooLargeErrorMessage(): string {
  const limits = `max ${API_PDF_MAX_PAGES} pages, ${formatFileSize(PDF_TARGET_RAW_SIZE)}`
  return getIsNonInteractiveSession()
    ? `PDF too large (${limits}). Extract its text or use a smaller file.`
    : `PDF too large (${limits}). Go back and use a smaller file or extract its text.`
}

export function getPdfPasswordProtectedErrorMessage(): string {
  return 'PDF is password protected. Unlock it or extract its text first.'
}

export function getPdfInvalidErrorMessage(): string {
  return 'The PDF is invalid. Convert it to text or use another file.'
}

export function getImageTooLargeErrorMessage(): string {
  return 'Image is too large. Resize it and try again.'
}

export function getRequestTooLargeErrorMessage(): string {
  return `Request too large (max ${formatFileSize(PDF_TARGET_RAW_SIZE)}). Use a smaller file.`
}

function getStatus(error: unknown): number | undefined {
  if (error instanceof APIError) return error.status
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined
  }
  return typeof error.status === 'number' ? error.status : undefined
}

export function classifyAPIError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const message = error.message.toLowerCase()
  if (message === 'request was aborted.') return 'aborted'
  if (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof APIConnectionError && message.includes('timeout'))
  ) {
    return 'api_timeout'
  }
  if (message.includes(REPEATED_529_ERROR_MESSAGE.toLowerCase())) {
    return 'server_overload'
  }

  const status = getStatus(error)
  if (status === 429) return 'rate_limit'
  if (status === 529 || status === 503) return 'server_overload'
  if (status === 401 || status === 403) return 'authentication_failed'
  if (message.includes(PROMPT_TOO_LONG_ERROR_MESSAGE.toLowerCase())) {
    return 'prompt_too_long'
  }
  if (/maximum of \d+ pdf pages/.test(message)) return 'pdf_too_large'
  if (message.includes('password protected')) return 'pdf_password_protected'
  if (isMediaSizeError(message)) return 'image_too_large'
  if (status !== undefined && status >= 500) return 'server_error'
  if (error instanceof APIConnectionError) return 'connection_error'
  return 'unknown'
}

export function categorizeRetryableAPIError(
  error: APIError,
): SDKAssistantMessageError {
  if (error.status === 429 || error.status === 529) return 'rate_limit'
  if (error.status === 401 || error.status === 403) {
    return 'authentication_failed'
  }
  if (error.status !== undefined && error.status >= 408) return 'server_error'
  return 'unknown'
}
