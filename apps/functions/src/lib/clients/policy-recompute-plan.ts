import {
  type PersistedDocument,
  policyFromDocument,
} from '@creativo/application/booking';
import {
  PolicyRecomputeJobId,
  UserId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import { PreciseInstant } from '@core/components';
import {
  type PolicyRecomputeJob as EcsPolicyRecomputeJob,
  RecomputeJobName,
} from '@core/entities';
import { PolicyRecomputeJobSystem } from '@core/systems';
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
 *
 * Phase 2 shim: the decisions are `PolicyRecomputeJobSystem` in
 * `@core/systems`, over the job as its flat entity — `UtcEpochMs`
 * stamps, the change instant as its D17 halves (`changedAtSeconds` +
 * `changedAtNanos`), the cursor a `UserId`. This file keeps the stored RFC
 * 3339 shapes for its callers and converts at the edge: every instant the
 * system hands back unchanged keeps the exact text it came in as, and an
 * instant it stamps is `nowIso`.
 */

/**
 * The job's document id, beside `runBackfill`'s own jobs — and the legacy
 * `job` tag the stored document carries (OQ-9: both stay until flip (1)).
 */
export const POLICY_RECOMPUTE_JOB = PolicyRecomputeJobId.FIXED;

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

/**
 * The order of two RFC 3339 instants at FULL precision — negative, zero or
 * positive — or `null` when either is not one.
 *
 * Not `Date.parse`: it keeps milliseconds, and a Firestore event's time is
 * stamped in microseconds, so two settings writes inside one millisecond
 * would compare as simultaneous. The offset is normalised through the whole
 * seconds, and the fraction is read to the nanosecond.
 */
export function compareInstants(a: string, b: string): number | null {
  const left = instantFromIso(a);
  const right = instantFromIso(b);
  // An instant that does not parse never proves an order.
  if (left === null || right === null) return null;
  return PolicyRecomputeJobSystem.compareInstants(left, right);
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
  const texts: InstantTexts = new Map();
  const was = current === null ? null : toEntity(current, texts);
  const next = PolicyRecomputeJobSystem.nextStep(
    was,
    {
      generation: change.eventId,
      changedAt: instantIn(change.atIso, texts, LATEST_INSTANT),
      windowHours: change.windowHours ?? null,
    },
    instantOf(nowIso),
  );
  return next === null ? null : fromEntity(next, null, nowIso, texts);
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
  const texts: InstantTexts = new Map();
  return PolicyRecomputeJobSystem.sameStep(
    toEntity(a, texts),
    toEntity(b, texts),
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
  const texts: InstantTexts = new Map();
  const was = toEntity(job, texts);
  return fromEntity(
    PolicyRecomputeJobSystem.advance(
      was,
      {
        cursor: step.cursor === null ? null : UserId.of(step.cursor),
        exhausted: step.exhausted,
        visited: step.visited,
        recomputed: step.recomputed,
        failed: step.failed,
      },
      instantOf(nowIso),
    ),
    { job, entity: was },
    nowIso,
    texts,
  );
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
  const texts: InstantTexts = new Map();
  const was = toEntity(job, texts);
  return fromEntity(
    PolicyRecomputeJobSystem.stall(was, code, instantOf(nowIso)),
    { job, entity: was },
    nowIso,
    texts,
  );
}

/** How long a pass may go without moving before the sweep nudges it. */
export const POLICY_JOB_STALE_AFTER_MS =
  PolicyRecomputeJobSystem.STALE_AFTER_MS;

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
  if (job === null) return null;
  const texts: InstantTexts = new Map();
  const was = toEntity(job, texts);
  const next = PolicyRecomputeJobSystem.nudge(
    was,
    instantOf(nowIso),
    staleAfterMs,
  );
  return next === null
    ? null
    : fromEntity(next, { job, entity: was }, nowIso, texts);
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
export const SWEEP_GENERATION_PREFIX =
  PolicyRecomputeJobSystem.SWEEP_GENERATION_PREFIX;

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
 * the literal rule, drop the window-equality return in
 * `PolicyRecomputeJobSystem.owesCatchUp`; the spec pins both halves ("owes
 * nothing … moved no line" and the residual).
 */
export function planPolicyCatchUp(
  job: PolicyRecomputeJob | null,
  live: LivePolicyLine,
  nowIso: string,
): PolicyRecomputeJob | null {
  const texts: InstantTexts = new Map();
  const next = PolicyRecomputeJobSystem.catchUp(
    job === null ? null : toEntity(job, texts),
    {
      updatedAt:
        live.updatedAt === null
          ? null
          : instantIn(live.updatedAt, texts, LATEST_INSTANT),
      windowHours: live.windowHours,
    },
    instantOf(nowIso),
    live.updatedAt ?? nowIso,
    policyFromDocument(undefined).cancellationWindowHours,
  );
  return next === null ? null : fromEntity(next, null, nowIso, texts);
}

/* ── The Phase 2 bridge: RFC 3339 strings ↔ the job entity ─────────────── */

/** Whole seconds, an optional fraction (dot included), a zone — no nested quantifier. */
const RFC3339 =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+|)(Z|[+-]\d{2}:\d{2})$/i;

/** A D17 instant the bridge builds from known-good parts. */
function preciseOrThrow(seconds: number, nanos: number): PreciseInstant {
  const instant = PreciseInstant.of(seconds, nanos);
  if (instant === null) defect('unreachable: a broken D17 bound');
  return instant;
}

/**
 * The stand-ins for a stored instant that does not parse. The legacy
 * reading made it an instant no order can be read from, which the system
 * answered conservatively — restart, judge, nudge — never skip. A brand
 * holds only real instants, so the bridge hands over the bound that gives
 * that same answer in the role the text plays: an OLD stamp (a job's own
 * change, its stored times) reads as the earliest instant, older than any
 * change; a NEW one (the change being delivered, the live policy's update
 * time) as the latest, newer than any stamp. The text itself rides back
 * unchanged through {@link InstantTexts}.
 */
export const EARLIEST_INSTANT = preciseOrThrow(-Number.MAX_SAFE_INTEGER, 0);
export const LATEST_INSTANT = preciseOrThrow(
  Number.MAX_SAFE_INTEGER,
  999_999_999,
);
const EARLIEST_UTC_MS = (() => {
  const earliest = UtcEpochMs.of(-62_135_596_800_000);
  if (!earliest.ok) defect('unreachable: the UtcEpochMs floor');
  return earliest.value;
})();

/**
 * An RFC 3339 instant — what a legacy job or pass stamp holds — as the
 * §9 D17 `{ seconds, nanos }` value, its fraction read to the nanosecond;
 * `null` for one that does not parse (no order can be read from it).
 * Shared with `client-stats-projection.ts`, the other side of the pass guard.
 */
export function instantFromIso(iso: string): PreciseInstant | null {
  const match = RFC3339.exec(iso);
  const [, wholeSeconds, fraction, zone] = match ?? [];
  const ms =
    wholeSeconds === undefined || zone === undefined
      ? Number.NaN
      : Date.parse(`${wholeSeconds}${zone}`);
  if (Number.isNaN(ms)) return null;
  const digits = (fraction ?? '').slice(1, 10).padEnd(9, '0');
  return PreciseInstant.of(ms / 1000, Number(digits));
}

/**
 * Each D17 value handed to the system, by its value, to the text it came in
 * as. Registered in reading order, so when two texts name the same instant
 * the later one — the change being delivered — is the one a job that takes
 * that change writes back.
 */
type InstantTexts = Map<string, string>;

const keyOf = (instant: PreciseInstant): string =>
  `${instant.seconds}:${instant.nanos}`;

function instantIn(
  iso: string,
  texts: InstantTexts,
  unreadable: PreciseInstant,
): PreciseInstant {
  const instant = instantFromIso(iso) ?? unreadable;
  texts.set(keyOf(instant), iso);
  return instant;
}

/** A stored or stamped RFC 3339 time as an instant; one that does not parse reads as the earliest. */
function instantOf(iso: string): UtcEpochMs {
  const instant = UtcEpochMs.of(Date.parse(iso));
  return instant.ok ? instant.value : EARLIEST_UTC_MS;
}

const instantOrNull = (iso: string | null): UtcEpochMs | null =>
  iso === null ? null : instantOf(iso);

function toEntity(
  job: PolicyRecomputeJob,
  texts: InstantTexts,
): EcsPolicyRecomputeJob {
  const changedAt = instantIn(job.changedAt, texts, EARLIEST_INSTANT);
  const cursor = job.cursor === null ? null : UserId.of(job.cursor);
  const finishedAtUtcMs = instantOrNull(job.finishedAt);
  return {
    id: PolicyRecomputeJobId.FIXED,
    recomputeJobName: RecomputeJobName.ClientStatsPolicy,
    generation: job.generation,
    changedAtSeconds: changedAt.seconds,
    changedAtNanos: changedAt.nanos,
    cursor,
    storedClients: job.storedClients,
    recomputed: job.recomputed,
    failed: job.failed,
    startedAtUtcMs: instantOf(job.startedAt),
    updatedAtUtcMs: instantOf(job.updatedAt),
    finishedAtUtcMs,
    stepKey: PolicyRecomputeJobSystem.stepKeyOf(
      job.generation,
      cursor,
      finishedAtUtcMs,
    ),
    stalledAtUtcMs: instantOrNull(job.stalledAt),
    lastFailureCode: job.lastFailureCode,
    windowHours: job.windowHours,
  };
}

/**
 * An instant field back as text: the stored text when the system left it
 * as it was, `nowIso` when it stamped now (the only instant it makes).
 */
function textOf(
  utcMs: UtcEpochMs,
  wasUtcMs: UtcEpochMs | null,
  wasText: string | null,
  nowIso: string,
): string {
  if (wasText !== null && utcMs === wasUtcMs) return wasText;
  return utcMs === instantOf(nowIso) ? nowIso : new Date(utcMs).toISOString();
}

function textOrNull(
  utcMs: UtcEpochMs | null,
  wasUtcMs: UtcEpochMs | null,
  wasText: string | null,
  nowIso: string,
): string | null {
  return utcMs === null ? null : textOf(utcMs, wasUtcMs, wasText, nowIso);
}

/** The change instant back as text: the text it came in as, else `nowIso` (the sweep's no-document change). */
function changedAtText(
  next: EcsPolicyRecomputeJob,
  texts: InstantTexts,
  nowIso: string,
): string {
  const instant = {
    seconds: next.changedAtSeconds,
    nanos: next.changedAtNanos,
  };
  const text = texts.get(keyOf(instant));
  if (text !== undefined) return text;
  if (
    PreciseInstant.equals(
      instant,
      PreciseInstant.fromEpochMs(instantOf(nowIso)),
    )
  ) {
    return nowIso;
  }
  const ms = PreciseInstant.toEpochMs(instant);
  return ms === null ? nowIso : new Date(ms).toISOString();
}

function fromEntity(
  next: EcsPolicyRecomputeJob,
  was: {
    readonly job: PolicyRecomputeJob;
    readonly entity: EcsPolicyRecomputeJob;
  } | null,
  nowIso: string,
  texts: InstantTexts,
): PolicyRecomputeJob {
  const before = was?.entity ?? null;
  const stored = was?.job ?? null;
  return {
    generation: next.generation,
    changedAt: changedAtText(next, texts, nowIso),
    cursor: next.cursor,
    storedClients: next.storedClients,
    recomputed: next.recomputed,
    failed: next.failed,
    startedAt: textOf(
      next.startedAtUtcMs,
      before?.startedAtUtcMs ?? null,
      stored?.startedAt ?? null,
      nowIso,
    ),
    updatedAt: textOf(
      next.updatedAtUtcMs,
      before?.updatedAtUtcMs ?? null,
      stored?.updatedAt ?? null,
      nowIso,
    ),
    finishedAt: textOrNull(
      next.finishedAtUtcMs,
      before?.finishedAtUtcMs ?? null,
      stored?.finishedAt ?? null,
      nowIso,
    ),
    stalledAt: textOrNull(
      next.stalledAtUtcMs,
      before?.stalledAtUtcMs ?? null,
      stored?.stalledAt ?? null,
      nowIso,
    ),
    lastFailureCode: next.lastFailureCode,
    windowHours: next.windowHours,
  };
}
