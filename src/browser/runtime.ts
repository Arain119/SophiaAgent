import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContext, LaunchOptions, Page } from 'playwright-core'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { getSophiaConfigHomeDir } from '../utils/envUtils.js'

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
    | 'status'
    | 'request_user'
    | 'resume'
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
  failed?: boolean
}

type DirectBrowserState = {
  context: BrowserContext
  page: Page
  pausedForUser: boolean
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
const BROWSER_PROFILE_DIR = join(getSophiaConfigHomeDir(), 'browser-profile')
const SENSITIVE_URL_PARAM =
  /^(?:access_token|auth|authorization|code|credential|id_token|key|otp|password|secret|session|sig|signature|token)$/i
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
const sensitiveUrlParam = /^(?:access_token|auth|authorization|code|credential|id_token|key|otp|password|secret|session|sig|signature|token)$/i
let context
let page
let pausedForUser = false
const profilePath = process.env.SOPHIA_BROWSER_PROFILE

function remember(list, value) {
  list.push(value)
  if (list.length > 200) list.splice(0, list.length - 200)
}

function truncate(value) {
  return value.length > MAX_TEXT_LENGTH
    ? value.slice(0, MAX_TEXT_LENGTH) + '\n[truncated]'
    : value
}

function safeUrl(value) {
  if (value.startsWith('data:') || value.startsWith('javascript:')) {
    return value.split(':', 1)[0] + ':[redacted]'
  }
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    for (const key of parsed.searchParams.keys()) {
      if (sensitiveUrlParam.test(key)) parsed.searchParams.set(key, '[redacted]')
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return value
  }
}

async function redactSensitiveValues(currentPage, content) {
  const values = await currentPage
    .locator('input[type="password"], input[autocomplete="one-time-code"]')
    .evaluateAll(inputs => inputs.map(input => input.value).filter(Boolean))
    .catch(() => [])
  return values.reduce((safe, value) => safe.split(value).join('[sensitive input]'), content)
}

async function redactSensitiveLists(currentPage, values) {
  return Promise.all(values.map(value => redactSensitiveValues(currentPage, value)))
}

function watchPage(currentPage) {
  currentPage.on('console', message => {
    remember(consoleMessages, '[' + message.type() + '] ' + message.text())
  })
  currentPage.on('pageerror', error => {
    remember(pageErrors, error.message)
  })
}

async function launchBrowser() {
  if (!profilePath) throw new Error('SOPHIA_BROWSER_PROFILE is required')
  const attempts = [
    { channel: 'chrome', headless: false, timeout: 15000 },
    { channel: 'msedge', headless: false, timeout: 15000 },
    { headless: false, timeout: 15000 },
  ]
  const errors = []
  for (const options of attempts) {
    try {
      return await chromium.launchPersistentContext(profilePath, {
        ...options,
        viewport: null,
        args: ['--start-maximized'],
      })
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
  if (!context) {
    context = await launchBrowser()
    page = context.pages()[0] ?? await context.newPage()
    for (const currentPage of context.pages()) watchPage(currentPage)
    context.on('page', watchPage)
  }
  const latestPage = context.pages().filter(candidate => !candidate.isClosed()).at(-1)
  if (latestPage && latestPage !== page) page = latestPage
  if (!page || page.isClosed()) page = await context.newPage()
  if (viewport) await page.setViewportSize(viewport)
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
    url: safeUrl(currentPage.url()),
    content: truncate(await redactSensitiveValues(currentPage, content)),
  }
}

function required(request, field) {
  const value = request[field]
  if (!value) throw new Error(field + ' is required for the ' + request.action + ' action')
  return value
}

async function handle(request) {
  if (request.action === 'close') {
    await context?.close().catch(() => undefined)
    context = undefined
    page = undefined
    pausedForUser = false
    consoleMessages.length = 0
    pageErrors.length = 0
    return { title: 'Browser closed', url: '' }
  }

  if (request.action === 'status') {
    const current = await summary()
    return {
      ...current,
      content: ((pausedForUser ? 'Human control is active.' : 'Sophia control is active.') + '\n\n' + (current.content ?? '')).trim(),
    }
  }
  if (request.action === 'request_user') {
    await ensurePage(request.viewport)
    pausedForUser = true
    const current = await summary()
    return {
      ...current,
      content: ('Human control is active. Ask the user to complete the required browser step, then call resume after they confirm.\n\n' + (current.content ?? '')).trim(),
    }
  }
  if (request.action === 'resume') {
    pausedForUser = false
    const current = await summary()
    return {
      ...current,
      content: ('Sophia control resumed.\n\n' + (current.content ?? '')).trim(),
    }
  }
  if (pausedForUser) {
    throw new Error('Browser control is paused for the user. Wait for confirmation, then call resume.')
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
      mask: [currentPage.locator('input[type="password"], input[autocomplete="one-time-code"]')],
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
    url: safeUrl(currentPage.url()),
    console: await redactSensitiveLists(currentPage, consoleMessages),
    errors: await redactSensitiveLists(currentPage, pageErrors),
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
  await context?.close().catch(() => undefined)
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

export function sanitizeBrowserUrl(value: string): string {
  if (value.startsWith('data:') || value.startsWith('javascript:')) {
    return `${value.split(':', 1)[0]}:[redacted]`
  }
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_URL_PARAM.test(key)) {
        parsed.searchParams.set(key, '[redacted]')
      }
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return value
  }
}

async function redactSensitiveValues(
  page: Page,
  content: string,
): Promise<string> {
  const values = await page
    .locator('input[type="password"], input[autocomplete="one-time-code"]')
    .evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).value).filter(Boolean),
    )
    .catch(() => [] as string[])
  return values.reduce(
    (safe, value) => safe.replaceAll(value, '[sensitive input]'),
    content,
  )
}

