import type {
  ElicitResult,
  JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'crypto'
import type {
  HookInput,
  HookJSONOutput,
  SDKMessage,
  SDKUserMessage,
} from 'src/entrypoints/agentSdkTypes.js'
import { SDKControlElicitationResponseSchema } from 'src/entrypoints/sdk/controlSchemas.js'
import type {
  SDKControlRequest,
  StdinMessage,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import { type HookCallback, hookJSONOutputSchema } from 'src/types/hooks.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import { AbortError } from 'src/utils/errors.js'
import { applyFixedSafetyPolicy } from 'src/utils/safety/fixedSafetyPolicy.js'
import { evaluateToolSafety } from 'src/utils/safety/toolSafety.js'
import { writeToStdout } from 'src/utils/process.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { z } from 'zod/v4'
import { notifyCommandLifecycle } from '../utils/commandLifecycle.js'
import { normalizeControlMessageKeys } from '../utils/controlMessageCompat.js'
import { type SessionExternalMetadata } from '../utils/sessionState.js'
import { jsonParse } from '../utils/slowOperations.js'
import { Stream } from '../utils/stream.js'
import { ndjsonSafeStringify } from './ndjsonSafeStringify.js'

type PendingRequest<T> = {
  resolve: (result: T) => void
  reject: (error: unknown) => void
  schema?: z.Schema
  request: SDKControlRequest
}

/**
 * Provides a structured way to read and write SDK messages from stdio,
 * capturing the SDK protocol.
 */
export class StructuredIO {
  readonly structuredInput: AsyncGenerator<StdinMessage | SDKMessage>
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>()

  // Optional external metadata supplied by SDK callers.
  restoredWorkerState: Promise<SessionExternalMetadata | null> =
    Promise.resolve(null)

  private inputClosed = false
  private prependedLines: string[] = []

  // sendRequest() and print.ts both enqueue here; the drain loop is the
  // only writer. Prevents control_request from overtaking queued stream_events.
  readonly outbound = new Stream<StdoutMessage>()

  constructor(
    private readonly input: AsyncIterable<string>,
    private readonly replayUserMessages?: boolean,
  ) {
    this.input = input
    this.structuredInput = this.read()
  }

  /** Flush pending output. */
  flushInternalEvents(): Promise<void> {
    return Promise.resolve()
  }

  /** Internal queue depth. */
  get internalEventsPending(): number {
    return 0
  }

  /**
   * Queue a user turn to be yielded before the next message from this.input.
   * Works before iteration starts and mid-stream — read() re-checks
   * prependedLines between each yielded message.
   */
  prependUserMessage(content: string): void {
    this.prependedLines.push(
      jsonStringify({
        type: 'user',
        content,
        uuid: '',
        session_id: '',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      } satisfies SDKUserMessage) + '\n',
    )
  }

  private async *read() {
    let content = ''

    // Called once before for-await (an empty this.input otherwise skips the
    // loop body entirely), then again per block. prependedLines re-check is
    // inside the while so a prepend pushed between two messages in the SAME
    // block still lands first.
    const splitAndProcess = async function* (this: StructuredIO) {
      for (;;) {
        if (this.prependedLines.length > 0) {
          content = this.prependedLines.join('') + content
          this.prependedLines = []
        }
        const newline = content.indexOf('\n')
        if (newline === -1) break
        const line = content.slice(0, newline)
        content = content.slice(newline + 1)
        const message = await this.processLine(line)
        if (message) {
          logForDiagnosticsNoPII('info', 'cli_stdin_message_parsed', {
            type: message.type,
          })
          yield message
        }
      }
    }.bind(this)

    yield* splitAndProcess()

    for await (const block of this.input) {
      content += block
      yield* splitAndProcess()
    }
    if (content) {
      const message = await this.processLine(content)
      if (message) {
        yield message
      }
    }
    this.inputClosed = true
    for (const request of this.pendingRequests.values()) {
      // Reject all pending requests if the input stream
      request.reject(new Error('Control request stream closed before response'))
    }
  }

  private async processLine(
    line: string,
  ): Promise<StdinMessage | SDKMessage | undefined> {
    // Skip empty lines (e.g. from double newlines in piped stdin)
    if (!line) {
      return undefined
    }
    try {
      const message = normalizeControlMessageKeys(jsonParse(line)) as
        | StdinMessage
        | SDKMessage
      if (message.type === 'keep_alive') {
        // Silently ignore keep-alive messages
        return undefined
      }
      if (message.type === 'update_environment_variables') {
        // Apply environment variable updates directly to process.env.
        // Used by bridge session runner for auth token refresh
        // (SOPHIA_SESSION_ACCESS_TOKEN) which must be readable
        // by the REPL process itself, not just child Bash commands.
        const variables = message.variables ?? {}
        const keys = Object.keys(variables)
        for (const [key, value] of Object.entries(variables)) {
          process.env[key] = value
        }
        logForDebugging(
          `[structuredIO] applied update_environment_variables: ${keys.join(', ')}`,
        )
        return undefined
      }
      if (message.type === 'control_response') {
        // Close lifecycle for every control_response, including duplicates
        // and orphans — orphans don't yield to print.ts's main loop, so this
        // is the only path that sees them. uuid is server-injected into the
        // payload.
        const uuid =
          'uuid' in message && typeof message.uuid === 'string'
            ? message.uuid
            : undefined
        if (uuid) {
          notifyCommandLifecycle(uuid, 'completed')
        }
        const resp = message.response as {
          request_id: string
          subtype: string
          response?: Record<string, unknown>
          error?: string
        }
        const request = this.pendingRequests.get(resp.request_id)
        if (!request) {
          return undefined
        }
        this.pendingRequests.delete(resp.request_id)

        if (resp.subtype === 'error') {
          request.reject(new Error(resp.error ?? 'Unknown error'))
          return undefined
        }
        const result = resp.response
        if (request.schema) {
          try {
            request.resolve(request.schema.parse(result))
          } catch (error) {
            request.reject(error)
          }
        } else {
          request.resolve({})
        }
        // Propagate control responses when replay is enabled
        if (this.replayUserMessages) {
          return message
        }
        return undefined
      }
      if (
        message.type !== 'user' &&
        message.type !== 'control_request' &&
        message.type !== 'assistant' &&
        message.type !== 'system'
      ) {
        logForDebugging(`Ignoring unknown message type: ${message.type}`, {
          level: 'warn',
        })
        return undefined
      }
      if (message.type === 'control_request') {
        if (!message.request) {
          exitWithMessage(`Error: Missing request on control_request`)
        }
        return message
      }
      if (message.type === 'assistant' || message.type === 'system') {
        return message
      }
      if (
        (message as { message?: { role?: string } }).message?.role !== 'user'
      ) {
        exitWithMessage(
          `Error: Expected message role 'user', got '${(message as { message?: { role?: string } }).message?.role}'`,
        )
      }
      return message
    } catch (error) {
      console.error(`Error parsing streaming input line: ${line}: ${error}`)
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(1)
    }
  }

  async write(message: StdoutMessage): Promise<void> {
    writeToStdout(ndjsonSafeStringify(message) + '\n')
  }

  private async sendRequest<Response>(
    request: SDKControlRequest['request'],
    schema: z.Schema,
    signal?: AbortSignal,
    requestId: string = randomUUID(),
  ): Promise<Response> {
    const message: SDKControlRequest = {
      type: 'control_request',
      request_id: requestId,
      request,
    }
    if (this.inputClosed) {
      throw new Error('Stream closed')
    }
    if (signal?.aborted) {
      throw new Error('Request aborted')
    }
    this.outbound.enqueue(message)
    const aborted = () => {
      this.outbound.enqueue({
        type: 'control_cancel_request',
        request_id: requestId,
      })
      // Immediately reject the outstanding promise, without
      // waiting for the host to acknowledge the cancellation.
      const request = this.pendingRequests.get(requestId)
      if (request) {
        request.reject(new AbortError())
      }
    }
    if (signal) {
      signal.addEventListener('abort', aborted, {
        once: true,
      })
    }
    try {
      return await new Promise<Response>((resolve, reject) => {
        this.pendingRequests.set(requestId, {
          request: {
            type: 'control_request',
            request_id: requestId,
            request,
          },
          resolve: result => {
            resolve(result as Response)
          },
          reject,
          schema,
        })
      })
    } finally {
      if (signal) {
        signal.removeEventListener('abort', aborted)
      }
      this.pendingRequests.delete(requestId)
    }
  }

  createCanUseTool(): CanUseToolFn {
    return async (
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseID,
      forceDecision,
    ) => {
      const decision =
        forceDecision ??
        (await evaluateToolSafety(
          tool,
          input,
          toolUseContext,
          assistantMessage,
          toolUseID,
        ))
      return applyFixedSafetyPolicy(tool.name, input, decision)
    }
  }

  createHookCallback(callbackId: string, timeout?: number): HookCallback {
    return {
      type: 'callback',
      timeout,
      callback: async (
        input: HookInput,
        toolUseID: string | null,
        abort: AbortSignal | undefined,
      ): Promise<HookJSONOutput> => {
        try {
          const result = await this.sendRequest<HookJSONOutput>(
            {
              subtype: 'hook_callback',
              callback_id: callbackId,
              input: input as any,
              tool_use_id: toolUseID || undefined,
            },
            hookJSONOutputSchema(),
            abort,
          )
          return result
        } catch (error) {
          console.error(`Error in hook callback ${callbackId}:`, error)
          return {}
        }
      },
    }
  }

  /**
   * Sends an elicitation request to the SDK consumer and returns the response.
   */
  async handleElicitation(
    serverName: string,
    message: string,
    requestedSchema?: Record<string, unknown>,
    signal?: AbortSignal,
    mode?: 'form' | 'url',
    url?: string,
    elicitationId?: string,
  ): Promise<ElicitResult> {
    try {
      const result = await this.sendRequest<ElicitResult>(
        {
          subtype: 'elicitation',
          mcp_server_name: serverName,
          message,
          mode,
          url,
          elicitation_id: elicitationId,
          requested_schema: requestedSchema,
        },
        SDKControlElicitationResponseSchema(),
        signal,
      )
      return result
    } catch {
      return { action: 'cancel' as const }
    }
  }

  createSandboxAskCallback(): (hostPattern: {
    host: string
    port?: number
  }) => Promise<boolean> {
    return async () => false
  }

  /**
   * Sends an MCP message to an SDK server and waits for the response
   */
  async sendMcpMessage(
    serverName: string,
    message: JSONRPCMessage,
  ): Promise<JSONRPCMessage> {
    const response = await this.sendRequest<{ mcp_response: JSONRPCMessage }>(
      {
        subtype: 'mcp_message',
        server_name: serverName,
        message,
      },
      z.object({
        mcp_response: z.any() as z.Schema<JSONRPCMessage>,
      }),
    )
    return response.mcp_response
  }
}

function exitWithMessage(message: string): never {
  console.error(message)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}
