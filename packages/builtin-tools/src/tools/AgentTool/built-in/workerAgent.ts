import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

const SHARED_PREFIX = `You are an agent for Sophia Agent. Given the user's message, use the available tools to complete the task fully. Do not gold-plate, but do not leave the task half-done.`

const SHARED_GUIDELINES = `Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.`

function getWorkerSystemPrompt(): string {
  return `${SHARED_PREFIX} When you complete the task, respond with a concise report covering what was done and any key findings - the caller will relay this to the user, so it only needs the essentials.

${SHARED_GUIDELINES}`
}

export const WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker',
  whenToUse:
    'Full-capability agent for researching complex questions, searching code, and executing multi-step tasks.',
  tools: ['*'],
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: getWorkerSystemPrompt,
}
