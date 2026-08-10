import type { Command } from '../../types/command.js'

const exit = {
  type: 'local-jsx',
  name: 'exit',
  description: 'Exit Sophia Agent',
  immediate: true,
  load: () => import('./exit.js'),
} satisfies Command

export default exit
