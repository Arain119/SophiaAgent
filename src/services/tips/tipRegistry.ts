import { getInitialSettings } from '../../utils/settings/settings.js'
import { getSessionsSinceLastShown } from './tipHistory.js'
import type { Tip, TipContext } from './types.js'

const coreTips: Tip[] = [
  {
    id: 'describe-outcome',
    content: async () =>
      'Describe the outcome you want; Sophia will choose tools, agents, skills, and MCP services as needed',
    cooldownSessions: 3,
  },
  {
    id: 'provider-settings',
    content: async () =>
      'Use /model to manage endpoints, models, and preferred providers',
    cooldownSessions: 8,
  },
  {
    id: 'effort-setting',
    content: async () => 'Use /effort to set how deeply the main agent reasons',
    cooldownSessions: 8,
  },
  {
    id: 'project-memory',
    content: async () => 'Put durable project instructions in SOPHIA.md',
    cooldownSessions: 10,
  },
]

function getCustomTips(): Tip[] {
  const override = getInitialSettings().spinnerTipsOverride
  if (!override?.tips?.length) return []

  return override.tips.map((content, index) => ({
    id: `custom-tip-${index}`,
    content: async () => content,
    cooldownSessions: 0,
  }))
}

export async function getRelevantTips(context?: TipContext): Promise<Tip[]> {
  const override = getInitialSettings().spinnerTipsOverride
  const customTips = getCustomTips()
  if (override?.excludeDefault && customTips.length > 0) return customTips

  const relevant = await Promise.all(
    coreTips.map(tip => tip.isRelevant?.(context) ?? true),
  )
  const builtIn = coreTips
    .filter((_, index) => relevant[index])
    .filter(tip => getSessionsSinceLastShown(tip.id) >= tip.cooldownSessions)

  return [...builtIn, ...customTips]
}
