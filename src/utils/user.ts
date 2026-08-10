import memoize from 'lodash-es/memoize.js'
import { execa } from 'execa'
import { getSessionId } from '../bootstrap/state.js'
import { getOrCreateUserID } from './config.js'
import { getCwd } from './cwd.js'
import { type env, getHostPlatformForAnalytics } from './env.js'
import { isEnvTruthy } from './envUtils.js'

export type GitHubActionsMetadata = {
  actor?: string
  actorId?: string
  repository?: string
  repositoryId?: string
  repositoryOwner?: string
  repositoryOwnerId?: string
}

export type CoreUserData = {
  deviceId: string
  sessionId: string
  appVersion: string
  platform: typeof env.platform
  githubActionsMetadata?: GitHubActionsMetadata
}

export async function initUser(): Promise<void> {}

export function resetUserCache(): void {
  getCoreUserData.cache.clear?.()
}

export const getCoreUserData = memoize(
  (_includeAnalyticsMetadata?: boolean): CoreUserData => ({
    deviceId: getOrCreateUserID(),
    sessionId: getSessionId(),
    appVersion: MACRO.VERSION,
    platform: getHostPlatformForAnalytics(),
    ...(isEnvTruthy(process.env.GITHUB_ACTIONS) && {
      githubActionsMetadata: {
        actor: process.env.GITHUB_ACTOR,
        actorId: process.env.GITHUB_ACTOR_ID,
        repository: process.env.GITHUB_REPOSITORY,
        repositoryId: process.env.GITHUB_REPOSITORY_ID,
        repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER,
        repositoryOwnerId: process.env.GITHUB_REPOSITORY_OWNER_ID,
      },
    }),
  }),
)

export function getUserForGrowthBook(): CoreUserData {
  return getCoreUserData(true)
}

export const getGitEmail = memoize(async (): Promise<string | undefined> => {
  const result = await execa('git config --get user.email', {
    shell: true,
    reject: false,
    cwd: getCwd(),
  })
  return result.exitCode === 0 && result.stdout
    ? result.stdout.trim()
    : undefined
})
