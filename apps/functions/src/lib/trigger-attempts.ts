import { logger } from 'firebase-functions';
import { TriggerAttemptSystem } from '@creativo/ecs-core';

/**
 * How a retrying handler judges one failed attempt — shared by every
 * `retry: true` trigger (`auditProfileChanges`, `dispatchClientProjections`,
 * the policy-change recompute and its job) and the scheduled sweep that
 * nudges that job, so they read a code, decide on a redelivery and log the
 * attempt's age the same way (`reportAttempt`).
 *
 * Phase 2 shim: the verdicts are `TriggerAttemptSystem` in
 * `@creativo/ecs-core`; this file keeps the legacy names, parses the event's
 * wire time, and does the logging and the rethrow.
 */

/** A failure's canonical code — numeric (Admin SDK) or string, `unknown` otherwise. */
export function failureCode(error: unknown): string {
  return TriggerAttemptSystem.failureCode(error);
}

export function attemptOutcome(code: string): 'transient' | 'permanent' {
  return TriggerAttemptSystem.attemptOutcome(code);
}

/** How far into the retry window this delivery is — from the event's own time. */
export function eventAgeMs(eventTime: string, nowMs: number): number | null {
  return TriggerAttemptSystem.eventAgeMs(eventAtMs(eventTime), nowMs);
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
  return TriggerAttemptSystem.attemptFailure(error, code);
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
  return TriggerAttemptSystem.decisiveFailure(errors);
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
  return TriggerAttemptSystem.attemptLine(
    fn,
    { id: event.id, atMs: eventAtMs(event.time) },
    failure,
    nowMs,
  );
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

/** The event's wire time as epoch ms; `null` when it does not parse. */
function eventAtMs(eventTime: string): number | null {
  const ms = Date.parse(eventTime);
  return Number.isNaN(ms) ? null : ms;
}
