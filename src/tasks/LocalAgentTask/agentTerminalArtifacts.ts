import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { AgentToolResult } from '@sophia-agent/builtin-tools/tools/AgentTool/agentToolUtils.js'
import { extractTextContent } from '../../utils/messages.js'
import {
  getTaskOutputDir,
  getTaskOutputPath,
} from '../../utils/task/diskOutput.js'
import { getSessionId } from '../../bootstrap/state.js'
import type { ContentItem, Message } from '../../types/message.js'

const MAX_OUTCOME_CHARS = 1200
const MAX_MEMORY_ITEMS = 8
const MAX_MEMORY_ITEM_CHARS = 320
const MAX_LEDGER_MEMORIES = 64

export type AgentTerminalMemory = {
  outcome: string
  decisions: string[]
  evidence: string[]
  verification: string[]
  remainingWork: string[]
}

export type AgentRunLedger = {
  taskId: string
  agentType: string
  description: string
  prompt?: string
  toolUseId?: string
  parentId?: string
  model?: string
  provider?: string
  effort?: string
  isExactContext: boolean
  status: 'running' | 'completed' | 'failed' | 'killed'
  startTime: number
  endTime?: number
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  cacheHitRate?: number
  toolUses?: number
  terminalMemory?: AgentTerminalMemory
  resultFile?: string
  resultIndexFile?: string
  consumedAt?: number
}

export function buildFailedAgentTerminalMemory(
  error: string,
  messages: Message[],
): AgentTerminalMemory {
  const assistantTexts: string[] = []
  const toolNames: string[] = []
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const blocks = (message.message?.content ?? []) as ContentItem[]
    const text = blocks
      .filter(
        (block): block is Extract<ContentItem, { type: 'text' }> =>
          block.type === 'text',
      )
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text && !message.isApiErrorMessage) assistantTexts.push(text)
    for (const block of blocks) {
      if (block.type === 'tool_use' && !toolNames.includes(block.name)) {
        toolNames.push(block.name)
      }
    }
  }

  const partial = assistantTexts.at(-1)
  return {
    outcome: partial
      ? compact(
          `Partial progress before failure: ${partial}`,
          MAX_OUTCOME_CHARS,
        )
      : compact(
          `Agent task failed before producing a confirmed result: ${error}`,
          MAX_OUTCOME_CHARS,
        ),
    decisions: [],
    evidence: [
      ...(partial ? [compact(partial)] : []),
      ...(toolNames.length > 0
        ? [`Executed tools before failure: ${toolNames.join(', ')}`]
        : []),
      `Failure: ${compact(error)}`,
    ],
    verification: [],
    remainingWork: [
      'The task is incomplete. Verify the partial progress and resume from the failure point.',
    ],
  }
}

export type AgentResultIndex = {
  version: 1
  taskId: string
  resultFile: string
  charCount: number
  lineCount: number
  sections: Array<{
    heading: string
    startLine: number
    endLine: number
    excerpt: string
  }>
}

export type AgentResultRetrieval = {
  content: string
  mode: 'full' | 'section' | 'query'
  matchedSections: string[]
  matchedLines: number[]
}

const terminalMemories = new Map<string, Map<string, AgentTerminalMemory>>()
let ledgerWriteChain: Promise<void> = Promise.resolve()

