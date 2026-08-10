import { getSessionId } from '../bootstrap/state.js'
import type { AgentTerminalMemory } from './LocalAgentTask/agentTerminalArtifacts.js'
import type {
  AssistantMessage,
  ContentItem,
  Message,
  UserMessage,
} from '../types/message.js'

const MAX_NODES = 128
const MAX_FACTS = 256
const MAX_TEXT = 480

export type WorkNodeStatus = 'active' | 'completed' | 'failed' | 'killed'

export type WorkNode = {
  id: string
  parentId?: string
  toolUseId?: string
  goal: string
  owner: string
  status: WorkNodeStatus
  openedAt: number
  openedAtInputTokens?: number
  closedAt?: number
  currentInputTokens?: number
  contextTokens?: number
  fileClaims: Array<{ path: string; access: 'read' | 'write' }>
  terminalMemory?: AgentTerminalMemory
}

export type BlackboardFact = {
  key: string
  value: string
  evidence: string[]
  authorNodeId: string
  updatedAt: number
}

type WorkSession = {
  nodes: Map<string, WorkNode>
  facts: Map<string, BlackboardFact>
}

const sessions = new Map<string, WorkSession>()

function currentSession(): WorkSession {
  const sessionId = getSessionId()
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const created = { nodes: new Map(), facts: new Map() }
  sessions.set(sessionId, created)
  return created
}

function compact(value: string, limit = MAX_TEXT): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 3)}...`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function openWorkNode(input: {
  id: string
  parentId?: string
  toolUseId?: string
  goal: string
  owner: string
  openedAtInputTokens?: number
}): WorkNode {
  const session = currentSession()
  const node: WorkNode = {
    ...input,
    goal: compact(input.goal),
    status: 'active',
    openedAt: Date.now(),
    fileClaims: [],
  }
  session.nodes.delete(node.id)
  session.nodes.set(node.id, node)
  while (session.nodes.size > MAX_NODES) {
    const oldest = session.nodes.keys().next().value
    if (oldest === undefined) break
    session.nodes.delete(oldest)
  }
  return node
}

export function recordWorkNodeMessage(id: string, message: Message): void {
  if (message.type !== 'assistant') return
  const session = currentSession()
  const node = session.nodes.get(id)
  if (!node) return
  const additions: Array<{ path: string; access: 'read' | 'write' }> = []
  for (const block of (message.message?.content ?? []) as ContentItem[]) {
    if (block.type !== 'tool_use') continue
    const toolName = block.name.toLowerCase()
    const access = /edit|write|notebook/.test(toolName)
      ? 'write'
      : /read|grep|glob/.test(toolName)
        ? 'read'
        : undefined
    if (!access || !block.input || typeof block.input !== 'object') continue
    const input = block.input as Record<string, unknown>
    const path =
      typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
          ? input.path
          : undefined
    if (!path) continue
    additions.push({ path: compact(path, 320), access })
  }
  if (additions.length === 0) return
  const claims = new Map(
    node.fileClaims.map(claim => [`${claim.access}:${claim.path}`, claim]),
  )
  for (const claim of additions) {
    claims.set(`${claim.access}:${claim.path}`, claim)
  }
  session.nodes.set(id, {
    ...node,
    fileClaims: [...claims.values()].slice(-32),
  })
}

function factKey(value: string): string {
  return compact(value, 160).toLowerCase()
}

function addFactsFromMemory(node: WorkNode, memory: AgentTerminalMemory): void {
  const session = currentSession()
  const candidates = [
    ...memory.decisions.map(value => ({ value, evidence: memory.evidence })),
    ...memory.evidence.map(value => ({ value, evidence: [value] })),
    ...memory.verification.map(value => ({ value, evidence: [value] })),
  ]
  for (const candidate of candidates) {
    const value = compact(candidate.value)
    if (!value) continue
    const key = factKey(value)
    session.facts.delete(key)
    session.facts.set(key, {
      key,
      value,
      evidence: candidate.evidence.map(item => compact(item, 240)).slice(0, 6),
      authorNodeId: node.id,
      updatedAt: Date.now(),
    })
  }
  while (session.facts.size > MAX_FACTS) {
    const oldest = session.facts.keys().next().value
    if (oldest === undefined) break
    session.facts.delete(oldest)
  }
}

export function closeWorkNode(
  id: string,
  status: Exclude<WorkNodeStatus, 'active'>,
  terminalMemory: AgentTerminalMemory,
): WorkNode | undefined {
  const session = currentSession()
  const existing = session.nodes.get(id)
  if (!existing) return undefined
  const node: WorkNode = {
    ...existing,
    status,
    closedAt: Date.now(),
    terminalMemory,
  }
  session.nodes.set(id, node)
  addFactsFromMemory(node, terminalMemory)
  return node
}

export function recordWorkNodeInputTokens(
  id: string,
  currentInputTokens: number,
): void {
  const session = currentSession()
  const node = session.nodes.get(id)
  if (!node) return
  const openedAtInputTokens = node.openedAtInputTokens ?? currentInputTokens
  session.nodes.set(id, {
    ...node,
    openedAtInputTokens,
    currentInputTokens,
    contextTokens: Math.max(0, currentInputTokens - openedAtInputTokens),
  })
}

export function getWorkNodes(): WorkNode[] {
  return [...currentSession().nodes.values()]
}

export function getWorkNodeByToolUseId(
  toolUseId: string,
): WorkNode | undefined {
  return getWorkNodes().find(node => node.toolUseId === toolUseId)
}

export function getWorkNode(id: string): WorkNode | undefined {
  return currentSession().nodes.get(id)
}

export function getBlackboardFacts(): BlackboardFact[] {
  return [...currentSession().facts.values()]
}

export function renderBlackboardContext(limit = 24): string | undefined {
  const facts = getBlackboardFacts().slice(-limit)
  const active = getWorkNodes().filter(node => node.status === 'active')
  if (facts.length === 0 && active.length === 0) return undefined
  const factSection = facts.length
    ? `<confirmed_facts>\n${facts
        .map(
          fact =>
            `- ${escapeXml(fact.value)}${fact.evidence[0] ? ` [evidence: ${escapeXml(fact.evidence[0])}]` : ''}`,
        )
        .join('\n')}\n</confirmed_facts>`
    : ''
  const activeSection = active.length
    ? `<active_work_nodes>\n${active
        .map(node => {
          const files = node.fileClaims
            .map(claim => `${claim.access}:${escapeXml(claim.path)}`)
            .join(', ')
          return `- id=${escapeXml(node.id)} owner=${escapeXml(node.owner)}${node.parentId ? ` parent=${escapeXml(node.parentId)}` : ''} goal=${escapeXml(node.goal)}${files ? ` files=[${files}]` : ''}`
        })
        .join('\n')}\n</active_work_nodes>`
    : ''
  return `<shared_task_blackboard>\n${[activeSection, factSection].filter(Boolean).join('\n')}\n</shared_task_blackboard>`
}

export function renderCompletedWorkNode(node: WorkNode): string | undefined {
  const memory = node.terminalMemory
  if (!memory || node.status === 'active') return undefined
  const section = (name: string, values: string[]) =>
    values.length
      ? `<${name}>${values.map(escapeXml).join(' | ')}</${name}>`
      : ''
  return `<completed_work_node id="${escapeXml(node.id)}" status="${node.status}">
