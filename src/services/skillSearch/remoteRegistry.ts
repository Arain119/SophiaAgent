import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { getSophiaConfigHomeDir } from '../../utils/envUtils.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { normalizeCapabilityQuery } from '../capabilitySearch.js'

const SEARCH_ENDPOINT = 'https://skills.sh/api/search'
const AUDIT_ENDPOINT = 'https://add-skill.vercel.sh/audit'
const GITHUB_API = 'https://api.github.com'
const GITHUB_RAW = 'https://raw.githubusercontent.com'
const REQUEST_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_CANDIDATES = 5
const MAX_SKILL_FILES = 48
const MAX_SKILL_FILE_BYTES = 256 * 1024
const MAX_SKILL_TOTAL_BYTES = 1024 * 1024

export type RegistrySkill = {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
  score: number
}

type AuditEntry = {
  risk?: string
  alerts?: number
}

export type GitHubTreeEntry = {
  path: string
  mode: string
  type: string
  size?: number
}

export type RemoteSkill = {
  name: string
  description: string
  source: string
  commit: string
  skillPath: string
  skillRoot: string
  content: string
  score: number
  cacheHit: boolean
}

export type RemoteRegistryOptions = {
  fetchImpl?: FetchLike
  configHome?: string
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export function rankRegistrySkills(value: unknown): RegistrySkill[] {
  if (!value || typeof value !== 'object' || !('skills' in value)) return []
  const skills = (value as { skills?: unknown }).skills
  if (!Array.isArray(skills)) return []

  const parsed = skills.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Record<string, unknown>
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.skillId !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.source !== 'string' ||
      !/^[-\w.]+\/[-\w.]+$/.test(candidate.source)
    ) {
      return []
    }
    const installs =
      typeof candidate.installs === 'number' && candidate.installs >= 0
        ? candidate.installs
        : 0
    return [
      {
        id: candidate.id,
        skillId: candidate.skillId,
        name: candidate.name,
        installs,
        source: candidate.source,
        index,
      },
    ]
  })
  if (parsed.length === 0) return []

  const maxPopularity = Math.max(
    1,
    ...parsed.map(candidate => Math.log1p(candidate.installs)),
  )
  return parsed
    .map(candidate => ({
      id: candidate.id,
      skillId: candidate.skillId,
      name: candidate.name,
      installs: candidate.installs,
      source: candidate.source,
      score:
        0.8 * (1 - candidate.index / Math.max(skills.length, 1)) +
        0.2 * (Math.log1p(candidate.installs) / maxPopularity),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
}

export function isAuditAcceptable(value: unknown, skillId: string): boolean {
  if (!value || typeof value !== 'object') return false
  const skillAudit = (value as Record<string, unknown>)[skillId]
  if (!skillAudit || typeof skillAudit !== 'object') return false
  const entries = Object.values(skillAudit as Record<string, AuditEntry>)
  if (entries.length === 0) return false
  return entries.every(entry => {
    const risk = entry?.risk?.toLowerCase()
    return (
      (risk === 'safe' || risk === 'low') &&
      (entry.alerts === undefined || entry.alerts === 0)
    )
  })
}

export function selectSkillDirectory(
  tree: GitHubTreeEntry[],
  skillId: string,
): string | null {
  const normalizedId = normalizeIdentifier(skillId)
  const skillFiles = tree.filter(
    entry =>
      entry.type === 'blob' &&
      basename(entry.path).toLowerCase() === 'skill.md',
  )
  const exact = skillFiles.filter(
    entry =>
      normalizeIdentifier(basename(dirname(entry.path))) === normalizedId,
  )
  const candidates =
    exact.length > 0
      ? exact
      : skillFiles.filter(entry =>
          entry.path
            .split('/')
            .some(segment => normalizeIdentifier(segment) === normalizedId),
        )
  if (candidates.length === 0 && skillFiles.length === 1) {
    return dirname(skillFiles[0]!.path).replaceAll('\\', '/')
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.path.length - b.path.length)
  return dirname(candidates[0]!.path).replaceAll('\\', '/')
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function assertInside(base: string, target: string): void {
  const normalizedBase = resolve(base)
  const normalizedTarget = resolve(target)
  if (
    normalizedTarget !== normalizedBase &&
    !normalizedTarget.startsWith(`${normalizedBase}${sep}`)
  ) {
    throw new Error('Remote skill path escaped its cache directory')
  }
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 80)
}

async function fetchBytes(
  fetchImpl: FetchLike,
  url: string,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<Uint8Array> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Sophia-Agent/0.1',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Remote skill request failed with HTTP ${response.status}`)
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Remote skill response exceeded the size limit')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) {
    throw new Error('Remote skill response exceeded the size limit')
  }
  return bytes
}

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const bytes = await fetchBytes(fetchImpl, url)
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function readCachedSkill(
  targetDir: string,
  candidate: RegistrySkill,
): Promise<RemoteSkill | null> {
  try {
    const marker = JSON.parse(
      await readFile(join(targetDir, '.sophia-remote-skill.json'), 'utf8'),
    ) as Record<string, unknown>
    if (
      marker.registryId !== candidate.id ||
      marker.source !== candidate.source ||
      typeof marker.commit !== 'string' ||
      !marker.files ||
      typeof marker.files !== 'object' ||
      Array.isArray(marker.files)
    ) {
      return null
    }
    const fileDigests = Object.entries(marker.files as Record<string, unknown>)
    if (
      fileDigests.length === 0 ||
      fileDigests.length > MAX_SKILL_FILES ||
      !fileDigests.some(([path]) => path === 'SKILL.md')
    ) {
      return null
    }
    for (const [path, digest] of fileDigests) {
      if (typeof digest !== 'string') return null
      const filePath = join(targetDir, path)
      assertInside(targetDir, filePath)
      const bytes = await readFile(filePath)
      if (createHash('sha256').update(bytes).digest('hex') !== digest) {
        return null
      }
    }
    const skillPath = join(targetDir, 'SKILL.md')
    const raw = await readFile(skillPath, 'utf8')
    const parsed = parseFrontmatter(raw, skillPath)
    return {
      name:
        typeof parsed.frontmatter.name === 'string'
          ? parsed.frontmatter.name
          : candidate.name,
      description:
        typeof parsed.frontmatter.description === 'string'
          ? parsed.frontmatter.description
          : candidate.name,
      source: candidate.source,
      commit: marker.commit,
      skillPath,
      skillRoot: targetDir,
      content: parsed.content,
      score: candidate.score,
      cacheHit: true,
    }
  } catch {
    return null
  }
}

async function downloadCandidate(
  fetchImpl: FetchLike,
  candidate: RegistrySkill,
  configHome: string,
): Promise<RemoteSkill> {
  const skillsRoot = join(configHome, 'skills')
  await mkdir(skillsRoot, { recursive: true })
  const targetDir = join(
    skillsRoot,
    `.auto-${safeSegment(candidate.source)}-${safeSegment(candidate.skillId)}`,
  )
  assertInside(skillsRoot, targetDir)
  const cached = await readCachedSkill(targetDir, candidate)
  if (cached) return cached
  await rm(targetDir, { recursive: true, force: true })

  const repo = (await fetchJson(
    fetchImpl,
    `${GITHUB_API}/repos/${candidate.source}`,
  )) as Record<string, unknown>
  if (repo.private === true || repo.archived === true) {
    throw new Error('Remote skill repository is private or archived')
  }
  if (typeof repo.default_branch !== 'string') {
    throw new Error('Remote skill repository has no default branch')
  }
  const commitInfo = (await fetchJson(
    fetchImpl,
    `${GITHUB_API}/repos/${candidate.source}/commits/${encodeURIComponent(repo.default_branch)}`,
  )) as Record<string, unknown>
  if (
    typeof commitInfo.sha !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(commitInfo.sha)
  ) {
    throw new Error('Remote skill repository returned an invalid commit')
  }
  const commit = commitInfo.sha
  const treeResponse = (await fetchJson(
    fetchImpl,
    `${GITHUB_API}/repos/${candidate.source}/git/trees/${commit}?recursive=1`,
  )) as Record<string, unknown>
  if (treeResponse.truncated === true || !Array.isArray(treeResponse.tree)) {
    throw new Error('Remote skill repository tree is incomplete')
  }
  const tree = treeResponse.tree.filter((entry): entry is GitHubTreeEntry => {
    if (!entry || typeof entry !== 'object') return false
    const item = entry as Record<string, unknown>
    return (
      typeof item.path === 'string' &&
      typeof item.mode === 'string' &&
      typeof item.type === 'string'
    )
  })
  const skillDir = selectSkillDirectory(tree, candidate.skillId)
  if (skillDir === null)
    throw new Error('Remote skill does not contain SKILL.md')
  const prefix = skillDir === '.' ? '' : `${skillDir}/`
  const files = tree.filter(
    entry => entry.type === 'blob' && entry.path.startsWith(prefix),
  )
  if (files.length === 0 || files.length > MAX_SKILL_FILES) {
    throw new Error('Remote skill contains an invalid number of files')
  }
  let declaredTotal = 0
  for (const file of files) {
    if (file.mode === '120000')
      throw new Error('Remote skill contains a symlink')
    if ((file.size ?? 0) > MAX_SKILL_FILE_BYTES) {
      throw new Error('Remote skill contains an oversized file')
    }
    declaredTotal += file.size ?? 0
  }
  if (declaredTotal > MAX_SKILL_TOTAL_BYTES) {
    throw new Error('Remote skill exceeds the total size limit')
  }

  const tempDir = await mkdtemp(join(skillsRoot, '.skill-download-'))
  assertInside(skillsRoot, tempDir)
  try {
    let actualTotal = 0
    const fileDigests: Record<string, string> = {}
    for (const file of files) {
      const relativePath = file.path.slice(prefix.length)
      const outputPath = join(tempDir, relativePath)
      assertInside(tempDir, outputPath)
      const encodedPath = file.path.split('/').map(encodeURIComponent).join('/')
      const bytes = await fetchBytes(
        fetchImpl,
        `${GITHUB_RAW}/${candidate.source}/${commit}/${encodedPath}`,
        MAX_SKILL_FILE_BYTES,
      )
      actualTotal += bytes.byteLength
      if (actualTotal > MAX_SKILL_TOTAL_BYTES) {
        throw new Error('Remote skill exceeds the total size limit')
      }
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, bytes)
      fileDigests[relativePath.replaceAll('\\', '/')] = createHash('sha256')
        .update(bytes)
        .digest('hex')
    }
    const downloadedSkillPath = join(tempDir, 'SKILL.md')
    const raw = await readFile(downloadedSkillPath, 'utf8')
    const parsed = parseFrontmatter(raw, downloadedSkillPath)
    if (
      typeof parsed.frontmatter.name !== 'string' ||
      typeof parsed.frontmatter.description !== 'string'
    ) {
      throw new Error('Remote SKILL.md is missing name or description')
    }
    await writeFile(
      join(tempDir, '.sophia-remote-skill.json'),
      `${JSON.stringify(
        {
          registryId: candidate.id,
          source: candidate.source,
          commit,
          files: fileDigests,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    try {
      await rename(tempDir, targetDir)
    } catch (error) {
      try {
        await stat(targetDir)
      } catch {
        throw error
      }
    }
    const installed = await readCachedSkill(targetDir, candidate)
    if (!installed) throw new Error('Remote skill cache verification failed')
    return { ...installed, cacheHit: false }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function candidatePassesAudit(
  fetchImpl: FetchLike,
  candidate: RegistrySkill,
): Promise<boolean> {
  const params = new URLSearchParams({
    source: candidate.source,
    skills: candidate.skillId,
  })
  const audit = await fetchJson(fetchImpl, `${AUDIT_ENDPOINT}?${params}`)
  return isAuditAcceptable(audit, candidate.skillId)
}

export async function findBestRemoteSkill(
  task: string,
  options: RemoteRegistryOptions = {},
): Promise<RemoteSkill | null> {
  const query = normalizeCapabilityQuery(task)
  if (!query) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const configHome = options.configHome ?? getSophiaConfigHomeDir()
  const search = await fetchJson(
    fetchImpl,
    `${SEARCH_ENDPOINT}?${new URLSearchParams({ q: query })}`,
  )
  const candidates = rankRegistrySkills(search)
  for (const candidate of candidates) {
    try {
      if (!(await candidatePassesAudit(fetchImpl, candidate))) continue
      return await downloadCandidate(fetchImpl, candidate, configHome)
    } catch {
      // Try the next audited candidate. Skill discovery must never block work.
    }
  }
  return null
}

export function remoteSkillRelativePath(skill: RemoteSkill): string {
  return relative(skill.skillRoot, skill.skillPath).replaceAll('\\', '/')
}
