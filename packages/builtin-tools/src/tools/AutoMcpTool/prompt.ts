export function getPrompt(): string {
  return `Use this tool only when the current task needs an external system capability that is not already available through the connected MCP tools.

Describe the missing capability and the target system, for example "deploy this service to Render" or "create a Jira issue". Sophia searches the official MCP Registry, prefers a trusted HTTPS remote, and otherwise uses a pinned GitHub-backed npm package with integrity metadata.

Do not use this tool for ordinary web searches, local file edits, or capabilities already provided by an existing MCP server. Missing credentials are reported explicitly. Connections are temporary for the current session and are never silently persisted.`
}
