import type { ThemeName } from '@anthropic/ink'
import type { FileStateCache } from '../../utils/fileStateCache.js'

export type TipContext = {
  theme?: ThemeName
  readFileState?: FileStateCache
  bashTools?: Set<string>
}

export type Tip = {
  id: string
  content: (context?: TipContext) => Promise<string>
  cooldownSessions: number
  isRelevant?: (context?: TipContext) => Promise<boolean>
}
