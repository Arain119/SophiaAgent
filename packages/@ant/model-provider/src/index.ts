// @ant/model-provider
// Model provider abstraction layer for Claude Code
//
// This package owns the model calling logic and provides:
// - Core query functions (queryModelWithStreaming, etc.)
// - OpenAI Responses model mapping and conversion utilities
// - Type definitions (Message, Tool, Usage, etc.)
// - Dependency injection hooks (analytics, cost tracking, etc.)
//
// Initialization:
//   registerHooks({ ... })            // inject analytics/cost/logging

// Hooks (dependency injection)
export { registerHooks, getHooks } from './hooks/index.js'
export type { ModelProviderHooks } from './hooks/types.js'

// Types
export * from './types/index.js'

// Provider model mapping
export { resolveOpenAIModel } from './providers/openai/modelMapping.js'

// Error utilities
export {
  formatAPIError,
  extractConnectionErrorDetails,
  sanitizeAPIError,
  getSSLErrorHint,
  type ConnectionErrorDetails,
} from './errorUtils.js'

// Shared OpenAI conversion utilities
export { anthropicMessagesToOpenAI } from './shared/openaiConvertMessages.js'
export type { ConvertMessagesOptions } from './shared/openaiConvertMessages.js'
export {
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
} from './shared/openaiConvertTools.js'
export {
  normalizeOpenAIUsage,
  type AnthropicUsage,
} from './shared/openaiUsage.js'
