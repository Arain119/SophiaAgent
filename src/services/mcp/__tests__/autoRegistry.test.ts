import { afterEach, describe, expect, test } from 'bun:test'
import {
  findAutoMcpCandidates,
  findBestAutoMcp,
  getMcpSearchQueries,
  parseRegistryCandidates,
} from '../autoRegistry.js'

const originalRenderKey = process.env.RENDER_API_KEY

afterEach(() => {
  if (originalRenderKey === undefined) delete process.env.RENDER_API_KEY
  else process.env.RENDER_API_KEY = originalRenderKey
})

function registryEntry(overrides: Record<string, unknown> = {}): unknown {
  return {
    server: {
      name: 'io.github.example/render-deploy',
      title: 'Render Deployment',
      description: 'Deploy applications to Render',
      version: '1.2.0',
      repository: {
        url: 'https://github.com/example/render-deploy',
        source: 'github',
      },
      remotes: [],
      packages: [],
      ...overrides,
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        status: 'active',
        isLatest: true,
      },
    },
  }
}

function response(value: unknown): Response {
  return Response.json(value)
}

describe('getMcpSearchQueries', () => {
  test('sanitizes private context and adds keyword fallbacks', () => {
    const queries = getMcpSearchQueries(
      'Deploy to Render C:\\private\\app https://internal.example/token',
    )

    expect(queries[0]).toBe('Deploy to Render')
    expect(queries).toContain('render')
  })
})

describe('parseRegistryCandidates', () => {
  test('accepts only active latest entries', () => {
    const inactive = registryEntry()
    ;(
      inactive as {
        _meta: {
          'io.modelcontextprotocol.registry/official': { status: string }
        }
      }
    )._meta['io.modelcontextprotocol.registry/official'].status = 'deprecated'

    expect(parseRegistryCandidates({ servers: [inactive] }, 'render')).toEqual(
      [],
    )
  })

  test('accepts credential-free public HTTPS remotes', () => {
    const candidates = parseRegistryCandidates(
      {
        servers: [
          registryEntry({
            remotes: [
              {
                type: 'streamable-http',
                url: 'https://mcp.render.example/api',
              },
            ],
          }),
        ],
      },
      'render deployment',
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.transport).toBe('http')
    expect(candidates[0]?.config).toMatchObject({
      type: 'http',
      url: 'https://mcp.render.example/api',
      scope: 'dynamic',
    })
  })

  test('rejects unsafe remote URLs', () => {
    const remotes = [
      'http://mcp.example.com/api',
      'https://localhost/api',
      'https://127.0.0.1/api',
      'https://10.0.0.1/api',
      'https://192.168.1.2/api',
      'https://[::1]/api',
      'https://mcp.example.com:8443/api',
      'https://{tenant}.example.com/api',
    ].map(url => ({ type: 'streamable-http', url }))

    expect(
      parseRegistryCandidates(
        { servers: [registryEntry({ remotes })] },
        'render',
      ),
    ).toEqual([])
  })

  test('reports required remote headers without creating a config', () => {
    const [candidate] = parseRegistryCandidates(
      {
        servers: [
          registryEntry({
            remotes: [
              {
                type: 'streamable-http',
                url: 'https://mcp.render.example/api',
                headers: [{ name: 'Authorization' }],
              },
            ],
          }),
        ],
      },
      'render',
    )

    expect(candidate?.config).toBeNull()
    expect(candidate?.requirements).toEqual(['Authorization'])
  })

  test('requires a GitHub-backed exact npm package from the official registry', () => {
    const packageDefinition = {
      registryType: 'npm',
      registryBaseUrl: 'https://registry.npmjs.org',
      identifier: 'render-useful-mcp',
      version: '1.2.0',
      transport: { type: 'stdio' },
    }
    const accepted = parseRegistryCandidates(
      { servers: [registryEntry({ packages: [packageDefinition] })] },
      'render',
    )
    const nonGitHub = registryEntry({
      repository: {
        url: 'https://gitlab.com/example/render',
        source: 'gitlab',
      },
      packages: [packageDefinition],
    })
    const floating = registryEntry({
      packages: [{ ...packageDefinition, version: 'latest' }],
    })

    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.transport).toBe('npm')
    expect(parseRegistryCandidates({ servers: [nonGitHub] }, 'render')).toEqual(
      [],
    )
    expect(parseRegistryCandidates({ servers: [floating] }, 'render')).toEqual(
      [],
    )
  })

  test('reports missing npm environment variables and pins runnable packages', () => {
    delete process.env.RENDER_API_KEY
    const packageDefinition = {
      registryType: 'npm',
      identifier: 'render-useful-mcp',
      version: '1.2.0',
      transport: { type: 'stdio' },
      environmentVariables: [
        { name: 'RENDER_API_KEY', isRequired: true, isSecret: true },
      ],
    }
    const [missing] = parseRegistryCandidates(
      { servers: [registryEntry({ packages: [packageDefinition] })] },
      'render',
    )
    process.env.RENDER_API_KEY = 'available'
    const [runnable] = parseRegistryCandidates(
      { servers: [registryEntry({ packages: [packageDefinition] })] },
      'render',
    )

    expect(missing?.requirements).toEqual(['RENDER_API_KEY'])
    expect(missing?.config).toBeNull()
    expect(runnable?.requirements).toEqual([])
    expect(runnable?.config).toMatchObject({
      type: 'stdio',
      args: expect.arrayContaining(['render-useful-mcp@1.2.0']),
      scope: 'dynamic',
    })
  })

  test('ranks product-name matches above description-only matches', () => {
    const candidates = parseRegistryCandidates(
      {
        servers: [
          registryEntry({
            name: 'io.github.example/generic',
            title: 'Generic Cloud Tool',
            description: 'Includes Render deployment support',
            remotes: [{ type: 'sse', url: 'https://generic.example.com/mcp' }],
          }),
          registryEntry({
            remotes: [{ type: 'sse', url: 'https://render.example.com/mcp' }],
          }),
        ],
      },
      'render',
    )

    expect(candidates[0]?.title).toBe('Render Deployment')
  })
})

