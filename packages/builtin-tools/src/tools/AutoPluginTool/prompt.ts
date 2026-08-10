export function getPrompt(): string {
  return `Use this tool when you judge that the current task needs a persistent capability that the built-in tools, available Skills, and connected MCP servers do not provide.

Describe the missing capability with concise, specific English product or domain keywords. Sophia searches only marketplaces the user has already configured, selects at most one strong match, installs it automatically, and refreshes the current session. Always tell the user which plugin was installed and which marketplace supplied it.

Do not use this tool merely because a plugin might be convenient. Prefer built-in tools for ordinary coding, Skills for instructions and workflows, and MCP for temporary access to an external system. Do not call it repeatedly after no strong match or an installation failure.`
}
