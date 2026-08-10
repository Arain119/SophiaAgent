import { readFile } from 'fs/promises'
import { join } from 'path'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import { getSophiaConfigHomeDir } from '../../utils/envUtils.js'
import { getErrnoCode, toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getPromptRuntime } from '../promptRuntime.js'

const MAX_SECTION_LENGTH = 900
const MAX_TOTAL_SESSION_MEMORY_TOKENS = 5000

export const DEFAULT_SESSION_MEMORY_TEMPLATE = `
# Session Title

# Objective and Constraints

# Active Tasks

# Completed Outcomes

# Decisions

# Evidence and Verification

# Blockers and Next Actions
`

function getDefaultUpdatePrompt(): string {
  return `IMPORTANT: This message and these instructions are NOT part of the actual user conversation. Do NOT include any references to "note-taking", "session notes extraction", or these update instructions in the notes content.

Based on the user conversation above (EXCLUDING this note-taking instruction message as well as system prompt, claude.md entries, or any past session summaries), update the session notes file.

The file {{notesPath}} has already been read for you. Here are its current contents:
<current_notes_content>
{{currentNotes}}
</current_notes_content>

Completed task terminal memories are provided separately. Merge durable facts from them and do not copy duplicate outcomes:
<terminal_task_memories>
{{terminalTaskMemories}}
</terminal_task_memories>

Rewrite the entire file into this exact structure:
<memory_template>
{{memoryTemplate}}
</memory_template>

Your ONLY task is to use the Edit tool to replace the complete current file with normalized memory, then stop. Do not call any other tools.

CRITICAL RULES FOR EDITING:
- Use exactly the headers from <memory_template>; remove obsolete headers and all template instruction text.
- Keep only current, decision-relevant state. Replace superseded facts instead of appending chronology.
- Do NOT reference this note-taking process or instructions anywhere in the notes
- Leave a section blank when it has no durable information; never add filler.
- Prefer compact bullets. Preserve exact file paths, function names, decisive error messages, commands, and test outcomes.
- Treat completed task results as terminal outcomes: retain conclusions, evidence, validation, and remaining work, not their step-by-step transcript.
- Do not copy large tool outputs or full artifacts. Record their path plus the decisive excerpt or result needed to resume.
- Do not include information that's already in the SOPHIA.md files included in the context
- Keep each section under ~${MAX_SECTION_LENGTH} tokens and the whole file under ~${MAX_TOTAL_SESSION_MEMORY_TOKENS} tokens.
- Keep "Active Tasks" and "Blockers and Next Actions" synchronized with the latest state.

Use the Edit tool with file_path: {{notesPath}}

Only include insights from the actual user conversation, never from these instructions.`
}

/**
 * Load custom session memory template from file if it exists
 */
export async function loadSessionMemoryTemplate(): Promise<string> {
  const templatePath = join(
    getSophiaConfigHomeDir(),
    'session-memory',
    'config',
    'template.md',
  )

  try {
    return await readFile(templatePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return DEFAULT_SESSION_MEMORY_TEMPLATE
    }
    logError(toError(e))
    return DEFAULT_SESSION_MEMORY_TEMPLATE
  }
}

/**
 * Load custom session memory prompt from file if it exists
 * Custom prompts can be placed at ~/.sophia/session-memory/prompt.md
 * Use {{variableName}} syntax for variable substitution (e.g., {{currentNotes}}, {{notesPath}})
 */
export async function loadSessionMemoryPrompt(): Promise<string> {
  const promptPath = join(
    getSophiaConfigHomeDir(),
    'session-memory',
    'config',
    'prompt.md',
  )

  try {
    return await readFile(promptPath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return getDefaultUpdatePrompt()
    }
    logError(toError(e))
    return getDefaultUpdatePrompt()
  }
}

/**
 * Parse the session memory file and analyze section sizes
 */
