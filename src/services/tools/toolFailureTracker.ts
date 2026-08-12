import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

const DEFAULT_MAX_ENTRIES = 128
type FailureEntry = { count: number; targetKey: string }

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key]) => !/^(_|toolUseId|requestId|timestamp|timeout)$/i.test(key),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

function normalizeFailureText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<address>')
    .replace(/\b\d{4}-\d{2}-\d{2}[t ][0-9:.+-z]+\b/gi, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|seconds?|minutes?)\b/gi, '<duration>')
    .replace(/\\/g, '/')
    .replace(/:\d+(?::\d+)?\b/g, ':<line>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000)
}

function resultText(block: ToolResultBlockParam): string {
  if (typeof block.content === 'string') return block.content
  return (block.content ?? [])
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}

function appendText(
  block: ToolResultBlockParam,
  instruction: string,
): ToolResultBlockParam {
  if (typeof block.content === 'string')
    return { ...block, content: `${block.content}\n\n${instruction}` }
  return {
    ...block,
    content: [...(block.content ?? []), { type: 'text', text: instruction }],
  }
}

export class ToolFailureTracker {
  private readonly failures = new Map<string, FailureEntry>()
  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  observe(
    toolName: string,
    input: unknown,
    block: ToolResultBlockParam,
  ): ToolResultBlockParam {
    const targetKey = `${toolName}:${JSON.stringify(stableValue(input))}`
    if (block.is_error !== true) {
      for (const [fingerprint, entry] of this.failures)
        if (entry.targetKey === targetKey) this.failures.delete(fingerprint)
      return block
    }
    const fingerprint = `${targetKey}:${normalizeFailureText(resultText(block))}`
    const count = (this.failures.get(fingerprint)?.count ?? 0) + 1
    this.failures.delete(fingerprint)
    this.failures.set(fingerprint, { count, targetKey })
    while (this.failures.size > this.maxEntries) {
      const oldest = this.failures.keys().next().value
      if (oldest === undefined) break
      this.failures.delete(oldest)
    }
    if (count === 2)
      return appendText(
        block,
        '<system-reminder>This failure has repeated. Change the approach before trying again.</system-reminder>',
      )
    if (count >= 3)
      return appendText(
        block,
        '<system-reminder>This failure has repeated three or more times. Stop retrying the same operation; report the blocker or choose a materially different approach.</system-reminder>',
      )
    return block
  }

  reset(): void {
    this.failures.clear()
  }
  size(): number {
    return this.failures.size
  }
}

export const toolFailureTracker = new ToolFailureTracker()
