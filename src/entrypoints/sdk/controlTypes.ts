import type { z } from 'zod'
import type {
  SDKControlCancelRequestSchema,
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlMcpSetServersResponseSchema,
  SDKControlReloadPluginsResponseSchema,
  SDKControlRequestInnerSchema,
  SDKControlRequestSchema,
  SDKControlResponseSchema,
  StdinMessageSchema,
  StdoutMessageSchema,
} from './controlSchemas.js'
import type { SDKPartialAssistantMessageSchema } from './coreSchemas.js'

export type SDKControlRequest = z.infer<
  ReturnType<typeof SDKControlRequestSchema>
>
export type SDKControlResponse = z.infer<
  ReturnType<typeof SDKControlResponseSchema>
>
export type StdoutMessage = z.infer<ReturnType<typeof StdoutMessageSchema>>
export type SDKControlInitializeRequest = z.infer<
  ReturnType<typeof SDKControlInitializeRequestSchema>
>
export type SDKControlInitializeResponse = z.infer<
  ReturnType<typeof SDKControlInitializeResponseSchema>
>
export type SDKControlMcpSetServersResponse = z.infer<
  ReturnType<typeof SDKControlMcpSetServersResponseSchema>
>
export type SDKControlReloadPluginsResponse = z.infer<
  ReturnType<typeof SDKControlReloadPluginsResponseSchema>
>
export type StdinMessage = z.infer<ReturnType<typeof StdinMessageSchema>>
export type SDKPartialAssistantMessage = z.infer<
  ReturnType<typeof SDKPartialAssistantMessageSchema>
>
export type SDKControlCancelRequest = z.infer<
  ReturnType<typeof SDKControlCancelRequestSchema>
>
export type SDKControlRequestInner = z.infer<
  ReturnType<typeof SDKControlRequestInnerSchema>
>
