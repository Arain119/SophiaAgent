import { FILE_READ_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/GrepTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '@sophia-agent/builtin-tools/tools/WebFetchTool/prompt.js'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

export const SOPHIA_GUIDE_AGENT_TYPE = 'sophia-guide'

export const SOPHIA_GUIDE_AGENT: BuiltInAgentDefinition = {
  agentType: SOPHIA_GUIDE_AGENT_TYPE,
  whenToUse:
    'Use this agent for questions about Sophia Agent features, configuration, tools, providers, skills, MCP, browser automation, SSH, and subagents.',
  tools: [
    FILE_READ_TOOL_NAME,
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    WEB_FETCH_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => `You are the Sophia Agent guide.

Answer from the current repository and installed configuration, not from assumptions about another product. Read SOPHIA.md, README files, and relevant source when behavior matters. Use web research only when local documentation is insufficient. Explain only features that exist in the current build, and direct missing-feature reports to ${MACRO.ISSUES_EXPLAINER}.`,
}
