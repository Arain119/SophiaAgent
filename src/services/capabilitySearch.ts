const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'on',
  'this',
  'that',
  'these',
  'those',
  'please',
  'can',
  'could',
  'would',
  'need',
  'needs',
  'want',
  'help',
  'make',
  'project',
  'repository',
  'repo',
  'using',
  'via',
  'into',
  'my',
  'our',
  'your',
  'the',
  'to',
  'use',
  'with',
])

export function normalizeCapabilityQuery(task: string): string {
  return task
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[A-Za-z]:\\\S+|\/(?:[^\s/]+\/)+[^\s]*/g, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, ' ')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export function capabilityQueryTerms(value: string): string[] {
  const terms = value
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._-]{1,}|[\u3400-\u9fff]{2,}/g)
  return [...new Set((terms ?? []).filter(term => !STOP_WORDS.has(term)))]
}
