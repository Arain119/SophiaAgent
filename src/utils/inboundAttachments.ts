import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'

export async function resolveAndPrepend(
  _message: unknown,
  content: string | ContentBlockParam[],
): Promise<string | ContentBlockParam[]> {
  return content
}
