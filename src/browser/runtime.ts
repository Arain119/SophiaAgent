import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  Browser,
  BrowserContext,
  LaunchOptions,
  Page,
} from 'playwright-core'
import { registerCleanup } from '../utils/cleanupRegistry.js'

export type BrowserViewport = { width: number; height: number }

export type BrowserActionRequest = {
  action:
    | 'navigate'
    | 'snapshot'
    | 'screenshot'
    | 'click'
    | 'type'
    | 'evaluate'
    | 'console'
    | 'close'
  url?: string
  selector?: string
  text?: string
  script?: string
  waitFor?: 'load' | 'domcontentloaded' | 'networkidle'
  fullPage?: boolean
  viewport?: BrowserViewport
}

export type BrowserActionOutput = {
  title: string
  url: string
  content?: string
  screenshot?: string
  console?: string[]
  errors?: string[]
}

type DirectBrowserState = {
  browser: Browser
  context: BrowserContext
  page: Page
}

type HostResponse = {
  id: number
  ok: boolean
  data?: BrowserActionOutput
  error?: string
}

type PendingHostRequest = {
  resolve: (output: BrowserActionOutput) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type BrowserHost = {
  child: ChildProcessWithoutNullStreams
  nextId: number
  pending: Map<number, PendingHostRequest>
  stdoutBuffer: string
  stderr: string
}

const DEFAULT_VIEWPORT: BrowserViewport = { width: 1440, height: 900 }
const MAX_TEXT_LENGTH = 50_000
const HOST_REQUEST_TIMEOUT_MS = 45_000
const consoleMessages: string[] = []
const pageErrors: string[] = []

let directStatePromise: Promise<DirectBrowserState> | undefined
let hostPromise: Promise<BrowserHost> | undefined
let unregisterCleanup: (() => void) | undefined

const BROWSER_HOST_SOURCE = String.raw`
const { chromium } = await import(process.argv[1])

const DEFAULT_VIEWPORT = { width: 1440, height: 900 }
const MAX_TEXT_LENGTH = 50000
const consoleMessages = []
const pageErrors = []
let browser
let context
let page

function remember(list, value) {
  list.push(value)
  if (list.length > 200) list.splice(0, list.length - 200)
}

function truncate(value) {
  return value.length > MAX_TEXT_LENGTH
    ? value.slice(0, MAX_TEXT_LENGTH) + '\n[truncated]'
    : value
}

async function launchBrowser() {
  const attempts = [
    { channel: 'chrome', headless: true, timeout: 15000 },
    { channel: 'msedge', headless: true, timeout: 15000 },
    { headless: true, timeout: 15000 },
  ]
  const errors = []
  for (const options of attempts) {
    try {
      return await chromium.launch(options)
    } catch (error) {
      errors.push(error instanceof Error ? error.message.split('\n')[0] : String(error))
    }
  }
  throw new Error(
    'Sophia could not start Chrome, Edge, or Chromium. Install a Chromium-based browser. ' +
      errors.join(' | '),
  )
}

async function ensurePage(viewport = DEFAULT_VIEWPORT) {
  if (!browser || !browser.isConnected()) {
    browser = await launchBrowser()
    context = await browser.newContext({
      viewport,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    page = await context.newPage()
    page.on('console', message => {
      remember(consoleMessages, '[' + message.type() + '] ' + message.text())
    })
    page.on('pageerror', error => {
      remember(pageErrors, error.message)
    })
  }
  await page.setViewportSize(viewport)
  return page
}

async function summary() {
  const currentPage = await ensurePage()
  const body = currentPage.locator('body')
  const content = await body
    .ariaSnapshot({ timeout: 5000 })
    .catch(() => body.innerText({ timeout: 5000 }))
    .catch(() => '')
  return {
    title: await currentPage.title(),
    url: currentPage.url(),
    content: truncate(content),
  }
}

function required(request, field) {
  const value = request[field]
  if (!value) throw new Error(field + ' is required for the ' + request.action + ' action')
  return value
}

async function handle(request) {
  if (request.action === 'close') {
    await browser?.close().catch(() => undefined)
    browser = undefined
    context = undefined
    page = undefined
    consoleMessages.length = 0
    pageErrors.length = 0
    return { title: 'Browser closed', url: '' }
  }

  const currentPage = await ensurePage(request.viewport)
  if (request.action === 'navigate') {
    consoleMessages.length = 0
    pageErrors.length = 0
    await currentPage.goto(required(request, 'url'), {
      waitUntil: request.waitFor ?? 'domcontentloaded',
      timeout: 30000,
    })
    return summary()
  }

  if (request.url) {
    await currentPage.goto(request.url, {
      waitUntil: request.waitFor ?? 'domcontentloaded',
      timeout: 30000,
    })
  }

  if (request.action === 'snapshot') return summary()
  if (request.action === 'screenshot') {
    const screenshot = await currentPage.screenshot({
      type: 'png',
      fullPage: request.fullPage ?? false,
    })
    return { ...await summary(), screenshot: screenshot.toString('base64') }
  }
  if (request.action === 'click') {
    await currentPage.locator(required(request, 'selector')).click({ timeout: 10000 })
    return summary()
  }
  if (request.action === 'type') {
    await currentPage
      .locator(required(request, 'selector'))
      .fill(required(request, 'text'), { timeout: 10000 })
    return summary()
  }
  if (request.action === 'evaluate') {
    const result = await currentPage.evaluate(required(request, 'script'))
    return {
      ...await summary(),
      content: truncate(JSON.stringify(result, null, 2) ?? 'undefined'),
    }
  }
  return {
    title: await currentPage.title(),
    url: currentPage.url(),
    console: [...consoleMessages],
    errors: [...pageErrors],
  }
}

let inputBuffer = ''
let queue = Promise.resolve()
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  inputBuffer += chunk
  while (true) {
    const newline = inputBuffer.indexOf('\n')
    if (newline < 0) break
    const line = inputBuffer.slice(0, newline).trim()
    inputBuffer = inputBuffer.slice(newline + 1)
    if (!line) continue
    queue = queue.then(async () => {
      let message
      try {
        message = JSON.parse(line)
        const data = await handle(message.request)
        process.stdout.write(JSON.stringify({ id: message.id, ok: true, data }) + '\n')
        if (message.request.action === 'close') setTimeout(() => process.exit(0), 0)
      } catch (error) {
        process.stdout.write(JSON.stringify({
          id: message?.id ?? -1,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }) + '\n')
      }
    })
  }
})
process.stdin.on('end', async () => {
  await browser?.close().catch(() => undefined)
  process.exit(0)
})
`

function remember(list: string[], value: string): void {
  list.push(value)
  if (list.length > 200) list.splice(0, list.length - 200)
}

function truncate(value: string): string {
  return value.length > MAX_TEXT_LENGTH
    ? `${value.slice(0, MAX_TEXT_LENGTH)}\n[truncated]`
    : value
}

function shouldUseBrowserHost(): boolean {
  return process.platform === 'win32' && typeof Bun !== 'undefined'
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright-core')
  const attempts: LaunchOptions[] = [
    { channel: 'chrome', headless: true, timeout: 15_000 },
    { channel: 'msedge', headless: true, timeout: 15_000 },
    { headless: true, timeout: 15_000 },
  ]
  const errors: string[] = []

  for (const options of attempts) {
    try {
      return await chromium.launch(options)
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message.split('\n')[0]! : String(error),
      )
    }
  }

  throw new Error(
    `Sophia could not start Chrome, Edge, or Chromium. Install a Chromium-based browser. ${errors.join(' | ')}`,
  )
}

