import { describe, expect, test } from 'bun:test'
import { WebBrowserTool } from '../WebBrowserTool.js'
import { sanitizeBrowserUrl } from 'src/browser/runtime.js'

describe('WebBrowserTool', () => {
  test('exposes the integrated browser contract', async () => {
    expect(WebBrowserTool.name).toBe('WebBrowser')
    expect(WebBrowserTool.userFacingName()).toBe('Browser')
    expect(await WebBrowserTool.description()).toContain('visible, persistent')
    const prompt = await WebBrowserTool.prompt()
    expect(prompt).toContain('no browser extension')
    expect(prompt).toContain('Login state persists')
    expect(prompt).toContain('Request human intervention only')
    expect(prompt).toContain('AskUserQuestion')
    expect(prompt).toContain('real PNG')
    expect(prompt).toContain('frontend verification')
  })

  test('supports navigation, interaction, diagnostics, and lifecycle actions', () => {
    const actions = [
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
    ]
    for (const action of actions) {
      expect(WebBrowserTool.inputSchema.safeParse({ action }).success).toBe(
        true,
      )
    }
    expect(
      WebBrowserTool.inputSchema.safeParse({ action: 'extension' }).success,
    ).toBe(false)
  })

  test('validates action-specific inputs', async () => {
    expect(
      await WebBrowserTool.validateInput?.({ action: 'navigate' }),
    ).toMatchObject({ result: false })
    expect(
      await WebBrowserTool.validateInput?.({
        action: 'navigate',
        url: 'http://localhost:3000',
      }),
    ).toEqual({ result: true })
    expect(
      await WebBrowserTool.validateInput?.({
        action: 'type',
        selector: '#email',
      }),
    ).toMatchObject({
      result: false,
    })
    expect(
      await WebBrowserTool.validateInput?.({
        action: 'type',
        selector: '#email',
        text: 'a@example.com',
      }),
    ).toEqual({ result: true })
  })

  test('returns screenshots as model-visible image blocks', () => {
    const result = WebBrowserTool.mapToolResultToToolResultBlockParam(
      {
        title: 'Preview',
        url: 'http://localhost:3000',
        screenshot: 'cG5n',
      },
      'tool-1',
    )
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'cG5n' },
    })
  })

  test('marks runtime failures as model-visible tool errors', () => {
    const result = WebBrowserTool.mapToolResultToToolResultBlockParam(
      {
        title: 'Browser error',
        url: '',
        content: 'Browser control is paused for the user.',
        failed: true,
      },
      'tool-error',
    )
    expect(result.is_error).toBe(true)
  })

  test('redacts credentials and authentication data from browser URLs', () => {
    expect(
      sanitizeBrowserUrl(
        'https://user:password@example.com/callback?code=secret&view=ok#token',
      ),
    ).toBe('https://example.com/callback?code=%5Bredacted%5D&view=ok')
    expect(sanitizeBrowserUrl('data:text/html,secret')).toBe('data:[redacted]')
  })

  test('classifies observation and interaction actions', () => {
    expect(WebBrowserTool.isReadOnly({ action: 'screenshot' })).toBe(true)
    expect(WebBrowserTool.isReadOnly({ action: 'click' })).toBe(false)
    expect(WebBrowserTool.isDestructive({ action: 'evaluate' })).toBe(true)
    expect(WebBrowserTool.isDestructive({ action: 'snapshot' })).toBe(false)
    expect(WebBrowserTool.isDestructive({ action: 'request_user' })).toBe(false)
    expect(WebBrowserTool.isDestructive({ action: 'resume' })).toBe(false)
  })
})