function analyzeSectionSizes(content: string): Record<string, number> {
  const sections: Record<string, number> = {}
  const lines = content.split('\n')
  let currentSection = ''
  let currentContent: string[] = []

  for (const line of lines) {
    if (line.startsWith('# ')) {
      if (currentSection && currentContent.length > 0) {
        const sectionContent = currentContent.join('\n').trim()
        sections[currentSection] = roughTokenCountEstimation(sectionContent)
      }
      currentSection = line
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  if (currentSection && currentContent.length > 0) {
    const sectionContent = currentContent.join('\n').trim()
    sections[currentSection] = roughTokenCountEstimation(sectionContent)
  }

  return sections
}

/**
 * Generate reminders for sections that are too long
 */
function generateSectionReminders(
  sectionSizes: Record<string, number>,
  totalTokens: number,
): string {
  const overBudget = totalTokens > MAX_TOTAL_SESSION_MEMORY_TOKENS
  const oversizedSections = Object.entries(sectionSizes)
    .filter(([_, tokens]) => tokens > MAX_SECTION_LENGTH)
    .sort(([, a], [, b]) => b - a)
    .map(
      ([section, tokens]) =>
        `- "${section}" is ~${tokens} tokens (limit: ${MAX_SECTION_LENGTH})`,
    )

  if (oversizedSections.length === 0 && !overBudget) {
    return ''
  }

  const parts: string[] = []

  if (overBudget) {
    parts.push(
      `\n\nCRITICAL: The session memory file is currently ~${totalTokens} tokens, which exceeds the maximum of ${MAX_TOTAL_SESSION_MEMORY_TOKENS} tokens. Rewrite it within budget. Preserve active tasks, blockers, decisions, and verified outcomes; remove chronology and superseded detail.`,
    )
  }

  if (oversizedSections.length > 0) {
    parts.push(
      `\n\n${overBudget ? 'Oversized sections to condense' : 'IMPORTANT: The following sections exceed the per-section limit and MUST be condensed'}:\n${oversizedSections.join('\n')}`,
    )
  }

  return parts.join('')
}

/**
 * Substitute variables in the prompt template using {{variable}} syntax
 */
function substituteVariables(
  template: string,
  variables: Record<string, string>,
): string {
  // Single-pass replacement avoids two bugs: (1) $ backreference corruption
  // (replacer fn treats $ literally), and (2) double-substitution when user
  // content happens to contain {{varName}} matching a later variable.
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.hasOwn(variables, key) ? variables[key]! : match,
  )
}

/**
 * Check if the session memory content is essentially empty (matches the template).
 * This is used to detect if no actual content has been extracted yet,
 * which means we should fall back to legacy compact behavior.
 */
export async function isSessionMemoryEmpty(content: string): Promise<boolean> {
  const template = await loadSessionMemoryTemplate()
  // Compare trimmed content to detect if it's just the template
  return content.trim() === template.trim()
}

export async function buildSessionMemoryUpdatePrompt(
  currentNotes: string,
  notesPath: string,
  terminalTaskMemories = '',
): Promise<string> {
  const promptTemplate = await loadSessionMemoryPrompt()
  const memoryTemplate = await loadSessionMemoryTemplate()

  // Analyze section sizes and generate reminders if needed
  const sectionSizes = analyzeSectionSizes(currentNotes)
  const totalTokens = roughTokenCountEstimation(currentNotes)
  const sectionReminders = generateSectionReminders(sectionSizes, totalTokens)

  // Substitute variables in the prompt
  const runtime = getPromptRuntime()
  const variables = {
    currentNotes,
    memoryTemplate,
    notesPath,
    terminalTaskMemories,
    CLAUDE_EFFORT: runtime.effort,
    CLAUDE_MODEL: runtime.model,
    CLAUDE_CWD: runtime.cwd,
  }

  const basePrompt = substituteVariables(promptTemplate, variables)

  // Add section size reminders and/or total budget warnings
  return basePrompt + sectionReminders
}

/**
 * Truncate session memory sections that exceed the per-section token limit.
 * Used when inserting session memory into compact messages to prevent
 * oversized session memory from consuming the entire post-compact token budget.
 *
 * Returns the truncated content and whether any truncation occurred.
 */
export function truncateSessionMemoryForCompact(content: string): {
  truncatedContent: string
  wasTruncated: boolean
} {
  const lines = content.split('\n')
  const maxCharsPerSection = MAX_SECTION_LENGTH * 4 // roughTokenCountEstimation uses length/4
  const outputLines: string[] = []
  let currentSectionLines: string[] = []
  let currentSectionHeader = ''
  let wasTruncated = false

  for (const line of lines) {
    if (line.startsWith('# ')) {
      const result = flushSessionSection(
        currentSectionHeader,
        currentSectionLines,
        maxCharsPerSection,
      )
      outputLines.push(...result.lines)
      wasTruncated = wasTruncated || result.wasTruncated
      currentSectionHeader = line
      currentSectionLines = []
    } else {
      currentSectionLines.push(line)
    }
  }

  // Flush the last section
  const result = flushSessionSection(
    currentSectionHeader,
    currentSectionLines,
    maxCharsPerSection,
  )
  outputLines.push(...result.lines)
  wasTruncated = wasTruncated || result.wasTruncated

  return {
    truncatedContent: outputLines.join('\n'),
    wasTruncated,
  }
}

function flushSessionSection(
  sectionHeader: string,
  sectionLines: string[],
  maxCharsPerSection: number,
): { lines: string[]; wasTruncated: boolean } {
  if (!sectionHeader) {
    return { lines: sectionLines, wasTruncated: false }
  }

  const sectionContent = sectionLines.join('\n')
  if (sectionContent.length <= maxCharsPerSection) {
    return { lines: [sectionHeader, ...sectionLines], wasTruncated: false }
  }

  // Truncate at a line boundary near the limit
  let charCount = 0
  const keptLines: string[] = [sectionHeader]
  for (const line of sectionLines) {
    if (charCount + line.length + 1 > maxCharsPerSection) {
      break
    }
    keptLines.push(line)
    charCount += line.length + 1
  }
  keptLines.push('\n[... section truncated for length ...]')
  return { lines: keptLines, wasTruncated: true }
}
