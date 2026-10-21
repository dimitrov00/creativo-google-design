/**
 * Logging and error tracking — the law's signatures VERBATIM
 * (`.claude/rules/ecs-pipelines.md`, blueprint §4.3), so a pipeline calls
 * `ports.log('warn', 'booking.rejected', { code })` exactly as the rule's
 * example does. `fields?`/`context?` are optional FUNCTION parameters, which
 * the optional-property guard leaves legal; no `LogEvent`/`ErrorContext`
 * struct is invented.
 *
 * Implemented by `apps/functions/src/adapters/console-telemetry.adapter.ts`
 * over `firebase-functions/logger` today (§9 D11(a)); Pino and Sentry
 * adapters join when those packages are installed — the ports are the same
 * either way. Invoked only in the edge and in a pipeline's write half;
 * systems never log.
 */

export type Log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields?: Record<string, unknown>,
) => void;

export type TrackError = (
  error: unknown,
  context?: Record<string, unknown>,
) => void;

/** The structured log alone — what most pipelines report through. */
export type LogPorts = {
  readonly log: Log;
};

/** The error tracker. */
export type ErrorTrackingPorts = {
  readonly trackError: TrackError;
};

/** The telemetry bundle the composition root builds once per cold start. */
export type TelemetryPorts = LogPorts & ErrorTrackingPorts;
