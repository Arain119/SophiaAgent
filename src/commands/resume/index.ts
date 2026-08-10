import type { Command } from '../../commands.js'

const resume: Command = {
  type: 'local-jsx',
  name: 'resume',
  description: 'Resume a previous conversation',
  argumentHint: '[conversation id or search term]',
  load: () => import('./resume.js'),
}

export default resume
