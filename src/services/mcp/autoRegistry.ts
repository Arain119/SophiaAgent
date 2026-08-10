import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import {
  capabilityQueryTerms,
  normalizeCapabilityQuery,
} from '../capabilitySearch.js'
import type { ScopedMcpServerConfig } from './types.js'

const REGISTRY_ENDPOINT =
  'https://registry.modelcontextprotocol.io/v0.1/servers'
const NPM_REGISTRY = 'https://registry.npmjs.org'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_SEARCH_QUERIES = 4
const MAX_RESULTS_PER_QUERY = 20
const LOW_PRIORITY_SEARCH_TERMS = new Set([
  'deploy',
  'deployment',
  'service',
  'create',
  'build',
  'delete',
  'update',
  'run',
  'host',
  'publish',
  'send',
  'connect',
  'manage',
  'configure',
])

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type Requirement = {
  name?: unknown
  isRequired?: unknown
  isSecret?: unknown
  value?: unknown
}

type RegistryRemote = {
  type?: unknown
  url?: unknown
  headers?: unknown
  variables?: unknown
}

type RegistryPackage = {
  registryType?: unknown
  registryBaseUrl?: unknown
  identifier?: unknown
  version?: unknown
  transport?: { type?: unknown }
  environmentVariables?: unknown
}

type RegistryEntry = {
  server?: {
    name?: unknown
    title?: unknown
    description?: unknown
    version?: unknown
    repository?: { url?: unknown; source?: unknown }
    remotes?: unknown
    packages?: unknown
  }
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: {
      status?: unknown
      isLatest?: unknown
    }
  }
}

export type AutoMcpCandidate = {
  name: string
  registryName: string
  title: string
  description: string
  version: string
  score: number
  transport: 'http' | 'sse' | 'npm'
  config: ScopedMcpServerConfig | null
  requirements: string[]
}

export type AutoMcpDiscovery = {
  candidate: AutoMcpCandidate | null
  searched: string[]
}

export type AutoMcpRegistryOptions = {
  fetchImpl?: FetchLike
}

export type AutoMcpCandidates = {
  candidates: AutoMcpCandidate[]
  searched: string[]
}

function requirementNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const requirement = item as Requirement
    const required = requirement.isRequired === true
    const secret = requirement.isSecret === true
    const namedCredential =
      typeof requirement.name === 'string' &&
      /authorization|api[-_]?key|access[-_]?token|bearer|secret/i.test(
        requirement.name,
      )
    const templated =
      typeof requirement.value === 'string' && requirement.value.includes('{')
    if (!required && !secret && !templated && !namedCredential) return []
    return typeof requirement.name === 'string'
      ? [requirement.name]
      : ['unspecified credential']
  })
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      value.includes('{')
    ) {
      return false
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      return false
    }
    const ipVersion = isIP(hostname)
    if (ipVersion === 4) {
      const parts = hostname.split('.').map(Number)
      return !(
        parts[0] === 10 ||
        parts[0] === 127 ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
      )
    }
    if (ipVersion === 6) {
      return !(
        hostname === '::1' ||
        hostname === '::' ||
        hostname.startsWith('fc') ||
        hostname.startsWith('fd') ||
        hostname.startsWith('fe80:') ||
        hostname.startsWith('::ffff:127.') ||
        hostname.startsWith('::ffff:10.') ||
        hostname.startsWith('::ffff:192.168.')
      )
    }
    return hostname.includes('.')
  } catch {
    return false
  }
}

function safeName(registryName: string, identity: string): string {
  const leaf = registryName.split('/').at(-1) ?? 'server'
  const slug = leaf.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 8)
  return `auto_${slug}_${suffix}`
}

function scoreServer(
  name: string,
  title: string,
  description: string,
  queryTerms: string[],
): number {
  if (queryTerms.length === 0) return 0
  const identity = `${name} ${title}`.toLowerCase()
  const details = description.toLowerCase()
  const hasToken = (value: string, term: string): boolean =>
    new RegExp(
      `(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`,
      'i',
    ).test(value)
  const relatedTerms = (term: string): string[] => {
    if (term === 'service') return ['service', 'server']
    if (term === 'deploy' || term === 'deployment') {
      return ['deploy', 'deployment', 'release']
    }
    return [term]
  }
  let matched = 0
  for (const term of queryTerms) {
    const related = relatedTerms(term)
    if (related.some(candidateTerm => hasToken(identity, candidateTerm))) {
      matched += 3
    } else if (
      related.some(candidateTerm => hasToken(details, candidateTerm))
    ) {
      matched += 1
    }
  }
  return matched / (queryTerms.length * 3)
}