describe('findAutoMcpCandidates', () => {
  test('uses full-query and keyword searches', async () => {
    const requests: string[] = []
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(String(input))
      return response({ servers: [] })
    }

    await findAutoMcpCandidates('Render deployment', { fetchImpl })

    expect(requests.some(url => url.includes('search=Render+deployment'))).toBe(
      true,
    )
    expect(requests.some(url => url.includes('search=render'))).toBe(true)
  })

  test('keeps the product keyword and ranks it above generic action matches', async () => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      const search = new URL(url).searchParams.get('search')
      if (search === 'render') {
        return response({
          servers: [
            registryEntry({
              remotes: [{ type: 'sse', url: 'https://render.example.com/mcp' }],
            }),
          ],
        })
      }
      if (search === 'deploy') {
        return response({
          servers: [
            registryEntry({
              name: 'io.github.example/deploy-helper',
              title: 'Deploy Helper',
              description: 'Deploy any application',
              remotes: [{ type: 'sse', url: 'https://deploy.example.com/mcp' }],
            }),
          ],
        })
      }
      return response({ servers: [] })
    }

    const result = await findBestAutoMcp('deploy this service to Render', {
      fetchImpl,
    })

    expect(result.candidate?.title).toBe('Render Deployment')
  })

  test('does not substitute an unrelated action match when the product query fails', async () => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const search = new URL(String(input)).searchParams.get('search')
      if (search === 'render')
        return new Response('unavailable', { status: 503 })
      if (search === 'deploy') {
        return response({
          servers: [
            registryEntry({
              name: 'io.github.example/deploy-helper',
              title: 'Deploy Helper',
              description: 'Deploy any application',
              remotes: [{ type: 'sse', url: 'https://deploy.example.com/mcp' }],
            }),
          ],
        })
      }
      return response({ servers: [] })
    }

    const result = await findBestAutoMcp('deploy this service to Render', {
      fetchImpl,
    })

    expect(result.candidate).toBeNull()
  })

  test('rejects npm packages without integrity metadata', async () => {
    process.env.RENDER_API_KEY = 'available'
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url.startsWith('https://registry.npmjs.org/')) {
        return response({ dist: {} })
      }
      return response({
        servers: [
          registryEntry({
            packages: [
              {
                registryType: 'npm',
                identifier: 'render-useful-mcp',
                version: '1.2.0',
                transport: { type: 'stdio' },
              },
            ],
          }),
        ],
      })
    }

    const result = await findBestAutoMcp('render', { fetchImpl })

    expect(result.candidate).toBeNull()
  })
})