function compact(value: string, limit = MAX_MEMORY_ITEM_CHARS): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 3)}...`
}

function collectSectionItems(
  sections: Map<string, string[]>,
  patterns: RegExp[],
): string[] {
  const items: string[] = []
  for (const [heading, lines] of sections) {
    if (!patterns.some(pattern => pattern.test(heading))) continue
    for (const line of lines) {
      const item = compact(line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ''))
      if (item && !items.includes(item)) items.push(item)
      if (items.length >= MAX_MEMORY_ITEMS) return items
    }
  }
  return items
}

export function buildAgentTerminalMemory(text: string): AgentTerminalMemory {
  const sections = new Map<string, string[]>()
  let heading = 'summary'
  sections.set(heading, [])
  for (const rawLine of text.split(/\r?\n/)) {
    const headingMatch = rawLine.match(/^#{1,6}\s+(.+)$/)
    if (headingMatch) {
      heading = headingMatch[1]!.trim().toLowerCase()
      if (!sections.has(heading)) sections.set(heading, [])
      continue
    }
    const line = rawLine.trim()
    if (line) sections.get(heading)!.push(line)
  }

  const outcomeLines = collectSectionItems(sections, [
    /summary|result|outcome|completed|结论|结果|完成/,
  ])
  const fallback = compact(text, MAX_OUTCOME_CHARS)
  return {
    outcome: compact(outcomeLines.join(' ') || fallback, MAX_OUTCOME_CHARS),
    decisions: collectSectionItems(sections, [/decision|choice|决定|决策/]),
    evidence: collectSectionItems(sections, [
      /evidence|finding|file|证据|发现|文件/,
    ]),
    verification: collectSectionItems(sections, [
      /verification|validation|test|check|验证|测试|检查/,
    ]),
    remainingWork: collectSectionItems(sections, [
      /remaining|next|blocker|todo|后续|下一步|阻塞|待办/,
    ]),
  }
}

export function getTaskResultPath(taskId: string): string {
  return `${getTaskOutputPath(taskId)}.result.txt`
}

export function getTaskResultIndexPath(taskId: string): string {
  return `${getTaskOutputPath(taskId)}.index.json`
}

export function buildAgentResultIndex(
  taskId: string,
  text: string,
): AgentResultIndex {
  const lines = text.split(/\r?\n/)
  const headings: Array<{ heading: string; line: number }> = []
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]!.match(/^#{1,6}\s+(.+)$/)
    if (match)
      headings.push({ heading: compact(match[1]!, 120), line: index + 1 })
  }
  if (headings.length === 0) {
    for (let line = 1; line <= lines.length; line += 200) {
      headings.push({
        heading: `Lines ${line}-${Math.min(line + 199, lines.length)}`,
        line,
      })
    }
  }

  const resultFile = getTaskResultPath(taskId)
  return {
    version: 1,
    taskId,
    resultFile,
    charCount: text.length,
    lineCount: lines.length,
    sections: headings.map((item, index) => {
      const endLine = (headings[index + 1]?.line ?? lines.length + 1) - 1
      const excerpt = lines
        .slice(item.line, Math.min(endLine, item.line + 4))
        .join(' ')
      return {
        heading: item.heading,
        startLine: item.line,
        endLine,
        excerpt: compact(excerpt, 240),
      }
    }),
  }
}

export async function persistAgentTerminalArtifacts(
  taskId: string,
  text: string,
): Promise<{ resultFile: string; resultIndexFile: string }> {
  const resultFile = getTaskResultPath(taskId)
  const resultIndexFile = getTaskResultIndexPath(taskId)
  await mkdir(dirname(resultFile), { recursive: true })
  await Promise.all([
    writeFile(resultFile, text, 'utf8'),
    writeFile(
      resultIndexFile,
      `${JSON.stringify(buildAgentResultIndex(taskId, text), null, 2)}\n`,
      'utf8',
    ),
  ])
  return { resultFile, resultIndexFile }
}

export function getAgentRunLedgerPath(): string {
  return join(getTaskOutputDir(), 'agent-runs.jsonl')
}

export async function appendAgentRunLedger(
  entry: AgentRunLedger,
): Promise<void> {
  const ledgerPath = getAgentRunLedgerPath()
  ledgerWriteChain = ledgerWriteChain
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(ledgerPath), { recursive: true })
      await appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8')
    })
  return ledgerWriteChain
}

function isAgentRunLedger(value: unknown): value is AgentRunLedger {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.taskId === 'string' &&
    typeof candidate.agentType === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.startTime === 'number' &&
    ['running', 'completed', 'failed', 'killed'].includes(
      String(candidate.status),
    )
  )
}

export async function loadLatestAgentRunLedgers(): Promise<AgentRunLedger[]> {
  let content: string
  try {
    content = await readFile(getAgentRunLedgerPath(), 'utf8')
  } catch {
    return []
  }
  return parseLatestAgentRunLedgers(content)
}

export function parseLatestAgentRunLedgers(content: string): AgentRunLedger[] {
  const latest = new Map<string, AgentRunLedger>()
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isAgentRunLedger(parsed)) latest.set(parsed.taskId, parsed)
    } catch {
      // Ignore a partial final append; earlier complete records remain usable.
    }
  }
  return [...latest.values()]
}

export function createCompletedRunLedger(
  task: Omit<AgentRunLedger, 'status'>,
  result: AgentToolResult,
  terminalMemory: AgentTerminalMemory,
): AgentRunLedger {
  const usage = result.usage ?? {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const inputTokens = usage.input_tokens ?? 0
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const denominator = inputTokens + cacheCreationTokens + cacheReadTokens
  return {
    ...task,
    status: 'completed',
    endTime: Date.now(),
    durationMs: result.totalDurationMs,
    inputTokens,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationTokens,
    cacheReadTokens,
    cacheHitRate: denominator > 0 ? cacheReadTokens / denominator : 0,
    toolUses: result.totalToolUseCount,
    terminalMemory,
    resultFile: getTaskResultPath(task.taskId),
    resultIndexFile: getTaskResultIndexPath(task.taskId),
  }
}

export function recordTerminalMemory(
  taskId: string,
  memory: AgentTerminalMemory,
): void {
  const sessionId = getSessionId()
  const sessionMemories = terminalMemories.get(sessionId) ?? new Map()
  terminalMemories.set(sessionId, sessionMemories)
  sessionMemories.delete(taskId)
  sessionMemories.set(taskId, memory)
  while (sessionMemories.size > MAX_LEDGER_MEMORIES) {
    const oldest = sessionMemories.keys().next().value
    if (oldest === undefined) break
    sessionMemories.delete(oldest)
  }
}

export function getRecordedTerminalMemories(): Array<{
  taskId: string
  memory: AgentTerminalMemory
}> {
  return [...(terminalMemories.get(getSessionId()) ?? new Map())].map(
    ([taskId, memory]) => ({ taskId, memory }),
  )
}

export function getAgentResultText(result: AgentToolResult): string {
  return extractTextContent(result.content, '\n')
}

function isResultIndex(value: unknown): value is AgentResultIndex {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1 &&
    typeof candidate.resultFile === 'string' &&
    Array.isArray(candidate.sections)
  )
}

function limitResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n\n[retrieval truncated at ${maxChars} characters]`
}