async function createDirectState(
  viewport: BrowserViewport,
): Promise<DirectBrowserState> {
  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.on('console', message => {
    remember(consoleMessages, `[${message.type()}] ${message.text()}`)
  })
  page.on('pageerror', error => {
    remember(pageErrors, error.message)
  })
  browser.on('disconnected', () => {
    directStatePromise = undefined
  })

  unregisterCleanup?.()
  unregisterCleanup = registerCleanup(async () => {
    directStatePromise = undefined
    await browser.close().catch(() => undefined)
  })
  return { browser, context, page }
}

async function getDirectState(
  viewport: BrowserViewport = DEFAULT_VIEWPORT,
): Promise<DirectBrowserState> {
  directStatePromise ??= createDirectState(viewport)
  const state = await directStatePromise
  await state.page.setViewportSize(viewport)
  return state
}

async function directSummary(): Promise<BrowserActionOutput> {
  const { page } = await getDirectState()
  const body = page.locator('body')
  const content = await body
    .ariaSnapshot({ timeout: 5_000 })
    .catch(() => body.innerText({ timeout: 5_000 }))
    .catch(() => '')
  return {
    title: await page.title(),
    url: page.url(),
    content: truncate(content),
  }
}

function requireField(
  request: BrowserActionRequest,
  field: 'url' | 'selector' | 'text' | 'script',
): string {
  const value = request[field]
  if (!value)
    throw new Error(`${field} is required for the ${request.action} action`)
  return value
}

async function executeDirectAction(
  request: BrowserActionRequest,
): Promise<BrowserActionOutput> {
  if (request.action === 'close') {
    const current = directStatePromise
    directStatePromise = undefined
    unregisterCleanup?.()
    unregisterCleanup = undefined
    consoleMessages.length = 0
    pageErrors.length = 0
    if (current) {
      const { browser } = await current
      await browser.close().catch(() => undefined)
    }
    return { title: 'Browser closed', url: '' }
  }

  const { page } = await getDirectState(request.viewport)
  if (request.action === 'navigate') {
    consoleMessages.length = 0
    pageErrors.length = 0
    await page.goto(requireField(request, 'url'), {
      waitUntil: request.waitFor ?? 'domcontentloaded',
      timeout: 30_000,
    })
    return directSummary()
  }

  if (request.url) {
    await page.goto(request.url, {
      waitUntil: request.waitFor ?? 'domcontentloaded',
      timeout: 30_000,
    })
  }

  if (request.action === 'snapshot') return directSummary()
  if (request.action === 'screenshot') {
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: request.fullPage ?? false,
    })
    return {
      ...(await directSummary()),
      screenshot: Buffer.from(screenshot).toString('base64'),
    }
  }
  if (request.action === 'click') {
    await page
      .locator(requireField(request, 'selector'))
      .click({ timeout: 10_000 })
    return directSummary()
  }
  if (request.action === 'type') {
    await page
      .locator(requireField(request, 'selector'))
      .fill(requireField(request, 'text'), { timeout: 10_000 })
    return directSummary()
  }
  if (request.action === 'evaluate') {
    const result = await page.evaluate(requireField(request, 'script'))
    return {
      ...(await directSummary()),
      content: truncate(JSON.stringify(result, null, 2) ?? 'undefined'),
    }
  }
  return {
    title: await page.title(),
    url: page.url(),
    console: [...consoleMessages],
    errors: [...pageErrors],
  }
}

