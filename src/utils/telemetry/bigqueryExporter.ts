import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import {
  AggregationTemporality,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'

/** Local-only exporter. Sophia does not send telemetry to a cloud endpoint. */
export class BigQueryMetricsExporter implements PushMetricExporter {
  constructor(_options: { timeout?: number } = {}) {}

  export(
    _metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): void {
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async shutdown(): Promise<void> {}

  async forceFlush(): Promise<void> {}

  selectAggregationTemporality(): AggregationTemporality {
    return AggregationTemporality.DELTA
  }
}
