const activeTaskByFingerprint = new Map<string, string>()
const fingerprintByTaskId = new Map<string, string>()

function normalizeTaskPrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function getAgentTaskFingerprint(
  agentType: string,
  prompt: string,
): string {
  return `${agentType.trim().toLowerCase()}\n${normalizeTaskPrompt(prompt)}`
}

export function reserveActiveAgentTask(
  agentId: string,
  agentType: string,
  prompt: string,
): string | undefined {
  const fingerprint = getAgentTaskFingerprint(agentType, prompt)
  const existingTaskId = activeTaskByFingerprint.get(fingerprint)
  if (existingTaskId) {
    return existingTaskId
  }

  activeTaskByFingerprint.set(fingerprint, agentId)
  fingerprintByTaskId.set(agentId, fingerprint)
  return undefined
}

export function releaseActiveAgentTask(agentId: string): void {
  const fingerprint = fingerprintByTaskId.get(agentId)
  if (!fingerprint) {
    return
  }

  if (activeTaskByFingerprint.get(fingerprint) === agentId) {
    activeTaskByFingerprint.delete(fingerprint)
  }
  fingerprintByTaskId.delete(agentId)
}

export function resetActiveAgentTasksForTest(): void {
  activeTaskByFingerprint.clear()
  fingerprintByTaskId.clear()
}
