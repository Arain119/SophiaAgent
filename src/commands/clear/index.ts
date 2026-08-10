/**
 * New-session command - minimal metadata only.
 * Implementation is lazy-loaded from clear.ts to reduce startup time.
 * Utility functions:
 * - clearSessionCaches: import from './clear/caches.js'
 * - clearConversation: import from './clear/conversation.js'
 */
import type { Command } from '../../commands.js'

const newSession = {
  type: 'local',
  name: 'new',
  description: 'Start a new session and free the current context',
  supportsNonInteractive: false, // Should just create a new session
  load: () => import('./clear.js'),
} satisfies Command

export default newSession
