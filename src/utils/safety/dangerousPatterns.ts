/**
 * Cross-platform code-execution entry points present on both Unix and Windows.
 * PowerShell safety checks use this list to detect interpreter delegation.
 */
export const CROSS_PLATFORM_CODE_EXEC = [
  'python',
  'python3',
  'python2',
  'node',
  'deno',
  'tsx',
  'ruby',
  'perl',
  'php',
  'lua',
  'npx',
  'bunx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  'bash',
  'sh',
  'ssh',
] as const