function isHostResponse(value: unknown): value is HostResponse {
  if (typeof value !== 'object' || value === null) return false
  const response = value as Record<string, unknown>
  return (
    typeof response.id === 'number' &&
    typeof response.ok === 'boolean' &&
    (response.data === undefined ||
      (typeof response.data === 'object' && response.data !== null)) &&
    (response.error === undefined || typeof response.error === 'string')
  )
}

function rejectHostRequests(host: BrowserHost, error: Error): void {
  for (const pending of host.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  host.pending.clear()
}

function handleHostStdout(host: BrowserHost, chunk: string): void {
  host.stdoutBuffer += chunk
  while (true) {
    const newline = host.stdoutBuffer.indexOf('\n')
    if (newline < 0) return
    const line = host.stdoutBuffer.slice(0, newline).trim()
    host.stdoutBuffer = host.stdoutBuffer.slice(newline + 1)
    if (!line) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      rejectHostRequests(
        host,
        new Error(`Browser host returned invalid JSON: ${line}`),
      )
      continue
    }
    if (!isHostResponse(parsed)) {
      rejectHostRequests(
        host,
        new Error('Browser host returned an invalid response'),
      )
      continue
    }

    const pending = host.pending.get(parsed.id)
    if (!pending) continue
    host.pending.delete(parsed.id)
    clearTimeout(pending.timer)
    if (!parsed.ok || !parsed.data) {
      pending.reject(new Error(parsed.error ?? 'Browser host action failed'))
    } else {
      pending.resolve(parsed.data)
    }
  }
}

async function createBrowserHost(): Promise<BrowserHost> {
  const playwrightUrl = import.meta.resolve('playwright-core')
  const child = spawn(
    'node',
    ['--input-type=module', '-e', BROWSER_HOST_SOURCE, playwrightUrl],
    {
      stdio: 'pipe',
      windowsHide: true,
    },
  )
  const host: BrowserHost = {
    child,
    nextId: 1,
    pending: new Map(),
    stdoutBuffer: '',
    stderr: '',
  }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => handleHostStdout(host, String(chunk)))
  child.stderr.on('data', chunk => {
    host.stderr = truncate(`${host.stderr}${String(chunk)}`)
  })
  child.on('error', error => {
    hostPromise = undefined
    rejectHostRequests(host, error)
  })
  child.on('exit', code => {
    hostPromise = undefined
    rejectHostRequests(
      host,
      new Error(
        `Browser host exited with code ${code ?? 'unknown'}${host.stderr ? `: ${host.stderr}` : ''}`,
      ),
    )
  })

  unregisterCleanup?.()
  unregisterCleanup = registerCleanup(async () => {
    hostPromise = undefined
    child.stdin.end()
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve()
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  })
  return host
}

async function sendHostRequest(
  host: BrowserHost,
  request: BrowserActionRequest,
): Promise<BrowserActionOutput> {
  const id = host.nextId++
  return new Promise<BrowserActionOutput>((resolve, reject) => {
    const timer = setTimeout(() => {
      host.pending.delete(id)
      reject(
        new Error(`Browser host timed out while running ${request.action}`),
      )
    }, HOST_REQUEST_TIMEOUT_MS)
    host.pending.set(id, { resolve, reject, timer })
    host.child.stdin.write(`${JSON.stringify({ id, request })}\n`, error => {
      if (!error) return
      host.pending.delete(id)
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function executeHostAction(
  request: BrowserActionRequest,
): Promise<BrowserActionOutput> {
  hostPromise ??= createBrowserHost()
  const host = await hostPromise
  const output = await sendHostRequest(host, request)
  if (request.action === 'close') {
    hostPromise = undefined
    unregisterCleanup?.()
    unregisterCleanup = undefined
    host.child.stdin.end()
  }
  return output
}

export async function executeBrowserAction(
  request: BrowserActionRequest,
): Promise<BrowserActionOutput> {
  return shouldUseBrowserHost()
    ? executeHostAction(request)
    : executeDirectAction(request)
}

export async function closeBrowser(): Promise<void> {
  await executeBrowserAction({ action: 'close' }).catch(() => undefined)
}