export async function retrieveAgentResult(
  taskId: string,
  options: { section?: string; query?: string; maxChars?: number } = {},
): Promise<AgentResultRetrieval | undefined> {
  const resultFile = getTaskResultPath(taskId)
  const indexFile = getTaskResultIndexPath(taskId)
  let text: string
  try {
    text = await readFile(resultFile, 'utf8')
  } catch {
    return undefined
  }

  const maxChars = Math.max(500, Math.min(options.maxChars ?? 20_000, 100_000))
  const lines = text.split(/\r?\n/)
  let index: AgentResultIndex | undefined
  try {
    const parsed: unknown = JSON.parse(await readFile(indexFile, 'utf8'))
    if (isResultIndex(parsed)) index = parsed
  } catch {
    // A result file remains useful even if its optional index is damaged.
  }

  if (options.section?.trim() && index) {
    const needle = options.section.trim().toLowerCase()
    const sections = index.sections.filter(section =>
      section.heading.toLowerCase().includes(needle),
    )
    if (sections.length > 0) {
      const start = Math.max(
        1,
        Math.min(...sections.map(section => section.startLine)),
      )
      const end = Math.min(
        lines.length,
        Math.max(...sections.map(section => section.endLine)),
      )
      return {
        content: limitResult(lines.slice(start - 1, end).join('\n'), maxChars),
        mode: 'section',
        matchedSections: sections.map(section => section.heading),
        matchedLines: [start, end],
      }
    }
    if (!options.query?.trim()) {
      return {
        content: `No result section matched heading: ${options.section}`,
        mode: 'section',
        matchedSections: [],
        matchedLines: [],
      }
    }
  }

  if (options.query?.trim()) {
    const needle = options.query.trim().toLowerCase()
    const matchedLines: number[] = []
    const ranges: Array<[number, number]> = []
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]!.toLowerCase().includes(needle)) continue
      matchedLines.push(index + 1)
      const start = Math.max(0, index - 2)
      const end = Math.min(lines.length, index + 3)
      if (!ranges.some(([left, right]) => start <= right && end >= left)) {
        ranges.push([start, end])
      }
    }
    const content = ranges
      .map(([start, end]) => lines.slice(start, end).join('\n'))
      .join('\n...\n')
    return {
      content: limitResult(
        content || `No result lines matched query: ${options.query}`,
        maxChars,
      ),
      mode: 'query',
      matchedSections:
        index?.sections
          .filter(section =>
            matchedLines.some(
              line => line >= section.startLine && line <= section.endLine,
            ),
          )
          .map(section => section.heading) ?? [],
      matchedLines,
    }
  }

  return {
    content: limitResult(text, maxChars),
    mode: 'full',
    matchedSections: [],
    matchedLines: [],
  }
}

export function resetAgentTerminalArtifactsForTest(): void {
  terminalMemories.clear()
}
