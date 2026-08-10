import { feature } from 'bun:bundle'

export function filterAllowedSdkBetas(
  _sdkBetas: string[] | undefined,
): undefined {
  return undefined
}

export function modelSupportsISP(_model: string): boolean {
  return false
}

export function modelSupportsContextManagement(_model: string): boolean {
  return false
}

export function modelSupportsStructuredOutputs(_model: string): boolean {
  return false
}

export function modelSupportsAutoMode(_model: string): boolean {
  return feature('TRANSCRIPT_CLASSIFIER') ? true : false
}

export function shouldIncludeFirstPartyOnlyBetas(): boolean {
  return false
}

export function shouldUseGlobalCacheScope(): boolean {
  return false
}

export function getAllModelBetas(_model: string): string[] {
  return []
}

export function getModelBetas(_model: string): string[] {
  return []
}

export function getMergedBetas(
  _model: string,
  _options?: { isAgenticQuery?: boolean },
): string[] {
  return []
}

export function clearBetasCaches(): void {}