async function redactSensitiveLists(
  page: Page,
  values: string[],
): Promise<string[]> {
  return Promise.all(values.map(value => redactSensitiveValues(page, value)))
}

function watchPage(page: Page): void {
  page.on('console', message => {
    remember(consoleMessages, `[${message.type()}] ${message.text()}`)
  })
  page.on('pageerror', error => {
    remember(pageErrors, error.message)
  })
}

function shouldUseBrowserHost(): boolean {
  return process.platform === 'win32' && typeof Bun !== 'undefined'
}

async function launchBrowser(): Promise<BrowserContext> {
  const { chromium } = await import('playwright-core')
  const attempts: LaunchOptions[] = [
    { channel: 'chrome', headless: false, timeout: 15_000 },
    { channel: 'msedge', headless: false, timeout: 15_000 },
    { headless: false, timeout: 15_000 },
  ]
  const errors: string[] = []

  for (const options of attempts) {
    try {
      await mkdir(BROWSER_PROFILE_DIR, { recursive: true, mode: 0o700 })
      return await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        ...options,
        viewport: null,
        args: ['--start-maximized'],
      })
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

async function createDirectState(): Promise<DirectBrowserState> {
  const context = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())
  for (const currentPage of context.pages()) watchPage(currentPage)
  context.on('page', watchPage)
  context.on('close', () => {
    directStatePromise = undefined
  })

  unregisterCleanup?.()
  unregisterCleanup = registerCleanup(async () => {
    directStatePromise = undefined
    await context.close().catch(() => undefined)
  })
  return { context, page, pausedForUser: false }
}

async function getDirectState(
  viewport: BrowserViewport = DEFAULT_VIEWPORT,
): Promise<DirectBrowserState> {
  directStatePromise ??= createDirectState()
  const state = await directStatePromise
  const latestPage = state.context
    .pages()
    .filter(candidate => !candidate.isClosed())
    .at(-1)
  if (latestPage && latestPage !== state.page) state.page = latestPage
  if (state.page.isClosed()) state.page = await state.context.newPage()
  if (viewport) await state.page.setViewportSize(viewport)
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
    url: sanitizeBrowserUrl(page.url()),
    content: truncate(await redactSensitiveValues(page, content)),
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
      const { context } = await current
      await context.close().catch(() => undefined)
    }
    return { title: 'Browser closed', url: '' }
  }

  const state = await getDirectState(request.viewport)
  if (request.action === 'status') {
    const current = await directSummary()
    return {
      ...current,
      content:
        `${state.pausedForUser ? 'Human control is active.' : 'Sophia control is active.'}\n\n${current.content ?? ''}`.trim(),
    }
  }
  if (request.action === 'request_user') {
    state.pausedForUser = true
    const current = await directSummary()
    return {
      ...current,
      content:
        `Human control is active. Ask the user to complete the required browser step, then call resume after they confirm.\n\n${current.content ?? ''}`.trim(),
    }
  }
  if (request.action === 'resume') {
    state.pausedForUser = false
    const current = await directSummary()
    return {
      ...current,
      content: `Sophia control resumed.\n\n${current.content ?? ''}`.trim(),
    }
  }
  if (state.pausedForUser) {
    throw new Error(
      'Browser control is paused for the user. Wait for confirmation, then call resume.',
    )
  }

  const { page } = state
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
      mask: [
        page.locator(
          'input[type="password"], input[autocomplete="one-time-code"]',
        ),
      ],
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
    url: sanitizeBrowserUrl(page.url()),
    console: await redactSensitiveLists(page, consoleMessages),
    errors: await redactSensitiveLists(page, pageErrors),
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
  await mkdir(BROWSER_PROFILE_DIR, { recursive: true, mode: 0o700 })
  const child = spawn(
    'node',
    ['--input-type=module', '-e', BROWSER_HOST_SOURCE, playwrightUrl],
    {
      stdio: 'pipe',
      windowsHide: true,
      env: { ...process.env, SOPHIA_BROWSER_PROFILE: BROWSER_PROFILE_DIR },
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
