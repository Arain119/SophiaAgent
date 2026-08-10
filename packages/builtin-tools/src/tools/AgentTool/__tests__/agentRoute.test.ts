import { describe, expect, test } from 'bun:test'
import { resolveAgentExecutionRoute } from '../agentRoute.js'

describe('resolveAgentExecutionRoute', () => {
  const routes = {
    mainModel: 'main-model',
    subagentModel: 'sub-model',
    mainProvider: 'main-provider',
    subagentProvider: 'sub-provider',
  }

  test('routes exact-context forks through the main cache identity', () => {
    expect(
      resolveAgentExecutionRoute({ ...routes, isExactContext: true }),
    ).toEqual({
      model: 'main-model',
      provider: 'main-provider',
      cacheAffinity: 'main-prefix',
    })
  })

  test('routes ordinary subagents through the configured subagent chain', () => {
    expect(
      resolveAgentExecutionRoute({ ...routes, isExactContext: false }),
    ).toEqual({
      model: 'sub-model',
      provider: 'sub-provider',
      cacheAffinity: 'subagent-chain',
    })
  })
})
