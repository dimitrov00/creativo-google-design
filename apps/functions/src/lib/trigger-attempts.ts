import { logger } from 'firebase-functions';
import {
  type AttemptFailure as EcsAttemptFailure,
  AttemptOutcome,
  TriggerAttemptSystem,
  TriggerEventId,
  UtcEpochMs,
  defect,
} from '@creativo/ecs-core';

/**
 * How a retrying handler judges one failed attempt — shared by every
 * `retry: true` trigger (`auditProfileChanges`, `dispatchClientProjections`,
 * the policy-change recompute and its job) and the scheduled sweep that
 * nudges that job, so they read a code, decide on a redelivery and log the
 * attempt's age the same way (`reportAttempt`).
 *
 * Phase 2 shim: the verdicts are `TriggerAttemptSystem` in
 * `@creativo/ecs-core`; this file keeps the legacy names and the legacy
 * lowercase outcome on its structs and its log line (the bytes a log query
 * reads stay what they are), parses the event's wire time into a
 * `UtcEpochMs`, and does the logging and the rethrow.
 */

/** The legacy outcome strings ↔ the SCREAMING `AttemptOutcome` — the ONE table. */
const LEGACY_ATTEMPT_OUTCOME = {
  [AttemptOutcome.Transient]: 'transient',
  [AttemptOutcome.Permanent]: 'permanent',
} as const satisfies Record<AttemptOutcome, string>;

type LegacyOutcome =
  (typeof LEGACY_ATTEMPT_OUTCOME)[keyof typeof LEGACY_ATTEMPT_OUTCOME];

function outcomeOf(legacy: LegacyOutcome): AttemptOutcome {
  return legacy === LEGACY_ATTEMPT_OUTCOME[AttemptOutcome.Transient]
    ? AttemptOutcome.Transient
    : AttemptOutcome.Permanent;
}

/** A failure's canonical code — numeric (Admin SDK) or string, `unknown` otherwise. */
export function failureCode(error: unknown): string {
  return TriggerAttemptSystem.failureCode(error);
}

export function attemptOutcome(code: string): 'transient' | 'permanent' {
  return LEGACY_ATTEMPT_OUTCOME[TriggerAttemptSystem.attemptOutcome(code)];
}

/** How far into the retry window this delivery is — from the event's own time. */
export function eventAgeMs(eventTime: string, nowMs: number): number | null {
  return TriggerAttemptSystem.eventAgeMs(eventAtUtcMs(eventTime), utc(nowMs));
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
  return failureBack(TriggerAttemptSystem.attemptFailure(error, code));
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
  const failure = TriggerAttemptSystem.decisiveFailure(errors);
  return failure === null ? null : failureBack(failure);
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
  const line = TriggerAttemptSystem.attemptLine(
    fn,
    { id: TriggerEventId.of(event.id), eventAtUtcMs: eventAtUtcMs(event.time) },
    failureStruct(failure),
    utc(nowMs),
  );
  return {
    fn: line.fn,
    eventId: line.eventId,
    outcome: LEGACY_ATTEMPT_OUTCOME[line.attemptOutcome],
    code: line.failureCode,
    ageMs: line.ageMs,
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

/* ── The bridge: legacy values ↔ ecs-core structs (Phase 4 deletes it) ── */

/** The event's wire time as an instant; `null` when it does not parse. */
function eventAtUtcMs(eventTime: string): UtcEpochMs | null {
  const instant = UtcEpochMs.of(Date.parse(eventTime));
  return instant.ok ? instant.value : null;
}

/**
 * A clock reading as an instant. The legacy clocks are `Date.now`-shaped,
 * so a reading that is not one is a defect of the caller.
 */
function utc(ms: number): UtcEpochMs {
  const instant = UtcEpochMs.of(ms);
  if (!instant.ok) defect(`unreachable: a clock read ${ms}`);
  return instant.value;
}

function failureBack(failure: EcsAttemptFailure): AttemptFailure {
  return {
    error: failure.error,
    code: failure.failureCode,
    outcome: LEGACY_ATTEMPT_OUTCOME[failure.attemptOutcome],
  };
}

function failureStruct(failure: AttemptFailure): EcsAttemptFailure {
  return {
    error: failure.error,
    failureCode: failure.code,
    attemptOutcome: outcomeOf(failure.outcome),
  };
}
