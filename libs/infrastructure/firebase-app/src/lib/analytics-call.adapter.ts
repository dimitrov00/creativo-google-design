import {
  type AnalyticsCallPorts,
  Callables,
  type GatewayPorts,
} from '@core/ports';

/**
 * THE STAFF «АНАЛИЗИ» REPORT as the web's `AnalyticsCallPorts`
 * (`docs/designs/staff-analytics.md`, The screen): `staffAnalytics` dialled
 * through the ONE typed callable client (`gateway.callableClient`) — the
 * request the `AnalyticsCall` the screen's store built (the scope and the
 * period, sent as it is; the client adds the transport operation id), the
 * answer decoded by `AnalyticsCall.decodeReport`, a failure the one
 * `PipelineError` classification. Nothing is added or read here.
 */
export const analyticsCallPorts = (
  gateway: GatewayPorts,
): AnalyticsCallPorts => ({
  requestReport: gateway.callableClient(Callables.StaffAnalytics),
});