<goal>${escapeXml(node.goal)}</goal>
<outcome>${escapeXml(memory.outcome)}</outcome>
${section('decisions', memory.decisions)}
${section('evidence', memory.evidence)}
${section('verification', memory.verification)}
${section('remaining_work', memory.remainingWork)}
</completed_work_node>`
}

export function projectCompletedWorkNodes(
  messages: Array<UserMessage | AssistantMessage>,
): Array<UserMessage | AssistantMessage> {
  const replacements = new Map<string, string>()
  for (const node of getWorkNodes()) {
    if (!node.toolUseId) continue
    const rendered = renderCompletedWorkNode(node)
    if (rendered) replacements.set(node.toolUseId, rendered)
  }
  if (replacements.size === 0) return messages

  return messages.map(message => {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      return message
    }
    let changed = false
    const origin = message.origin as Record<string, unknown> | undefined
    const isTaskNotification = origin?.kind === 'task-notification'
    const content = message.message.content.map(block => {
      if (block.type === 'tool_result') {
        const node = getWorkNodeByToolUseId(block.tool_use_id)
        const replacement = replacements.get(block.tool_use_id)
        if (!node || !replacement) return block
        changed = true
        return {
          ...block,
          content: replacement,
          is_error: node.status !== 'completed',
        }
      }
      if (block.type === 'text' && isTaskNotification) {
        const taskId = block.text.match(
          /<task[-_]id>([^<]+)<\/task[-_]id>/,
        )?.[1]
        if (!taskId) return block
        const node = currentSession().nodes.get(taskId)
        if (!node) return block
        const replacement = renderCompletedWorkNode(node)
        if (!replacement) return block
        changed = true
        return { ...block, text: replacement }
      }
      return block
    })
    return changed
      ? { ...message, message: { ...message.message, content } }
      : message
  })
}

export function resetWorkNodesForTest(): void {
  sessions.clear()
}
