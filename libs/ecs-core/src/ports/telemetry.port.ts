import type { ClientIssue } from '@core/components';

/**
 * Logging and error tracking — the law's signatures VERBATIM
 * (`.claude/rules/ecs-pipelines.md`, blueprint §4.3), so a pipeline calls
 * `ports.log('warn', 'booking.rejected', { errorCode })` exactly as the rule's
 * example does. `fields?`/`context?` are optional FUNCTION parameters, which
 * the optional-property guard leaves legal; no `LogEvent`/`ErrorContext`
 * struct is invented.
 *
 * Implemented by `apps/functions/src/adapters/console-telemetry.adapter.ts`
 * over `firebase-functions/logger` today (§9 D11(a)); Pino and Sentry
 * adapters join when those packages are installed — the ports are the same
 * either way. Invoked only in the edge and in a pipeline's write half;
 * systems never log.
 *
 * The web's own sink is {@link ReportClientIssues} (OR-34): scrubbed,
 * allowlisted issue structs to the first-party `reportClientIssues`
 * callable, which writes them to Cloud Logging through {@link Log}.
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

/**
 * Hands client issues to the first-party sink (OR-34) — the web's reporter
 * over the `reportClientIssues` callable: deduplicated, at most 20 per page
 * session, sent in batches of 10 (or after 3 s) and flushed when the page
 * hides. Fire-and-forget, like {@link Log}: a reporter never reports itself,
 * so a send that fails is dropped, never answered.
 */
export type ReportClientIssues = (issues: readonly ClientIssue[]) => void;

/** The structured log alone — what most pipelines report through. */
export type LogPorts = {
  readonly log: Log;
};

/** The error tracker. */
export type ErrorTrackingPorts = {
  readonly trackError: TrackError;
};

/** The client issue sink — the web's reporter, one `InjectionToken` (OR-34). */
export type ClientIssuePorts = {
  readonly reportClientIssues: ReportClientIssues;
};

/**
 * The telemetry bundle the composition root builds once per cold start —
 * the server's; the web's {@link ClientIssuePorts} is a bundle of its own.
 */
export type TelemetryPorts = LogPorts & ErrorTrackingPorts;
