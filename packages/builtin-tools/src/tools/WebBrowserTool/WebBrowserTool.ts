import type {
  Base64ImageSource,
  ImageBlockParam,
  TextBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { buildTool } from 'src/Tool.js'
import {
  type BrowserActionOutput,
  executeBrowserAction,
} from 'src/browser/runtime.js'
import { lazySchema } from 'src/utils/lazySchema.js'

const WEB_BROWSER_TOOL_NAME = 'WebBrowser'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'navigate',
        'snapshot',
        'screenshot',
        'click',
        'type',
        'evaluate',
        'console',
        'status',
        'request_user',
        'resume',
        'close',
      ])
      .describe('Browser action to perform.'),
    url: z
      .string()
      .optional()
      .describe(
        'URL for navigate, or an optional URL to load before another action.',
      ),
    selector: z
      .string()
      .optional()
      .describe(
        'Playwright locator for click or type, such as text=Save, #email, or role=button[name="Save"].',
      ),
    text: z.string().optional().describe('Text to enter for the type action.'),
    script: z
      .string()
      .optional()
      .describe('JavaScript expression or function body for evaluate.'),
    waitFor: z
      .enum(['load', 'domcontentloaded', 'networkidle'])
      .optional()
      .describe('Navigation readiness state. Defaults to domcontentloaded.'),
    fullPage: z
      .boolean()
      .optional()
      .describe('Capture the full document when taking a screenshot.'),
    viewport: z
      .strictObject({
        width: z.number().int().min(320).max(3840),
        height: z.number().int().min(240).max(2160),
      })
      .optional()
      .describe('Browser viewport. Defaults to 1440x900.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type BrowserInput = z.infer<InputSchema>

export const WebBrowserTool = buildTool({
  name: WEB_BROWSER_TOOL_NAME,
  maxResultSizeChars: Infinity,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  async description() {
    return "Control Sophia's visible, persistent Chrome browser for autonomous navigation, interaction, screenshots, and human handoff."
  },
  async prompt() {
    return `Use Sophia's dedicated visible browser for real web automation. It launches and manages a persistent Chrome, Edge, or Chromium profile directly; no browser extension or access to the user's everyday browser is required. Login state persists across Sophia sessions.

Operate autonomously by default. Request human intervention only when a step cannot reasonably be automated, such as password entry, CAPTCHA, passkey, QR-code login, or an explicitly protected confirmation. For handoff: call request_user, then use AskUserQuestion to wait until the user confirms completion, then call resume. While human control is active, do not attempt other browser actions. Resume always returns a fresh page snapshot; do not rely on pre-handoff page state.

Actions:
- navigate: load a URL and return an accessibility-oriented page snapshot
- snapshot: inspect the current rendered page
- screenshot: return a real PNG image to the model
- click: click a Playwright locator
- type: fill a locator with text
- evaluate: execute JavaScript in the page
- console: read browser console messages and page errors
- status: report whether Sophia or the user currently controls the browser
- request_user: pause Sophia browser actions so the user can intervene in the visible window
- resume: reclaim control after the user confirms completion and return a fresh snapshot
- close: close the managed browser session

For frontend verification, start the development server, navigate to it, capture screenshots at desktop and mobile viewports, inspect console errors, interact with the changed workflow, and iterate until the rendered result is correct.`
  },

  isConcurrencySafe() {
    return false
  },
  isReadOnly(input: BrowserInput) {
    return ['navigate', 'snapshot', 'screenshot', 'console', 'status'].includes(
      input.action,
    )
  },
  isDestructive(input: BrowserInput) {
    return ['click', 'type', 'evaluate'].includes(input.action)
  },
  async validateInput(input: BrowserInput) {
    const requiredByAction: Partial<
      Record<
        BrowserInput['action'],
        Array<'url' | 'selector' | 'text' | 'script'>
      >
    > = {
      navigate: ['url'],
      click: ['selector'],
      type: ['selector', 'text'],
      evaluate: ['script'],
    }
    const missing = requiredByAction[input.action]?.find(field => !input[field])
    return missing
      ? {
          result: false as const,
          message: `${missing} is required for ${input.action}`,
          errorCode: 1,
        }
      : { result: true as const }
  },

  userFacingName() {
    return 'Browser'
  },

  renderToolUseMessage(input: Partial<BrowserInput>) {
    return `Browser ${input.action ?? '...'}: ${input.url ?? input.selector ?? ''}`.trim()
  },

  mapToolResultToToolResultBlockParam(
    output: BrowserActionOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    const text = [
      output.title && `${output.title} (${output.url})`,
      output.content,
      output.console?.length
        ? `Console:\n${output.console.join('\n')}`
        : undefined,
      output.errors?.length
        ? `Page errors:\n${output.errors.join('\n')}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n\n')
    const content: Array<TextBlockParam | ImageBlockParam> = [
      { type: 'text', text: text || 'Browser action completed.' },
    ]
    if (output.screenshot) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png' as Base64ImageSource['media_type'],
          data: output.screenshot,
        },
      })
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
      is_error: output.failed === true,
    }
  },

  async call(input: BrowserInput) {
    try {
      return { data: await executeBrowserAction(input) }
    } catch (error) {
      return {
        data: {
          title: 'Browser error',
          url: input.url ?? '',
          content: error instanceof Error ? error.message : String(error),
          failed: true,
        },
      }
    }
  },
})
