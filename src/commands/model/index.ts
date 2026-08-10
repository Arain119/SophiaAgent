import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'model',
  description: 'Configure models and preferred providers',
  load: () => import('./model.js'),
} satisfies Command
