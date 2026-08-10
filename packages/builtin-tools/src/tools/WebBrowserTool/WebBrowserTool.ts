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
    return "Control Sophia's integrated Chromium browser for navigation, interaction, screenshots, and console inspection."
  },
  async prompt() {
    return `Use Sophia's integrated browser for real web rendering and frontend verification. It launches and manages Chrome, Edge, or Chromium directly; no browser extension or user browser session is required.

Actions:
- navigate: load a URL and return an accessibility-oriented page snapshot
- snapshot: inspect the current rendered page
- screenshot: return a real PNG image to the model
- click: click a Playwright locator
- type: fill a locator with text
- evaluate: execute JavaScript in the page
- console: read browser console messages and page errors
- close: close the managed browser session

For frontend work, start the development server, navigate to it, capture screenshots at desktop and mobile viewports, inspect console errors, interact with the changed workflow, and iterate until the rendered result is correct.`
  },

  isConcurrencySafe() {
    return false
  },
  isReadOnly(input: BrowserInput) {
    return ['navigate', 'snapshot', 'screenshot', 'console'].includes(
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
    return { tool_use_id: toolUseID, type: 'tool_result', content }
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
        },
      }
    }
  },
})
