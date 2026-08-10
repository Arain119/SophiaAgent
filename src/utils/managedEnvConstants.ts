/**
 * Environment variables that control inference routing: which provider to use,
 * which endpoint to hit, and which model IDs to send.
 *
 * When SOPHIA_PROVIDER_MANAGED_BY_HOST is truthy in the spawn env, these
 * are stripped from settings-sourced env so the host's routing config isn't
 * overridden by a user's ~/.sophia/settings.json, for example a custom
 * endpoint that would break a host with fixed routing.
 *
 * @[MODEL LAUNCH]: New models usually don't need changes here. New providers
 * or routing config vars (endpoint, project, region, auth) do.
 *
 * OpenAI API key, base URL, and configured routing model are provider-managed so
 * host routing cannot be overridden by settings.
 */
const PROVIDER_MANAGED_ENV_VARS = new Set([
  // Settings cannot unset the flag once the host sets it.
  'SOPHIA_PROVIDER_MANAGED_BY_HOST',
  // Endpoint config (base URLs, project/resource identifiers)
  'OPENAI_BASE_URL',
  // Auth
  'OPENAI_API_KEY',
  // Active model IDs use provider-specific formats.
  // OpenAI provider specific
  'OPENAI_MODEL',
])

export function isProviderManagedEnvVar(key: string): boolean {
  return PROVIDER_MANAGED_ENV_VARS.has(key.toUpperCase())
}

/**
 * Dangerous shell settings that can execute arbitrary shell code
 */
export const DANGEROUS_SHELL_SETTINGS = [
  'otelHeadersHelper',
  'statusLine',
] as const

/**
 * Safe environment variables that can be applied before trust dialog.
 * These are Sophia Agent specific settings that don't pose security risks.
 *
 * IMPORTANT: This is the source of truth for which env vars are safe.
 * Any env var NOT in this list is considered dangerous and will trigger
 * a security dialog when set via remote managed settings.
 *
 * Dangerous env vars (NOT in this list):
 *
 * === REDIRECT TO ATTACKER-CONTROLLED SERVER ===
 * - OPENAI_BASE_URL
 * - HTTP_PROXY, HTTPS_PROXY, NO_PROXY, http_proxy, https_proxy, no_proxy
 * - OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
 *
 * === TRUST ATTACKER-CONTROLLED SERVER ===
 * - NODE_TLS_REJECT_UNAUTHORIZED
 * - NODE_EXTRA_CA_CERTS
 *
 * === SWITCH TO ATTACKER-CONTROLLED PROJECT ===
 * - OPENAI_API_KEY
 */
export const SAFE_ENV_VARS = new Set([
  // OpenAI provider specific
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ENABLE_THINKING',
  'OPENAI_MAX_TOKENS',
  'OPENAI_MODEL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'BASH_MAX_TIMEOUT_MS',
  'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'SOPHIA_DISABLE_EXPERIMENTAL_BETAS',
  'SOPHIA_DISABLE_NONESSENTIAL_TRAFFIC',
  'SOPHIA_DISABLE_TERMINAL_TITLE',
  'SOPHIA_ENABLE_TELEMETRY',
  'SOPHIA_EXPERIMENTAL_AGENT_TEAMS',
  'SOPHIA_IDE_SKIP_AUTO_INSTALL',
  'SOPHIA_MAX_OUTPUT_TOKENS',
  'DISABLE_AUTOUPDATER',
  'DISABLE_BUG_COMMAND',
  'DISABLE_COST_WARNINGS',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_FEEDBACK_COMMAND',
  'DISABLE_TELEMETRY',
  'ENABLE_SEARCH_EXTRA_TOOLS',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_THINKING_TOKENS',
  'MCP_TIMEOUT',
  'MCP_TOOL_TIMEOUT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE',
  'OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'OTEL_LOG_TOOL_DETAILS',
  'OTEL_LOG_USER_PROMPTS',
  'OTEL_LOGS_EXPORT_INTERVAL',
  'OTEL_LOGS_EXPORTER',
  'OTEL_METRIC_EXPORT_INTERVAL',
  'OTEL_METRICS_EXPORTER',
  'OTEL_METRICS_INCLUDE_ACCOUNT_UUID',
  'OTEL_METRICS_INCLUDE_SESSION_ID',
  'OTEL_METRICS_INCLUDE_VERSION',
  'OTEL_RESOURCE_ATTRIBUTES',
  'USE_BUILTIN_RIPGREP',
])
