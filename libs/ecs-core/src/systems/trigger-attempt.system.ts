import {
  type OperationId,
  type TriggerEventId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import { AttemptOutcome } from '@core/components';
import type { TriggerFailure } from '@core/entities';
import { FailureCodeSystem } from './failure-code.system';

/**
 * How a retrying handler judges one failed attempt
 * (`apps/functions/src/lib/trigger-attempts.ts:11-127`) — shared by every
 * `retry: true` trigger and the scheduled sweep that nudges the policy job,
 * so they read a code, decide on a redelivery and measure the attempt's age
 * the same way. Logging and rethrowing stay with the caller: this module
 * returns the verdict and the one structured line, never writes it.
 *
 * **The retry allowlist** (the 2026-08 audit remediation): a redelivery is
 * earned ONLY by a code of `TRANSIENT_CODES` — the server twin of the web's
 * live re-listen (`subscribe-with-retry.ts` `RETRYABLE_CODES`, which also
 * keeps `internal`: a re-listen is free, a trigger retrying an `internal`
 * for the whole retry window is the billed loop the audit closed). Its
 * deployed half is the `retry` flag per export (`main.spec.ts`
 * `ENDPOINTS`); `edge.ts` `retryingTrigger` is the one function that
 * applies the verdict. A port's refusal is judged by the canonical code its
 * adapter recorded as its `reason`; a MALFORMED stored document
 * (`REPOSITORY_MALFORMED`, refused at read time — edge-hardening D-2/D-5)
 * by `data-loss` whatever field its `reason` names: it reads the same on
 * every redelivery, so it is logged and never retried. The canonical code
 * itself is {@link FailureCodeSystem}'s.
 */

/**
 * What a malformed stored document is judged by — gRPC 15, "unrecoverable
 * data loss or corruption": never transient, so never redelivered.
 */
const DATA_LOSS_CODE = 'data-loss';

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
 * How long the platform redelivers a `retry: true` event: 24 h from the
 * event's own time (a duration, N5).
 */
const RETRY_WINDOW_MS = 86_400_000;

/**
 * The last stretch of the retry window (15 min): a TRANSIENT failure this
 * deep into it may be the last attempt the platform makes, so it is
 * dead-lettered as well as rethrown (audit-hardening WS-6).
 */
const LAST_ATTEMPT_MARGIN_MS = 900_000;

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
  /**
   * The written document's path (`appointments/<id>`) — ids only, never a
   * body — or `null` for a delivery that names none (a schedule tick).
   * Audit-hardening WS-4.3 (DEP-19).
   */
  readonly documentPath: string | null;
  /**
   * The operation id the written document carries (`WriteProvenance`) —
   * the callable whose write woke this trigger — or `null` (none stored,
   * a malformed one, or no document). WS-4.3 (DEP-19).
   */
  readonly writeOperationId: OperationId | null;
};

/**
 * A delivered event as the verdict reads it: its id and its own time
 * (`null` when unreadable), the document it names and the operation id
 * that document carries (WS-4.3 — each `null` when absent; the wire reads
 * them, a malformed id as `null`).
 */
export type AttemptEvent = {
  readonly id: TriggerEventId;
  readonly eventAtUtcMs: UtcEpochMs | null;
  readonly documentPath: string | null;
  readonly writeOperationId: OperationId | null;
};

/**
 * The code a failure is JUDGED by: a port's refusal (`RepositoryError.guard`)
 * by the canonical code its adapter recorded as its `reason` (`unavailable`,
 * `aborted`, …; `unknown` without one) — except a malformed document, judged
 * {@link DATA_LOSS_CODE} (its `reason` is a field name, never a code) —
 * anything else by its own `code`.
 */
function judgedCode(error: unknown): string {
  if (!RepositoryError.guard(error)) {
    return FailureCodeSystem.codeOf(error);
  }
  return error.errorCode === RepositoryErrorCode.Malformed
    ? DATA_LOSS_CODE
    : FailureCodeSystem.codeOf({ code: error.reason ?? '' });
}

export const TriggerAttemptSystem = {
  DATA_LOSS_CODE,
  RETRY_WINDOW_MS,
  LAST_ATTEMPT_MARGIN_MS,

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
   * `unknown` — a failure no redelivery is known to fix; a malformed
   * document by {@link DATA_LOSS_CODE}, permanent. What
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
      documentPath: event.documentPath,
      writeOperationId: event.writeOperationId,
    };
  },

  /**
   * Whether a failed attempt earns a dead letter (audit-hardening WS-6,
   * DEP-23): a PERMANENT failure always — no redelivery comes; a TRANSIENT
   * one only when its age is known and inside the window's last
   * {@link LAST_ATTEMPT_MARGIN_MS} (`ageMs >= RETRY_WINDOW_MS −
   * LAST_ATTEMPT_MARGIN_MS`), where the redelivery it earns may never come.
   * An early transient failure, or one of unknown age, writes none.
   */
  deadLetter(failure: AttemptFailure, ageMs: number | null): boolean {
    if (failure.attemptOutcome === AttemptOutcome.Permanent) return true;
    return ageMs !== null && ageMs >= RETRY_WINDOW_MS - LAST_ATTEMPT_MARGIN_MS;
  },

  /**
   * The dead letter of one attempt line, recorded at `nowUtcMs`
   * (`triggerFailures/{eventId}`, RU-31): the line's ids and codes, the
   * event id as the document id, the written document's operation id as
   * its `WriteProvenance` — never the failure itself, never a body.
   */
  triggerFailure(line: AttemptLine, nowUtcMs: UtcEpochMs): TriggerFailure {
    return {
      id: line.eventId,
      fn: line.fn,
      documentPath: line.documentPath,
      attemptOutcome: line.attemptOutcome,
      failureCode: line.failureCode,
      recordedAtUtcMs: nowUtcMs,
      writeOperationId: line.writeOperationId,
    };
  },
} as const;
