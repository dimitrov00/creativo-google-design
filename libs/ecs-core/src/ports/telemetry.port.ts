import type { ClientIssue } from '@core/components';
import type { KeyedHash } from './tx.port';

/**
 * Logging and error tracking — the law's signatures VERBATIM
 * (`.claude/rules/ecs-pipelines.md`, blueprint §4.3), so a pipeline calls
 * `ports.log('warn', LogEvent.BookingRejected, { errorCode })` exactly as the
 * rule's example does. `fields?`/`context?` are optional FUNCTION parameters, which
 * the optional-property guard leaves legal; no `ErrorContext` struct is
 * invented. The messages are the `LogEvent` dictionary's values
 * (`@core/primitives`, audit-hardening RU-8 / RU-9) — a vocabulary, not a
 * struct: the `msg` parameter stays a `string`, verbatim. A string literal
 * as the message is a lint error (`creativo/no-literal-log-message`, WS-4.6;
 * its two recorded exemptions are RU-37's).
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

/**
 * The correlation fields one invocation binds once (audit-hardening WS-4.2,
 * RU-26): the callable, its operation id, the caller's uid and roles — flat
 * scalars and string arrays only, never a contact value or free text (R36 /
 * T5). Every {@link Log} line written inside the scope carries them, the
 * call's own `fields` winning a name both hold.
 */
export type LogContext = {
  readonly [field: string]:
    string | number | boolean | null | readonly string[];
};

/**
 * Runs `run` inside a log scope holding `context` — the edge binds it once
 * per invocation, behind the {@link Log} port (the adapter keeps the scope;
 * no SDK reaches the core). Answers what `run` answers, rejects as it
 * rejects.
 */
export type BindLogContext = <T>(
  context: LogContext,
  run: () => Promise<T>,
) => Promise<T>;

/**
 * Adds fields to the CURRENT scope (a decoded command's digest learned
 * after the bind); outside any scope it does nothing.
 */
export type AddLogContext = (context: LogContext) => void;

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
 * The per-invocation log scope (WS-4.2, RU-26) — the console telemetry
 * adapter's `consoleLogContext()`; the callable edge depends on it beside
 * its `EdgePorts`, which keep their members.
 */
export type LogContextPorts = {
  readonly bindLogContext: BindLogContext;
  readonly addLogContext: AddLogContext;
};

/**
 * The keyed digest of a decoded command's allowlisted basis
 * (`LogDigestSystem`, RU-23) — HMAC-SHA-256 hex under the server-held
 * `LOG_DIGEST_KEY`, never a plain hash: the outcome line's `inputDigest`
 * tells two calls with the same input apart without revealing it. The
 * {@link KeyedHash} type the walk-in id uses; `''` when no key is bound.
 */
export type LogDigestPorts = {
  readonly logDigest: KeyedHash;
};

/**
 * The telemetry bundle the composition root builds once per cold start —
 * the server's; the web's {@link ClientIssuePorts} is a bundle of its own.
 */
export type TelemetryPorts = LogPorts & ErrorTrackingPorts;
