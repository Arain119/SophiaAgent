/**
 * Shared utilities for OpenAI-compatible API paths.
 *
 * Shared by OpenAI API-key, subscription, and compatible-endpoint paths.
 *
 * Keep this module free of bootstrap/state imports so pure request-body unit
 * tests and isolated mocks do not need a full session runtime.
 */

import { createHash } from 'node:crypto'

const MAX_PROMPT_CACHE_KEY_LENGTH = 64
const MAX_MODEL_CACHE_SEGMENT_LENGTH = 24

/**
 * Build a stable OpenAI `prompt_cache_key` for a session.
 *
 * OpenAI automatic prefix caching benefits from routing sticky keys so multi-turn
 * requests land on the same cache-bearing compute node. The key must be stable
 * for the whole conversation — never derived from full message bodies (that
 * changes every turn and defeats routing).
 *
 * Compatible gateways commonly cap this field at 64 characters. Hash the
 * session ID rather than appending a UUID verbatim while retaining readable
 * model and provider isolation in the key.
 */
function hashCacheScope(scope: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < scope.length; index += 1) {
    hash ^= scope.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function formatModelCacheSegment(model: string): string {
  if (model.length <= MAX_MODEL_CACHE_SEGMENT_LENGTH) return model
  const hash = hashCacheScope(model)
  return `${model.slice(0, MAX_MODEL_CACHE_SEGMENT_LENGTH - hash.length - 1)}-${hash}`
}

export function formatOpenAIPromptCacheKey(
  sessionId: string,
  model = 'unknown',
  providerScope = process.env.OPENAI_BASE_URL ?? '',
): string {
  const sessionHash = createHash('sha256')
    .update(sessionId)
    .digest('hex')
    .slice(0, 20)
  const key = `sophia:v1:${formatModelCacheSegment(model)}:${hashCacheScope(providerScope)}:${sessionHash}`
  return key.slice(0, MAX_PROMPT_CACHE_KEY_LENGTH)
}

/**
 * Merge a delta usage into the accumulated usage, preserving cache-related
 * fields from previous values when the delta carries explicit zeroes or
 * undefined values.
 *
 * Mirrors updateUsage() in claude.ts: a future adapter change that omits
 * cache fields from certain streaming events should not silently zero the
 * accumulated counters.
 */
export function updateOpenAIUsage(
  current: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  },
  delta: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  },
): typeof current {
  return {
    input_tokens: delta.input_tokens ?? current.input_tokens,
    output_tokens: delta.output_tokens ?? current.output_tokens,
    cache_creation_input_tokens:
      delta.cache_creation_input_tokens !== undefined &&
      delta.cache_creation_input_tokens > 0
        ? delta.cache_creation_input_tokens
        : current.cache_creation_input_tokens,
    cache_read_input_tokens:
      delta.cache_read_input_tokens !== undefined &&
      delta.cache_read_input_tokens > 0
        ? delta.cache_read_input_tokens
        : current.cache_read_input_tokens,
  }
}
