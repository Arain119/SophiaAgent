export type AgentExecutionRoute = {
  model: string
  provider?: string
  cacheAffinity: 'main-prefix' | 'subagent-chain'
}

export function resolveAgentExecutionRoute({
  isExactContext,
  mainModel,
  subagentModel,
  mainProvider,
  subagentProvider,
}: {
  isExactContext: boolean
  mainModel: string
  subagentModel: string
  mainProvider?: string
  subagentProvider?: string
}): AgentExecutionRoute {
  return isExactContext
    ? {
        model: mainModel,
        provider: mainProvider,
        cacheAffinity: 'main-prefix',
      }
    : {
        model: subagentModel,
        provider: subagentProvider,
        cacheAffinity: 'subagent-chain',
      }
}
