import { logger } from 'firebase-functions';

/**
 * How a retrying handler judges one failed attempt — shared by every
 * `retry: true` trigger (`auditProfileChanges`, `dispatchClientProjections`,
 * the policy-change recompute and its job) and the scheduled sweep that
 * nudges that job, so they read a code, decide on a redelivery and log the
 * attempt's age the same way (`reportAttempt`).
 */

/** gRPC status numbers as the Admin SDK reports them, by canonical name. */
const GRPC_CODES: ReadonlyMap<number, string> = new Map([
  [1, 'cancelled'],
  [2, 'unknown'],
  [3, 'invalid-argument'],
  [4, 'deadline-exceeded'],
  [5, 'not-found'],
  [6, 'already-exists'],
  [7, 'permission-denied'],
  [8, 'resource-exhausted'],
  [9, 'failed-precondition'],
  [10, 'aborted'],
  [11, 'out-of-range'],
  [12, 'unimplemented'],
  [13, 'internal'],
  [14, 'unavailable'],
  [15, 'data-loss'],
  [16, 'unauthenticated'],
]);

/** A failure's canonical code — numeric (Admin SDK) or string, `unknown` otherwise. */
export function failureCode(error: unknown): string {
  const code =
    error !== null && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  if (typeof code === 'number') return GRPC_CODES.get(code) ?? 'unknown';
  if (typeof code === 'string' && code.length > 0) {
    return code
      .replace(/^[a-z]+\//, '')
      .replace(/_/g, '-')
      .toLowerCase();
  }
  return 'unknown';
}

/**
 * The failures worth a redelivery: a contended, overloaded or briefly absent
 * backend answers differently next time. Everything else (unparseable input,
 * a domain refusal, a permission) would fail the same way for the whole 24 h
 * retry window, so it is logged and dropped instead.
 */
const TRANSIENT_CODES: readonly string[] = [
  'aborted',
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
];

export function attemptOutcome(code: string): 'transient' | 'permanent' {
  return TRANSIENT_CODES.includes(code) ? 'transient' : 'permanent';
}

/** How far into the retry window this delivery is — from the event's own time. */
export function eventAgeMs(eventTime: string, nowMs: number): number | null {
  const ms = Date.parse(eventTime);
  return Number.isNaN(ms) ? null : Math.max(0, nowMs - ms);
}

export interface AttemptFailure {
  readonly error: unknown;
  readonly code: string;
  readonly outcome: 'transient' | 'permanent';
}

/** One failure, judged: its code (read off it unless given) and whether a redelivery could help. */
export function attemptFailure(
  error: unknown,
  code: string = failureCode(error),
): AttemptFailure {
  return { error, code, outcome: attemptOutcome(code) };
}

/**
 * One attempt's verdict over several INDEPENDENT failures — a trigger that
 * recomputed each subject on its own. Transient when any one is: the
 * redelivery that one earns re-runs them all, which state-based work makes
 * safe. `null` when nothing failed.
 */
export function decisiveFailure(
  errors: readonly unknown[],
): AttemptFailure | null {
  const judged = errors.map((error) => attemptFailure(error));
  return (
    judged.find((failure) => failure.outcome === 'transient') ??
    judged[0] ??
    null
  );
}

/**
 * The ONE structured line a failed attempt logs (`logger.error('trigger
 * attempt failed', …)`): ids and codes only (T5), and `ageMs` saying how
 * deep into the retry window this delivery is.
 */
export interface AttemptLine {
  readonly fn: string;
  readonly eventId: string;
  readonly outcome: AttemptFailure['outcome'];
  readonly code: string;
  readonly ageMs: number | null;
}

export function attemptLine(
  fn: string,
  event: { readonly id: string; readonly time: string },
  failure: AttemptFailure,
  nowMs: number,
): AttemptLine {
  return {
    fn,
    eventId: event.id,
    outcome: failure.outcome,
    code: failure.code,
    ageMs: eventAgeMs(event.time, nowMs),
  };
}

/** Log a failed attempt's ONE line, and nothing else. */
export function logAttempt(
  fn: string,
  event: { readonly id: string; readonly time: string },
  failure: AttemptFailure,
  nowMs: number,
): void {
  logger.error(
    'trigger attempt failed',
    attemptLine(fn, event, failure, nowMs),
  );
}

/**
 * The tail every retrying handler shares: log the attempt's ONE line, then
 * rethrow what a redelivery could fix — the platform redelivers with
 * backoff — and return on the rest, which would fail the same way for the
 * whole retry window.
 */
export function reportAttempt(
  fn: string,
  event: { readonly id: string; readonly time: string },
  failure: AttemptFailure,
  nowMs: number,
): void {
  logAttempt(fn, event, failure, nowMs);
  if (failure.outcome === 'transient') throw failure.error;
}
