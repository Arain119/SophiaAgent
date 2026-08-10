export interface SophiaMode {
  name: string
  slug: string
  description: string
  icon: string
  systemPrompt: string
  model?: string
  ui: {
    accentColor: string
    promptPrefix: string
  }
  responseStyle: {
    verbosity: 'minimal' | 'normal' | 'verbose'
  }
}
