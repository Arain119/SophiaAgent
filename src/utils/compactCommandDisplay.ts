const MAX_COMMAND_DISPLAY_CHARS = 72

function executableName(value: string): string {
  const match = value.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)
  const firstToken = match?.slice(1).find(Boolean) ?? 'command'
  return firstToken.replaceAll('\\', '/').split('/').at(-1) ?? firstToken
}

export function compactCommandDisplay(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (/<<\s*['"]?[A-Za-z0-9_-]+['"]?/.test(value) || /\r?\n/.test(value)) {
    return `${executableName(value)} (inline script)`
  }
  return compact.length > MAX_COMMAND_DISPLAY_CHARS
    ? `${compact.slice(0, MAX_COMMAND_DISPLAY_CHARS - 1)}...`
    : compact
}