function parseRemote(
  remote: RegistryRemote,
  registryName: string,
): Pick<
  AutoMcpCandidate,
  'name' | 'transport' | 'config' | 'requirements'
> | null {
  if (typeof remote.url !== 'string' || !isPublicHttpsUrl(remote.url)) {
    return null
  }
  const requirements = [
    ...requirementNames(remote.headers),
    ...requirementNames(remote.variables),
  ]
  const type =
    remote.type === 'sse'
      ? 'sse'
      : remote.type === 'streamable-http' || remote.type === 'http'
        ? 'http'
        : null
  if (!type) return null
  return {
    name: safeName(registryName, remote.url),
    transport: type,
    config:
      requirements.length === 0
        ? { type, url: remote.url, scope: 'dynamic' }
        : null,
    requirements,
  }
}

function isExactVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

function isNpmIdentifier(value: string): boolean {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(value)
}

function parseNpmPackage(
  pkg: RegistryPackage,
  registryName: string,
):
  | (Pick<
      AutoMcpCandidate,
      'name' | 'transport' | 'config' | 'requirements'
    > & {
      packageRef: string
    })
  | null {
  if (
    pkg.registryType !== 'npm' ||
    (pkg.registryBaseUrl !== undefined &&
      pkg.registryBaseUrl !== NPM_REGISTRY) ||
    typeof pkg.identifier !== 'string' ||
    !isNpmIdentifier(pkg.identifier) ||
    typeof pkg.version !== 'string' ||
    !isExactVersion(pkg.version) ||
    pkg.transport?.type !== 'stdio'
  ) {
    return null
  }
  const requiredEnv = requirementNames(pkg.environmentVariables).filter(
    name => !process.env[name],
  )
  const packageRef = `${pkg.identifier}@${pkg.version}`
  const useBun = typeof Bun !== 'undefined'
  return {
    name: safeName(registryName, packageRef),
    transport: 'npm',
    config:
      requiredEnv.length === 0
        ? {
            type: 'stdio',
            command: useBun ? process.execPath : 'npx',
            args: useBun ? ['x', packageRef] : ['-y', packageRef],
            scope: 'dynamic',
          }
        : null,
    requirements: requiredEnv,
    packageRef,
  }
}

export function parseRegistryCandidates(
  value: unknown,
  query: string,
): AutoMcpCandidate[] {
  if (!value || typeof value !== 'object' || !('servers' in value)) return []
  const servers = (value as { servers?: unknown }).servers
  if (!Array.isArray(servers)) return []
  const terms = capabilityQueryTerms(query)
  const candidates: AutoMcpCandidate[] = []
  for (const raw of servers) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as RegistryEntry
    const server = entry.server
    const official = entry._meta?.['io.modelcontextprotocol.registry/official']
    if (
      !server ||
      typeof server.name !== 'string' ||
      typeof server.version !== 'string' ||
      official?.status !== 'active' ||
      official.isLatest !== true
    ) {
      continue
    }
    const title = typeof server.title === 'string' ? server.title : server.name
    const description =
      typeof server.description === 'string' ? server.description : ''
    const relevance = scoreServer(server.name, title, description, terms)
    if (relevance === 0) continue
    const githubRepository =
      server.repository?.source === 'github' &&
      typeof server.repository.url === 'string' &&
      server.repository.url.startsWith('https://github.com/')
    const repositoryBonus = githubRepository ? 0.25 : 0

    const remotes = Array.isArray(server.remotes) ? server.remotes : []
    for (const remote of remotes) {
      if (!remote || typeof remote !== 'object') continue
      const parsed = parseRemote(remote as RegistryRemote, server.name)
      if (!parsed) continue
      candidates.push({
        ...parsed,
        registryName: server.name,
        title,
        description,
        version: server.version,
        score:
          relevance + 0.2 + repositoryBonus - parsed.requirements.length * 0.05,
      })
    }

    if (!githubRepository) continue
    const packages = Array.isArray(server.packages) ? server.packages : []
    for (const pkg of packages) {
      if (!pkg || typeof pkg !== 'object') continue
      const parsed = parseNpmPackage(pkg as RegistryPackage, server.name)
      if (!parsed) continue
      const { packageRef: _packageRef, ...candidate } = parsed
      candidates.push({
        ...candidate,
        registryName: server.name,
        title,
        description,
        version: server.version,
        score:
          relevance + 0.1 + repositoryBonus - parsed.requirements.length * 0.05,
      })
    }
  }
  return candidates.sort((a, b) => b.score - a.score)
}

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Sophia-Agent/0.1' },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error(`MCP registry request failed: ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error('MCP registry response exceeded the size limit')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('MCP registry response exceeded the size limit')
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export function getMcpSearchQueries(task: string): string[] {
  const normalized = normalizeCapabilityQuery(task)
  if (!normalized) return []
  const terms = capabilityQueryTerms(normalized)
  const properTerms = new Set(
    normalized
      .match(/\b[A-Z][A-Za-z0-9_-]{2,}/g)
      ?.map(term => term.toLowerCase()) ?? [],
  )
  const prioritizedTerms = [...terms].sort((a, b) => {
    const properDifference =
      Number(properTerms.has(b)) - Number(properTerms.has(a))
    if (properDifference !== 0) return properDifference
    return (
      Number(LOW_PRIORITY_SEARCH_TERMS.has(a)) -
      Number(LOW_PRIORITY_SEARCH_TERMS.has(b))
    )
  })
  return [...new Set([normalized, ...prioritizedTerms])].slice(
    0,
    MAX_SEARCH_QUERIES,
  )
}

