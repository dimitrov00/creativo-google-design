import { type TriggerEventId, UtcEpochMs } from '@core/primitives';
import { RepositoryError } from '@core/errors';

/**
 * How a retrying handler judges one failed attempt
 * (`apps/functions/src/lib/trigger-attempts.ts:11-127`) — shared by every
 * `retry: true` trigger and the scheduled sweep that nudges the policy job,
 * so they read a code, decide on a redelivery and measure the attempt's age
 * the same way. Logging and rethrowing stay with the caller: this module
 * returns the verdict and the one structured line, never writes it.
 */

/**
 * Whether a redelivery could help — the ONLY source of these strings, the
 * field `attemptOutcome` (N15). The gRPC canonical code names a failure
 * carries (`aborted`, `already-exists`) are an external vocabulary and stay
 * as Firestore spells them (flatten-spec §0.4).
 */
export const AttemptOutcome = {
  /** A contended, overloaded or briefly absent backend: retry. */
  Transient: 'TRANSIENT',
  /** Would fail the same way for the whole retry window: log and drop. */
  Permanent: 'PERMANENT',
} as const;
export type AttemptOutcome =
  (typeof AttemptOutcome)[keyof typeof AttemptOutcome];

/** What a code is called when nothing names it. */
const UNKNOWN_CODE = 'unknown';

/** gRPC status numbers as the Admin SDK reports them, by canonical name. */
const GRPC_CODE_NAMES: { readonly [status: number]: string } = {
  1: 'cancelled',
  2: 'unknown',
  3: 'invalid-argument',
  4: 'deadline-exceeded',
  5: 'not-found',
  6: 'already-exists',
  7: 'permission-denied',
  8: 'resource-exhausted',
  9: 'failed-precondition',
  10: 'aborted',
  11: 'out-of-range',
  12: 'unimplemented',
  13: 'internal',
  14: 'unavailable',
  15: 'data-loss',
  16: 'unauthenticated',
} as const;

/**
 * The failures worth a redelivery: a contended, overloaded or briefly absent
 * backend answers differently next time. Everything else (unparseable
 * input, a domain refusal, a permission) would fail the same way for the
 * whole 24 h retry window.
 */
const TRANSIENT_CODES: readonly string[] = [
  'aborted',
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
];

/**
 * One failure, judged: the failure itself, its canonical gRPC code name
 * (`failureCode` — an external vocabulary, never an `errorCode` of ours), and
 * whether a redelivery could help.
 */
export type AttemptFailure = {
  readonly error: unknown;
  readonly failureCode: string;
  readonly attemptOutcome: AttemptOutcome;
};

/**
 * The ONE structured line a failed attempt logs: ids and codes only (T5),
 * and `ageMs` saying how deep into the retry window this delivery is.
 */
export type AttemptLine = {
  readonly fn: string;
  readonly eventId: TriggerEventId;
  readonly attemptOutcome: AttemptOutcome;
  readonly failureCode: string;
  /** A duration (N5), not an instant. */
  readonly ageMs: number | null;
};

/** A delivered event as the verdict reads it: its id and its own time (`null` when unreadable). */
export type AttemptEvent = {
  readonly id: TriggerEventId;
  readonly eventAtUtcMs: UtcEpochMs | null;
};

/** The `code` a thrown value carries, read without trusting its shape. */
function codeOf(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return undefined;
  return 'code' in error ? error.code : undefined;
}

/**
 * The code a failure is JUDGED by: a port's refusal (`RepositoryError.guard`)
 * by the canonical code its adapter recorded as its `reason` (`unavailable`,
 * `aborted`, …; `unknown` without one), anything else by its own `code`.
 */
function judgedCode(error: unknown): string {
  return RepositoryError.guard(error)
    ? TriggerAttemptSystem.failureCode({ code: error.reason ?? '' })
    : TriggerAttemptSystem.failureCode(error);
}

export const TriggerAttemptSystem = {
  UNKNOWN_CODE,

  /** A failure's canonical code — numeric (Admin SDK) or string, `unknown` otherwise. */
  failureCode(error: unknown): string {
    const code = codeOf(error);
    if (typeof code === 'number') {
      return Object.hasOwn(GRPC_CODE_NAMES, code)
        ? (GRPC_CODE_NAMES[code] as string)
        : UNKNOWN_CODE;
    }
    if (typeof code === 'string' && code.length > 0) {
      return code
        .replace(/^[a-z]+\//, '')
        .replace(/_/g, '-')
        .toLowerCase();
    }
    return UNKNOWN_CODE;
  },

  attemptOutcome(code: string): AttemptOutcome {
    return TRANSIENT_CODES.includes(code)
      ? AttemptOutcome.Transient
      : AttemptOutcome.Permanent;
  },

  /**
   * How far into the retry window a delivery is — from the event's own time;
   * `null` when that is unreadable. Elapsed real time between two instants
   * (flatten-spec T2); never below zero.
   */
  eventAgeMs(
    eventAtUtcMs: UtcEpochMs | null,
    nowUtcMs: UtcEpochMs,
  ): number | null {
    if (eventAtUtcMs === null) return null;
    return UtcEpochMs.compare(nowUtcMs, eventAtUtcMs) > 0
      ? UtcEpochMs.elapsedMs(eventAtUtcMs, nowUtcMs)
      : 0;
  },

  /**
   * One failure, judged by its code — read off it unless given: a port's
   * refusal (a `RepositoryError`) by the code in its `reason`, a throw by
   * its own `code` (pass C, P-24 — the pipelines' `failureOf` /
   * `failureCodeOf` copies, homed here).
   */
  attemptFailure(
    error: unknown,
    failureCode: string = judgedCode(error),
  ): AttemptFailure {
    return {
      error,
      failureCode,
      attemptOutcome: TriggerAttemptSystem.attemptOutcome(failureCode),
    };
  },

  /**
   * A port's refusal as the retrying edge judges it: by the canonical code
   * the adapter recorded as its `reason` (`unavailable`, `aborted`, …), else
   * `unknown` — a failure no redelivery is known to fix. What
   * {@link TriggerAttemptSystem.attemptFailure} reads off a
   * `RepositoryError` (the pipeline tier's `repositoryFailure`, homed here).
   */
  repositoryFailure(error: RepositoryError): AttemptFailure {
    return TriggerAttemptSystem.attemptFailure(error, judgedCode(error));
  },

  /**
   * One attempt's verdict over several INDEPENDENT failures: transient when
   * any one is — the redelivery that one earns re-runs them all, which
   * state-based work makes safe — else the first; `null` when nothing failed.
   * Each is judged by {@link TriggerAttemptSystem.attemptFailure}: a port's
   * refusal by its `reason`, a throw as thrown.
   */
  decisiveFailure(errors: readonly unknown[]): AttemptFailure | null {
    let first: AttemptFailure | null = null;
    for (let i = 0; i < errors.length; i++) {
      const failure = TriggerAttemptSystem.attemptFailure(errors[i]);
      if (failure.attemptOutcome === AttemptOutcome.Transient) return failure;
      first ??= failure;
    }
    return first;
  },

  attemptLine(
    fn: string,
    event: AttemptEvent,
    failure: AttemptFailure,
    nowUtcMs: UtcEpochMs,
  ): AttemptLine {
    return {
      fn,
      eventId: event.id,
      attemptOutcome: failure.attemptOutcome,
      failureCode: failure.failureCode,
      ageMs: TriggerAttemptSystem.eventAgeMs(event.eventAtUtcMs, nowUtcMs),
    };
  },
} as const;
