import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findBestRemoteSkill,
  isAuditAcceptable,
  rankRegistrySkills,
  selectSkillDirectory,
  type GitHubTreeEntry,
} from '../remoteRegistry.js'
import { normalizeCapabilityQuery } from '../../capabilitySearch.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('normalizeCapabilityQuery', () => {
  test('removes content that should not leave the machine', () => {
    const query = normalizeCapabilityQuery(`Review TypeScript
\`\`\`ts
const secret = "hidden"
\`\`\`
https://example.com/private C:\\work\\secret.ts /home/me/secret.ts
person@example.com abcdefghijklmnopqrstuvwxyz1234567890`)

    expect(query).toBe('Review TypeScript')
  })

  test('preserves a concise Chinese task description', () => {
    expect(normalizeCapabilityQuery('检查 TypeScript 单元测试')).toBe(
      '检查 TypeScript 单元测试',
    )
  })
})

describe('rankRegistrySkills', () => {
  test('filters invalid sources and combines relevance with popularity', () => {
    const ranked = rankRegistrySkills({
      skills: [
        {
          id: 'first',
          skillId: 'typescript-review',
          name: 'typescript-review',
          installs: 10,
          source: 'owner/repo',
        },
        {
          id: 'popular',
          skillId: 'typescript-expert',
          name: 'typescript-expert',
          installs: 100_000,
          source: 'other/repo',
        },
        {
          id: 'invalid',
          skillId: 'bad',
          name: 'bad',
          installs: 1_000_000,
          source: 'https://example.com/archive.zip',
        },
      ],
    })

    expect(ranked.map(skill => skill.id)).toEqual(['first', 'popular'])
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
  })
})

describe('isAuditAcceptable', () => {
  test('accepts only complete safe or low-risk audits with no alerts', () => {
    expect(
      isAuditAcceptable(
        {
          review: {
            ath: { risk: 'safe' },
            socket: { risk: 'low', alerts: 0 },
          },
        },
        'review',
      ),
    ).toBe(true)
    expect(
      isAuditAcceptable(
        { review: { socket: { risk: 'high', alerts: 0 } } },
        'review',
      ),
    ).toBe(false)
    expect(
      isAuditAcceptable(
        { review: { socket: { risk: 'safe', alerts: 1 } } },
        'review',
      ),
    ).toBe(false)
    expect(isAuditAcceptable({ review: {} }, 'review')).toBe(false)
  })
})

describe('selectSkillDirectory', () => {
  const tree: GitHubTreeEntry[] = [
    {
      path: 'skills/typescript-review/SKILL.md',
      mode: '100644',
      type: 'blob',
    },
    {
      path: 'skills/react-review/SKILL.md',
      mode: '100644',
      type: 'blob',
    },
  ]

  test('selects the exact skill directory', () => {
    expect(selectSkillDirectory(tree, 'typescript-review')).toBe(
      'skills/typescript-review',
    )
  })

  test('uses a single SKILL.md as an unambiguous fallback', () => {
    expect(selectSkillDirectory([tree[0]!], 'different-name')).toBe(
      'skills/typescript-review',
    )
  })

  test('rejects ambiguous repositories', () => {
    expect(selectSkillDirectory(tree, 'different-name')).toBeNull()
  })
})

describe('findBestRemoteSkill', () => {
  test('audits, pins, downloads, verifies, and reuses a cached skill', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'sophia-skill-test-'))
    temporaryDirectories.push(configHome)
    const commit = 'a'.repeat(40)
    const requests: string[] = []
    const skillDocument = `---
name: typescript-review
description: Review TypeScript code safely
---
Check strict types and tests.
`
    const referenceDocument = 'Use strict mode.\n'
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('https://skills.sh/api/search?')) {
        return Response.json({
          skills: [
            {
              id: 'github/owner/repo/typescript-review',
              skillId: 'typescript-review',
              name: 'typescript-review',
              installs: 100,
              source: 'owner/repo',
            },
          ],
        })
      }
      if (url.startsWith('https://add-skill.vercel.sh/audit?')) {
        return Response.json({
          'typescript-review': {
            ath: { risk: 'safe' },
            socket: { risk: 'low', alerts: 0 },
          },
        })
      }
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({
          private: false,
          archived: false,
          default_branch: 'main',
        })
      }
      if (url === 'https://api.github.com/repos/owner/repo/commits/main') {
        return Response.json({ sha: commit })
      }
      if (
        url ===
        `https://api.github.com/repos/owner/repo/git/trees/${commit}?recursive=1`
      ) {
        return Response.json({
          truncated: false,
          tree: [
            {
              path: 'skills/typescript-review/SKILL.md',
              mode: '100644',
              type: 'blob',
              size: skillDocument.length,
            },
            {
              path: 'skills/typescript-review/reference.md',
              mode: '100644',
              type: 'blob',
              size: referenceDocument.length,
            },
          ],
        })
      }
      if (
        url ===
        `https://raw.githubusercontent.com/owner/repo/${commit}/skills/typescript-review/SKILL.md`
      ) {
        return new Response(skillDocument)
      }
      if (
        url ===
        `https://raw.githubusercontent.com/owner/repo/${commit}/skills/typescript-review/reference.md`
      ) {
        return new Response(referenceDocument)
      }
      return new Response('not found', { status: 404 })
    }

    const first = await findBestRemoteSkill('review TypeScript', {
      configHome,
      fetchImpl,
    })

    expect(first?.commit).toBe(commit)
    expect(first?.cacheHit).toBe(false)
    expect(first?.content).toContain('Check strict types')
    expect(
      requests.some(url =>
        url.includes(`/${commit}/skills/typescript-review/SKILL.md`),
      ),
    ).toBe(true)

    requests.length = 0
    const second = await findBestRemoteSkill('review TypeScript', {
      configHome,
      fetchImpl,
    })

    expect(second?.cacheHit).toBe(true)
    expect(requests.some(url => url.includes('api.github.com'))).toBe(false)

    await writeFile(
      join(second!.skillRoot, 'reference.md'),
      `${referenceDocument}modified`,
      'utf8',
    )
    requests.length = 0
    const repaired = await findBestRemoteSkill('review TypeScript', {
      configHome,
      fetchImpl,
    })

    expect(repaired?.cacheHit).toBe(false)
    expect(await readFile(repaired!.skillPath, 'utf8')).toBe(skillDocument)
    const marker = await readFile(
      join(second!.skillRoot, '.sophia-remote-skill.json'),
      'utf8',
    )
    expect(marker).toContain(commit)
  })

  test('does not contact GitHub when the audit is unsafe', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'sophia-skill-test-'))
    temporaryDirectories.push(configHome)
    const requests: string[] = []
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('https://skills.sh/api/search?')) {
        return Response.json({
          skills: [
            {
              id: 'unsafe',
              skillId: 'unsafe-skill',
              name: 'unsafe-skill',
              installs: 1,
              source: 'owner/repo',
            },
          ],
        })
      }
      return Response.json({
        'unsafe-skill': { socket: { risk: 'high', alerts: 1 } },
      })
    }

    expect(
      await findBestRemoteSkill('unsafe task', { configHome, fetchImpl }),
    ).toBeNull()
    expect(requests.some(url => url.includes('api.github.com'))).toBe(false)
  })
})
