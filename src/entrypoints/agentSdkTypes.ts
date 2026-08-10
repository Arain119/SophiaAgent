/** Shared internal SDK-shaped types used by the CLI and hook pipeline. */

export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'
export * from './sdk/coreTypes.js'
export * from './sdk/runtimeTypes.js'

import type { SDKSessionInfo } from './sdk/coreTypes.js'
import type {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  ListSessionsOptions,
  SessionMutationOptions,
} from './sdk/runtimeTypes.js'
import { EXIT_REASONS, HOOK_EVENTS } from './sdk/coreSchemas.js'

export type {
  ListSessionsOptions,
  GetSessionInfoOptions,
  SessionMutationOptions,
  ForkSessionOptions,
  ForkSessionResult,
  SDKSessionInfo,
}

export type CronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
}

export type CronJitterConfig = {
  recurringFrac: number
  recurringCapMs: number
  oneShotMaxMs: number
  oneShotFloorMs: number
  oneShotMinuteMod: number
  recurringMaxAgeMs: number
}

export type HookEvent = (typeof HOOK_EVENTS)[number]
export type ExitReason = (typeof EXIT_REASONS)[number]
