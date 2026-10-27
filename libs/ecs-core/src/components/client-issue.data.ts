import type { ClientOperationId } from '@core/primitives';

/**
 * What went wrong on a device — the field `clientIssueKind`, the ONLY
 * source of these strings (OR-34). Two families: the data layer's own
 * refusals and the browser's failures.
 */
export const ClientIssueKind = {
  /** A read guard dropped a stored document from a list it read (`documentPath`, `fieldName`). */
  DataDocumentDropped: 'DATA_DOCUMENT_DROPPED',
  /** A read guard refused the one document a screen asked for (`documentPath`, `fieldName`). */
  DataDocumentRefused: 'DATA_DOCUMENT_REFUSED',
  /** A lazy chunk did not load — a stale tab after a deploy, or a network that dropped. */
  ChunkLoadFailed: 'CHUNK_LOAD_FAILED',
  /** An error nothing caught — Angular's `ErrorHandler` saw it. */
  UncaughtError: 'UNCAUGHT_ERROR',
  /** A promise rejected with nobody listening. */
  UnhandledRejection: 'UNHANDLED_REJECTION',
  /** The browser refused something the Content Security Policy does not admit. */
  CspViolation: 'CSP_VIOLATION',
  /**
   * A callable got no answer the server wrote — a fetch that failed, a body
   * with no JSON, the client timeout (the SDK's own `FunctionsError`s), or a
   * throw that is no `FunctionsError` (a lookalike): the web's callable
   * client reports it once (`callableName`, `operationId`,
   * `callableErrorCode`) and answers what it already answered —
   * `PipelineError.fromWire`'s answer for the SDK's own, `PIPELINE_UNKNOWN`
   * otherwise (audit-hardening WS-5, RU-30; review round 2). A condition,
   * logged at `warn`.
   */
  CallableTransportFailed: 'CALLABLE_TRANSPORT_FAILED',
} as const;
export type ClientIssueKind =
  (typeof ClientIssueKind)[keyof typeof ClientIssueKind];

/**
 * ONE CLIENT ISSUE AS IT LEAVES THE DEVICE (OR-34) — the struct the web's
 * reporter hands the first-party `reportClientIssues` callable, which writes
 * it to Cloud Logging. Closed and flat: every field sits at the root, every
 * text is `null` when the issue has none, and nothing names a person —
 * privacy by shape: no uid, no URL (the route PATTERN), no raw message (the
 * scrubbed one). Who reported it (a role, an authed flag) is the server's to
 * add from the call's auth context, never the device's to claim.
 *
 * - `errorName` — the thrown value's name (`TypeError`, `ChunkLoadError`),
 *   or the violated directive of a CSP report;
 * - `documentPath` — the refused document, `collection/id`
 *   (`appointments/appt-1`; a subcollection's `parent/id/name/id`);
 * - `fieldName` — the read guard's first offending field
 *   (`seats[1].startMinutes`);
 * - `routePattern` — the route's pattern (`/staff/schedule`), never its URL;
 * - `topFrame` — the first stack frame, its query and fragment dropped
 *   (`ClientIssueSystem.frame`);
 * - `scrubbedMessage` — the message with its e-mails, digit runs and long
 *   tokens masked, at most 160 characters (`ClientIssueSystem.scrub`);
 * - `release` — the build that ran (`serviceContext.version` in Error
 *   Reporting);
 * - `occurrences` — how many times the device saw it before it was sent (a
 *   positive whole number: the reporter counts its repeats, then sends once);
 * - `operationId` — the operation id the failed call went out with
 *   (audit-hardening WS-5): a server-side join to that call's `callable.*`
 *   outcome line, inside Cloud Logging, when the call reached the server —
 *   never a uid on the device's side (RU-39, OR-34);
 * - `callableName` — the callable that failed (`commitBooking`);
 * - `callableErrorCode` — the code the failure carried
 *   (`functions/internal`, `functions/deadline-exceeded` from the SDK's own
 *   failures, or a lookalike's), never a domain `errorCode`.
 *
 * The last three are `null` on every kind but `CALLABLE_TRANSPORT_FAILED`.
 * Built by `ClientIssueSystem.compose` / `.composeTransport` on the device,
 * admitted by `ClientIssueSystem.admitBatch` at the callable's edge: a
 * payload that is not this shape is refused whole
 * (`CLIENT_ISSUE_BATCH_REFUSED`) — the one leniency being an old web's issue
 * without the last three keys, admitted with them `null` (RU-30).
 */
export type ClientIssue = {
  readonly clientIssueKind: ClientIssueKind;
  readonly errorName: string | null;
  readonly documentPath: string | null;
  readonly fieldName: string | null;
  readonly routePattern: string | null;
  readonly topFrame: string | null;
  readonly scrubbedMessage: string | null;
  readonly release: string | null;
  readonly occurrences: number;
  readonly operationId: ClientOperationId | null;
  readonly callableName: string | null;
  readonly callableErrorCode: string | null;
};

/** The struct's fields in declaration order — the closed key set a payload is held to. */
const FIELDS = [
  'clientIssueKind',
  'errorName',
  'documentPath',
  'fieldName',
  'routePattern',
  'topFrame',
  'scrubbedMessage',
  'release',
  'occurrences',
  'operationId',
  'callableName',
  'callableErrorCode',
] as const satisfies readonly (keyof ClientIssue)[];

export const ClientIssue = {
  FIELDS,

  /**
   * The error kinds — an uncaught error and an unhandled rejection: the two
   * a code defect raises, so the two Error Reporting groups (the callable
   * logs them at `error`, typed `ReportedErrorEvent`). The data layer's
   * refusals, a chunk that did not load and a CSP report are conditions,
   * logged at `warn` and counted by kind.
   */
  isError(issue: ClientIssue): boolean {
    return (
      issue.clientIssueKind === ClientIssueKind.UncaughtError ||
      issue.clientIssueKind === ClientIssueKind.UnhandledRejection
    );
  },
} as const;
