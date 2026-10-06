import {
  type PersistedDocument,
  policyFromDocument,
} from '@creativo/application/booking';
import { BACKFILL_JOBS_COLLECTION } from '../ops/backfill-plan';

/**
 * The pure half of the policy-change recompute: the durable job it keeps in
 * `backfillJobs/clientStatsPolicy`, when a policy change starts or restarts
 * it, and how one step advances it. The shell
 * (`recompute-on-policy-change.ts`) reads, recomputes and writes.
 *
 * Why a job at all: moving the late-cancel line re-judges EVERY client, and
 * a book of any size does not fit one invocation's timeout. A killed
 * invocation leaves the book half on the old line with no record of where
 * it stopped. So the work is a walk over the stored clients in id order,
 * its cursor kept here, taken a time-budgeted step at a time — each step's
 * write of this document is what triggers the next (the
 * `backfillJobs/{job}` progress shape `runBackfill` keeps, one document
 * over).
 */

/** The job's document id, beside `runBackfill`'s own jobs. */
export const POLICY_RECOMPUTE_JOB = 'clientStatsPolicy';

export const POLICY_RECOMPUTE_PATH = `${BACKFILL_JOBS_COLLECTION}/${POLICY_RECOMPUTE_JOB}`;

/** One pass over the stored clients, for one policy change. */
export interface PolicyRecomputeJob {
  /**
   * The settings write this pass answers — its event id. A redelivery of
   * the same write finds its own pass and starts nothing.
   */
  readonly generation: string;
  /** That write's time: a pass is only ever superseded by a NEWER change. */
  readonly changedAt: string;
  /** The last `clientStats` id this pass finished; `null` at the top. */
  readonly cursor: string | null;
  /** Stored clients this pass has walked. */
  readonly storedClients: number;
  /** Of those, how many answers changed and were written. */
  readonly recomputed: number;
  /** Clients dropped on a permanent failure — `runBackfill('clientStats')` repairs them. */
  readonly failed: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  /** Set when the walk ran off the end; the job then rests until the next change. */
  readonly finishedAt: string | null;
  /**
   * Set when a step could not move the pass and a redelivery cannot help (a
   * permanent failure): the pass is STALLED, not slow. Its own write fires
   * no step (`continuePolicyRecompute` rests on it); the daily sweep clears
   * it and tries again (`planPolicyJobNudge`), and any step that advances
   * clears it for good.
   */
  readonly stalledAt: string | null;
  /** The canonical code of the last failure that stalled the pass — codes only (T5). */
  readonly lastFailureCode: string | null;
  /**
   * The free-cancellation window, in hours, the change that started this
   * pass drew the late line at — what the daily sweep compares the live
   * policy with to tell a DROPPED start from a policy edit that moved no
   * line (`planPolicyCatchUp`). `null` on a job written before the field,
   * or started by a change that did not say.
   */
  readonly windowHours: number | null;
}

/** A settings write that moved the late line (`lateLineMoved`). */
export interface PolicyChange {
  readonly eventId: string;
  readonly atIso: string;
  /** The window the write drew the line at, when the caller knows it. */
  readonly windowHours?: number | null;
}

const text = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length > 0 ? raw : null;
const count = (raw: unknown): number =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
const hours = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;

/** The stored job, or `null` for none (or one too broken to continue — a new change restarts it). */
export function policyJobFromDocument(
  data: PersistedDocument | undefined,
): PolicyRecomputeJob | null {
  if (data === undefined) return null;
  const generation = text(data['generation']);
  const changedAt = text(data['changedAt']);
  if (generation === null || changedAt === null) return null;
  return {
    generation,
    changedAt,
    cursor: text(data['cursor']),
    storedClients: count(data['storedClients']),
    recomputed: count(data['recomputed']),
    failed: count(data['failed']),
    startedAt: text(data['startedAt']) ?? changedAt,
    updatedAt: text(data['updatedAt']) ?? changedAt,
    finishedAt: text(data['finishedAt']),
    stalledAt: text(data['stalledAt']),
    lastFailureCode: text(data['lastFailureCode']),
    windowHours: hours(data['windowHours']),
  };
}

export function policyJobToDocument(
  job: PolicyRecomputeJob,
): PersistedDocument {
  return {
    job: POLICY_RECOMPUTE_JOB,
    generation: job.generation,
    changedAt: job.changedAt,
    cursor: job.cursor,
    storedClients: job.storedClients,
    recomputed: job.recomputed,
    failed: job.failed,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    stalledAt: job.stalledAt,
    lastFailureCode: job.lastFailureCode,
    windowHours: job.windowHours,
  };
}

/** Whole seconds, an optional fraction (dot included), a zone — no nested quantifier. */
const RFC3339 =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+|)(Z|[+-]\d{2}:\d{2})$/i;

