import {
  type AnalyticsCallPorts,
  Callables,
  type GatewayPorts,
} from '@core/ports';

/**
 * THE STAFF «АНАЛИЗИ» CALLABLES as the web's `AnalyticsCallPorts`
 * (`docs/designs/staff-analytics.md`, The screen; v2 PR 6, «Goals»):
 * `staffAnalytics` and `setAnalyticsGoal` dialled through the ONE typed
 * callable client (`gateway.callableClient`) — the request the call struct
 * the screen's store built (the scope and the period; the scope, month and
 * range), sent as it is (the client adds the transport operation id); the
 * answer decoded by the call component's own decoder
 * (`AnalyticsCall.decodeReport`, `SetAnalyticsGoalCall.decodeSet`, looked
 * up in `CALLABLE_ANSWER_DECODERS`); a failure the one `PipelineError`
 * classification. Nothing is added or read here.
 */
export const analyticsCallPorts = (
  gateway: GatewayPorts,
): AnalyticsCallPorts => ({
  requestReport: gateway.callableClient(Callables.StaffAnalytics),
  setAnalyticsGoal: gateway.callableClient(Callables.SetAnalyticsGoal),
});
