import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import { jsonStringify } from '../slowOperations.js'
import {
  getAgentId,
  getAgentName,
  getTeammateColor,
  getTeamName,
} from '../teammate.js'
import {
  createSandboxPermissionRequestMessage,
  createSandboxPermissionResponseMessage,
  writeToMailbox,
} from '../teammateMailbox.js'
import { readTeamFileAsync } from './teamHelpers.js'

export function isSwarmWorker(): boolean {
  return Boolean(getTeamName() && getAgentId() && getAgentName())
}

async function getLeaderName(teamName?: string): Promise<string | null> {
  const team = teamName || getTeamName()
  if (!team) return null

  try {
    const config = await readTeamFileAsync(team)
    if (!config) return null
    const leader = config.members.find(
      member => member.agentId === config.leadAgentId,
    )
    return leader?.name ?? 'team-lead'
  } catch (error) {
    logError(error)
    return null
  }
}

export function generateSandboxRequestId(): string {
  return `sandbox-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export async function sendSandboxPermissionRequestViaMailbox(
  host: string,
  requestId: string,
  teamName?: string,
): Promise<boolean> {
  const team = teamName || getTeamName()
  if (!team) return false

  const leaderName = await getLeaderName(team)
  const workerId = getAgentId()
  const workerName = getAgentName()
  if (!leaderName || !workerId || !workerName) return false

  try {
    const workerColor = getTeammateColor()
    const message = createSandboxPermissionRequestMessage({
      requestId,
      workerId,
      workerName,
      workerColor,
      host,
    })
    await writeToMailbox(
      leaderName,
      {
        from: workerName,
        text: jsonStringify(message),
        timestamp: new Date().toISOString(),
        color: workerColor,
      },
      team,
    )
    return true
  } catch (error) {
    logForDebugging(
      `[SandboxSync] Failed to send network request: ${String(error)}`,
    )
    logError(error)
    return false
  }
}

export async function sendSandboxPermissionResponseViaMailbox(
  workerName: string,
  requestId: string,
  host: string,
  allow: boolean,
  teamName?: string,
): Promise<boolean> {
  const team = teamName || getTeamName()
  if (!team) return false

  try {
    const message = createSandboxPermissionResponseMessage({
      requestId,
      host,
      allow,
    })
    await writeToMailbox(
      workerName,
      {
        from: getAgentName() || 'team-lead',
        text: jsonStringify(message),
        timestamp: new Date().toISOString(),
      },
      team,
    )
    return true
  } catch (error) {
    logForDebugging(
      `[SandboxSync] Failed to send network response: ${String(error)}`,
    )
    logError(error)
    return false
  }
}
