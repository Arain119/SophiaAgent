import { isEssentialTrafficOnly } from './privacyLevel.js'

let fired = false

/** Warm the configured Responses endpoint while the user is still typing. */
export function preconnectProviderApi(): void {
  if (fired) return
  fired = true
  if (isEssentialTrafficOnly()) return
  // Do not contact a public endpoint before the user configures a provider.
  if (!process.env.OPENAI_BASE_URL || !process.env.OPENAI_API_KEY) return
  if (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.SOPHIA_CLIENT_CERT ||
    process.env.SOPHIA_CLIENT_KEY
  ) {
    return
  }

  const baseUrl = process.env.OPENAI_BASE_URL.replace(/\/+$/, '')
  void fetch(`${baseUrl}/responses`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}