async function npmPackageHasIntegrity(
  fetchImpl: FetchLike,
  config: ScopedMcpServerConfig,
): Promise<boolean> {
  if (config.type !== 'stdio') return true
  const packageRef = config.args?.at(-1)
  if (!packageRef) return false
  const at = packageRef.lastIndexOf('@')
  if (at <= 0) return false
  const identifier = packageRef.slice(0, at)
  const version = packageRef.slice(at + 1)
  const metadata = await fetchJson(
    fetchImpl,
    `${NPM_REGISTRY}/${encodeURIComponent(identifier)}/${encodeURIComponent(version)}`,
  )
  if (!metadata || typeof metadata !== 'object') return false
  const dist = (metadata as { dist?: unknown }).dist
  if (!dist || typeof dist !== 'object') return false
  const record = dist as Record<string, unknown>
  return (
    typeof record.integrity === 'string' || typeof record.shasum === 'string'
  )
}

export async function findAutoMcpCandidates(
  task: string,
  options: AutoMcpRegistryOptions = {},
): Promise<AutoMcpCandidates> {
  const searched = getMcpSearchQueries(task)
  if (searched.length === 0) return { candidates: [], searched }
  const fetchImpl = options.fetchImpl ?? fetch
  const responses = await Promise.all(
    searched.map(async search => {
      try {
        const params = new URLSearchParams({
          search,
          limit: String(MAX_RESULTS_PER_QUERY),
          version: 'latest',
        })
        return {
          search,
          response: await fetchJson(
            fetchImpl,
            `${REGISTRY_ENDPOINT}?${params}`,
          ),
        }
      } catch {
        return { search, response: null }
      }
    }),
  )
  const taskTerms = capabilityQueryTerms(normalizeCapabilityQuery(task))
  const candidatesByName = new Map<string, AutoMcpCandidate>()
  for (const [index, { search, response }] of responses.entries()) {
    if (!response) continue
    const queryPriority = (searched.length - index) * 0.2
    for (const candidate of parseRegistryCandidates(response, search)) {
      const taskRelevance = scoreServer(
        candidate.registryName,
        candidate.title,
        candidate.description,
        taskTerms,
      )
      const prioritized = {
        ...candidate,
        score: candidate.score + queryPriority + taskRelevance * 2,
      }
      const existing = candidatesByName.get(candidate.name)
      if (!existing || prioritized.score > existing.score) {
        candidatesByName.set(candidate.name, prioritized)
      }
    }
  }
  const primaryTerms = taskTerms.filter(
    term => !LOW_PRIORITY_SEARCH_TERMS.has(term),
  )
  const candidates = [...candidatesByName.values()]
    .filter(
      candidate =>
        primaryTerms.length === 0 ||
        scoreServer(
          candidate.registryName,
          candidate.title,
          candidate.description,
          primaryTerms,
        ) > 0,
    )
    .sort((a, b) => b.score - a.score)
  const verified: AutoMcpCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate.config || candidate.transport !== 'npm') {
      verified.push(candidate)
      continue
    }
    try {
      if (await npmPackageHasIntegrity(fetchImpl, candidate.config)) {
        verified.push(candidate)
      }
    } catch {
      // Try the next official candidate when package metadata cannot be verified.
    }
  }
  return { candidates: verified, searched }
}

export async function findBestAutoMcp(
  task: string,
  options: AutoMcpRegistryOptions = {},
): Promise<AutoMcpDiscovery> {
  const result = await findAutoMcpCandidates(task, options)
  return { candidate: result.candidates[0] ?? null, searched: result.searched }
}
