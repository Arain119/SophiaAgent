export type EventSamplingConfig = Record<string, number>

export function getEventSamplingConfig(): EventSamplingConfig {
  return {}
}

export function shouldSampleEvent(_eventName: string): null {
  return null
}

export async function shutdown1PEventLogging(): Promise<void> {}

export function is1PEventLoggingEnabled(): boolean {
  return false
}

export function logEventTo1P(_eventName: string, _metadata?: unknown): void {}

export type GrowthBookExperimentData = {
  experimentId: string
  variationId: number
  userAttributes: Record<string, unknown>
  experimentMetadata?: Record<string, unknown>
}

export function logGrowthBookExperimentTo1P(
  _data: GrowthBookExperimentData,
): void {}

export function initialize1PEventLogging(): void {}

export async function reinitialize1PEventLoggingIfConfigChanged(): Promise<void> {}