/** An RFC 3339 instant as whole epoch seconds and its fraction's digits; `null` when it is not one. */
function instantOf(
  iso: string,
): { readonly seconds: number; readonly fraction: string } | null {
  const match = RFC3339.exec(iso);
  const [, wholeSeconds, fraction, zone] = match ?? [];
  if (wholeSeconds === undefined || zone === undefined) return null;
  const ms = Date.parse(`${wholeSeconds}${zone}`);
  if (Number.isNaN(ms)) return null;
  return {
    seconds: ms / 1000,
    fraction: (fraction ?? '').slice(1).replace(/0+$/, ''),
  };
}

/**
 * The order of two RFC 3339 instants at FULL precision — negative, zero or
 * positive — or `null` when either is not one.
 *
 * Not `Date.parse`: it keeps milliseconds, and a Firestore event's time is
 * stamped in microseconds, so two settings writes inside one millisecond
 * would compare as simultaneous. The offset is normalised through the whole
 * seconds, and the fractions compare digit by digit.
 */
export function compareInstants(a: string, b: string): number | null {
  const left = instantOf(a);
  const right = instantOf(b);
  if (left === null || right === null) return null;
  if (left.seconds !== right.seconds) return left.seconds - right.seconds;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const x = left.fraction.padEnd(width, '0');
  const y = right.fraction.padEnd(width, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * The pass a policy change asks for, or `null` to leave the job as it is.
 *
 * - The same change delivered again: its pass is already running or done.
 * - An OLDER change delivered late: the pass that is running or done was
 *   started by a newer one, and every step reads the policy as it is live,
 *   so it already judges by a line at least as new.
 * - Anything else — no job yet, a newer change, a change at the same
 *   instant (to the microsecond: `compareInstants`) — (re)starts from the
 *   top. A running pass is SUPERSEDED: its in-flight step finds another
 *   generation before its next page and when it goes to advance, and stops
 *   (`sameStep`). Clients it already rewrote are rewritten again by the new
 *   pass, so the last change always has the last word.
 */
export function planPolicyJobStart(
  current: PolicyRecomputeJob | null,
  change: PolicyChange,
  nowIso: string,
): PolicyRecomputeJob | null {
  if (current !== null) {
    if (current.generation === change.eventId) return null;
    const order = compareInstants(change.atIso, current.changedAt);
    if (order !== null && order < 0) return null;
  }
  return {
    generation: change.eventId,
    changedAt: change.atIso,
    cursor: null,
    storedClients: 0,
    recomputed: 0,
    failed: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
    finishedAt: null,
    stalledAt: null,
    lastFailureCode: null,
    windowHours: change.windowHours ?? null,
  };
}

/**
 * Is the job still at the step a delivery was fired for? A compare-and-set
 * key: a redelivered or duplicated event, a step overtaken by another, or a
 * pass superseded by a newer change all fail it and write nothing — so the
 * chain has exactly one continuation.
 */
export function sameStep(
  a: PolicyRecomputeJob,
  b: PolicyRecomputeJob,
): boolean {
  return (
    a.generation === b.generation &&
    a.cursor === b.cursor &&
    a.finishedAt === b.finishedAt
  );
}

/** What one step got through. */
export interface PolicyStep {
  /** The last client finished; the cursor the next step starts after. */
  readonly cursor: string | null;
  /** The walk ran off the end of the stored clients. */
  readonly exhausted: boolean;
  readonly visited: number;
  readonly recomputed: number;
  readonly failed: number;
}

/**
 * The job after one step. Every step that is not the last moves the cursor
 * (a step always finishes at least one page, and a page with no client in
 * it is the end), so each advance is a real change — the write that fires
 * the next step — and the chain cannot spin in place.
 */
export function advancePolicyJob(
  job: PolicyRecomputeJob,
  step: PolicyStep,
  nowIso: string,
): PolicyRecomputeJob {
  return {
    ...job,
    cursor: step.cursor,
    storedClients: job.storedClients + step.visited,
    recomputed: job.recomputed + step.recomputed,
    failed: job.failed + step.failed,
    updatedAt: nowIso,
    finishedAt: step.exhausted ? nowIso : null,
    // A step that moved the pass ends any stall before it.
    stalledAt: null,
    lastFailureCode: null,
  };
}

/**
 * The job with the record of a permanent stall — the step could not move it
 * and a redelivery would fail the same way. The cursor and counts stay as
 * they are, and so does `updatedAt`, which keeps saying when the pass last
 * MOVED: that is what the sweep measures staleness by.
 */
export function stallPolicyJob(
  job: PolicyRecomputeJob,
  code: string,
  nowIso: string,
): PolicyRecomputeJob {
  return { ...job, stalledAt: nowIso, lastFailureCode: code };
}

/** How long a pass may go without moving before the sweep nudges it. */
export const POLICY_JOB_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * The daily sweep's verdict: the job rewritten to fire its step once more,
 * or `null` to leave it.
 *
 * A running step writes the job at least every few minutes (its budget), so
 * an unfinished pass that has not moved for `staleAfterMs` is not slow: it
 * stalled on a permanent failure, or ran out the platform's 24 h of
 * transient retries, and nothing else will ever fire its next step. The
 * nudge moves `updatedAt` — the write that fires the step — and clears
 * `stalledAt` so the step takes it. It is not a new step: the cursor and the
 * generation stay, so it is subject to the same compare-and-set as any
 * delivery (`sameStep`), and a sweep that runs twice finds a fresh
 * `updatedAt` and writes nothing.
 */
export function planPolicyJobNudge(
  job: PolicyRecomputeJob | null,
  nowIso: string,
  staleAfterMs: number = POLICY_JOB_STALE_AFTER_MS,
): PolicyRecomputeJob | null {
  if (job === null || job.finishedAt !== null) return null;
  const quietMs = Date.parse(nowIso) - Date.parse(job.updatedAt);
  // An unreadable time cannot prove the pass is moving: nudge it.
  if (!Number.isNaN(quietMs) && quietMs < staleAfterMs) return null;
  return { ...job, updatedAt: nowIso, stalledAt: null };
}

/**
 * A Firestore `Timestamp` (a document's `updateTime`) as an RFC 3339
 * instant at its FULL precision — nanoseconds — so it orders against an
 * event's microsecond `time` through `compareInstants` without the
 * millisecond rounding `toDate()` would add.
 */
export function timestampIso(stamp: {
  readonly seconds: number;
  readonly nanoseconds: number;
}): string {
  const whole = new Date(stamp.seconds * 1000).toISOString().slice(0, 19);
  return `${whole}.${String(stamp.nanoseconds).padStart(9, '0')}Z`;
}

/** The booking policy as the daily sweep reads it: its line, and when it last changed. */
export interface LivePolicyLine {
  /** The policy document's `updateTime` (`timestampIso`); `null` when there is no document. */
  readonly updatedAt: string | null;
  /** The free-cancellation window in force — the defaults' when there is no document. */
  readonly windowHours: number;
}

/** The generation a pass the sweep starts is filed under — never an event id. */
export const SWEEP_GENERATION_PREFIX = 'sweep:';

/**
 * The daily sweep's catch-up: the pass a DROPPED policy start owes the
 * book, or `null` when there is none to owe.
 *
 * A settings write whose start failed for good leaves the job where it was
 * — on the previous change's pass, finished, or no job at all — and nothing
 * else would ever notice: `planPolicyJobNudge` only moves passes that
 * exist. So the sweep compares the policy document with the job. The pass
 * is owed when the document changed AFTER the change the job answers
 * (`updatedAt` against `changedAt`, to the microsecond) AND its window is
 * not the one the job drew the line at. The second half is what keeps a
 * horizon or lead-time edit — a newer document that moved no line — from
 * costing a walk over the whole book; a job written before `windowHours`
 * existed cannot say, so it is owed one pass, once.
 *
 * With no job at all, the book has only ever been judged by the window the
 * appointments were written under, so a pass is owed only when the live
 * window is not the default one (the first change's start was dropped). The
 * owed pass starts from the top under `SWEEP_GENERATION_PREFIX` +
 * `updatedAt` (`planPolicyJobStart`, whose ordering it inherits).
 *
 * One pair of changes it cannot see: a line moved and moved BACK, both
 * starts dropped, leaves the live window equal to the job's while the
 * clients re-judged in between by `dispatchClientProjections` hold the
 * middle one. `runBackfill('clientStats')` remains the repair for that.
 *
 * ⚠ A REFINEMENT OF THE OWNER'S RULE, kept on purpose (round 4,
 * 2026-09-25). The ruling said "start the pass when the policy document is
 * newer than the job"; the window comparison is added on top because a
 * pass walks the whole book (a transaction per client), while horizon and
 * lead-time edits are routine and change no client's answer. The residual
 * above needs two PERMANENT start failures in a row plus a move back, heals
 * per client on their next appointment write, and has a manual repair. For
 * the literal rule, drop the window-equality return below; the spec pins
 * both halves ("owes nothing … moved no line" and the residual).
 */
export function planPolicyCatchUp(
  job: PolicyRecomputeJob | null,
  live: LivePolicyLine,
  nowIso: string,
): PolicyRecomputeJob | null {
  if (job === null) {
    const defaults = policyFromDocument(undefined).cancellationWindowHours;
    if (live.windowHours === defaults) return null;
  } else {
    // No document at all is a change too (a deleted policy is the defaults);
    // an instant that does not parse cannot prove the job is current.
    const order =
      live.updatedAt === null
        ? null
        : compareInstants(live.updatedAt, job.changedAt);
    if (order !== null && order <= 0) return null;
    if (job.windowHours !== null && job.windowHours === live.windowHours) {
      return null;
    }
  }
  const atIso = live.updatedAt ?? nowIso;
  return planPolicyJobStart(
    job,
    {
      eventId: `${SWEEP_GENERATION_PREFIX}${atIso}`,
      atIso,
      windowHours: live.windowHours,
    },
    nowIso,
  );
}
