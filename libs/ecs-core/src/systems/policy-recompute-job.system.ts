import { BookingPolicy } from '../components/booking-policy.data';
import {
  type PolicyPass,
  PreciseInstant,
} from '../components/client-stats.data';
import {
  PolicyRecomputeJobId,
  PolicyRecomputeJobKind,
  type PolicyRecomputeJobEntity,
} from '../entities/policy-recompute-job.entity';

/**
 * The policy-change recompute's job, as decisions (`apps/functions/src/lib/
 * clients/policy-recompute-plan.ts:128-394`, and the pass guard of
 * `client-stats-projection.ts:233-284`): when a booking-policy change
 * starts or restarts the pass over the stored clients, how one step
 * advances it, when a stalled pass is nudged or a dropped start caught up,
 * and whether a client's recompute may write under its pass.
 *
 * Moving the late-cancel line re-judges EVERY client, which does not fit one
 * invocation, so the pass is a walk over the stored clients in id order, a
 * time-budgeted step at a time, and each step's write of the job document
 * fires the next. The job's `stepKey` is the compare-and-set key of the
 * continuation a delivery was fired for.
 *
 * Instants that order two changes are `PreciseInstant`s (§9 D17): integer
 * compare, to the nanosecond. One that is not a valid instant (what an
 * unreadable stored stamp reads as) never proves an order — the
 * conservative answer is always to write, never to skip.
 */

/** How long a pass may go without moving before the sweep nudges it. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/** The generation a pass the sweep starts is filed under — never an event id. */
const SWEEP_GENERATION_PREFIX = 'sweep:';

const NANOS_PER_SECOND = 1_000_000_000;

/** A settings write that moved the late line. */
export type PolicyChange = {
  /** The write's event id — the pass's generation. */
  readonly generation: string;
  /** The write's time, at full precision. */
  readonly changedAt: PreciseInstant;
  /** The window the write drew the line at; `null` when the caller does not know. */
  readonly windowHours: number | null;
};

/** What one step of the walk got through. */
export type PolicyStep = {
  /** The last client finished; the cursor the next step starts after. */
  readonly cursor: string | null;
  /** The walk ran off the end of the stored clients. */
  readonly exhausted: boolean;
  readonly visited: number;
  readonly recomputed: number;
  readonly failed: number;
};

/** The booking policy as the daily sweep reads it: its line, and when it last changed. */
export type LivePolicyLine = {
  /** The policy document's update time; `null` when there is no document. */
  readonly updatedAt: PreciseInstant | null;
  /** The free-cancellation window in force — the defaults' when there is no document. */
  readonly windowHours: number;
};

/** The pass-guard verdict tags — the ONLY source of these strings. */
export const PolicyPassVerdictKind = {
  /** A newer pass has judged this client: write nothing. */
  Superseded: 'superseded',
  /** Judge the client. */
  Judge: 'judge',
} as const;
export type PolicyPassVerdictKind =
  (typeof PolicyPassVerdictKind)[keyof typeof PolicyPassVerdictKind];

/**
 * What a client's recompute may do, given its own pass and the stamp it
 * found. On `judge`, `stamp` is what the written document carries (one of
 * the two inputs, by reference), and `restamp` says the stored one must
 * move to it even when the answer itself is unchanged — a newer pass must
 * leave its mark on every client it reaches.
 */
export type PolicyPassVerdict =
  | { readonly kind: typeof PolicyPassVerdictKind.Superseded }
  | {
      readonly kind: typeof PolicyPassVerdictKind.Judge;
      readonly stamp: PolicyPass | null;
      readonly restamp: boolean;
    };

function isInstant(instant: PreciseInstant): boolean {
  return (
    Number.isSafeInteger(instant.seconds) &&
    Number.isInteger(instant.nanos) &&
    instant.nanos >= 0 &&
    instant.nanos < NANOS_PER_SECOND
  );
}

/** The job with its step key re-derived from the fields the key covers. */
function keyed(job: PolicyRecomputeJobEntity): PolicyRecomputeJobEntity {
  return {
    ...job,
    stepKey: PolicyRecomputeJobSystem.stepKeyOf(
      job.generation,
      job.cursor,
      job.finishedAtMs,
    ),
  };
}

export const PolicyRecomputeJobSystem = {
  STALE_AFTER_MS,
  SWEEP_GENERATION_PREFIX,

  /**
   * The order of two instants at FULL precision — negative, zero or
   * positive — or `null` when either is not a valid instant. Not epoch ms:
   * a Firestore event's time is stamped in microseconds, so two settings
   * writes inside one millisecond must still order.
   */
  compareInstants(a: PreciseInstant, b: PreciseInstant): number | null {
    if (!isInstant(a) || !isInstant(b)) return null;
    return PreciseInstant.compare(a, b);
  },

  /**
   * The compare-and-set key of a step: the pass, where it stands and
   * whether it finished — what `sameStep` compares, as one stored string.
   */
  stepKeyOf(
    generation: string,
    cursor: string | null,
    finishedAtMs: number | null,
  ): string {
    return JSON.stringify(['policy-step/v1', generation, cursor, finishedAtMs]);
  },

  /**
   * The pass a policy change asks for, or `null` to leave the job as it is.
   *
   * - The same change delivered again: its pass is already running or done.
   * - An OLDER change delivered late: the pass running or done was started
   *   by a newer one, and every step reads the live policy, so it already
   *   judges by a line at least as new.
   * - Anything else — no job yet, a newer change, one at the same instant —
   *   (re)starts from the top. A running pass is SUPERSEDED: its in-flight
   *   step fails `sameStep` and stops, and the last change has the last word.
   */
  nextStep(
    current: PolicyRecomputeJobEntity | null,
    change: PolicyChange,
    nowMs: number,
  ): PolicyRecomputeJobEntity | null {
    if (current !== null) {
      if (current.generation === change.generation) return null;
      const order = PolicyRecomputeJobSystem.compareInstants(
        change.changedAt,
        current.changedAt,
      );
      if (order !== null && order < 0) return null;
    }
    return {
      id: PolicyRecomputeJobId.of(PolicyRecomputeJobId.FIXED),
      job: PolicyRecomputeJobKind.ClientStatsPolicy,
      generation: change.generation,
      changedAt: change.changedAt,
      cursor: null,
      storedClients: 0,
      recomputed: 0,
      failed: 0,
      startedAtMs: nowMs,
      updatedAtMs: nowMs,
      finishedAtMs: null,
      stepKey: PolicyRecomputeJobSystem.stepKeyOf(
        change.generation,
        null,
        null,
      ),
      stalledAtMs: null,
      lastFailureCode: null,
      windowHours: change.windowHours,
    };
  },

  /**
   * Is the job still at the step a delivery was fired for? A redelivered or
   * duplicated event, a step overtaken by another, or a pass superseded by a
   * newer change all fail it and write nothing — so the chain has exactly
   * one continuation.
   */
  sameStep(a: PolicyRecomputeJobEntity, b: PolicyRecomputeJobEntity): boolean {
    return (
      a.generation === b.generation &&
      a.cursor === b.cursor &&
      Object.is(a.finishedAtMs, b.finishedAtMs)
    );
  },

  /**
   * The job after one step. Every step that is not the last moves the
   * cursor, so each advance is a real change — the write that fires the
   * next step — and the chain cannot spin in place. A step that moved the
   * pass ends any stall before it.
   */
  advance(
    job: PolicyRecomputeJobEntity,
    step: PolicyStep,
    nowMs: number,
  ): PolicyRecomputeJobEntity {
    return keyed({
      ...job,
      cursor: step.cursor,
      storedClients: job.storedClients + step.visited,
      recomputed: job.recomputed + step.recomputed,
      failed: job.failed + step.failed,
      updatedAtMs: nowMs,
      finishedAtMs: step.exhausted ? nowMs : null,
      stalledAtMs: null,
      lastFailureCode: null,
    });
  },

  /**
   * The job with the record of a permanent stall. The cursor and counts
   * stay, and so does `updatedAtMs`, which keeps saying when the pass last
   * MOVED: that is what the sweep measures staleness by. Still the same
   * step — a stall is no step of its own.
   */
  stall(
    job: PolicyRecomputeJobEntity,
    code: string,
    nowMs: number,
  ): PolicyRecomputeJobEntity {
    return { ...job, stalledAtMs: nowMs, lastFailureCode: code };
  },

  /**
   * The daily sweep's verdict: the job rewritten to fire its step once
   * more, or `null` to leave it. An unfinished pass that has not moved for
   * `staleAfterMs` stalled, and nothing else will fire its next step; the
   * nudge moves `updatedAtMs` and clears the stall, keeping the step — so it
   * meets the same compare-and-set as any delivery, and a second sweep finds
   * a fresh `updatedAtMs` and writes nothing. An unreadable time cannot
   * prove the pass is moving: it is nudged.
   */
  nudge(
    job: PolicyRecomputeJobEntity | null,
    nowMs: number,
    staleAfterMs: number = STALE_AFTER_MS,
  ): PolicyRecomputeJobEntity | null {
    if (job === null || job.finishedAtMs !== null) return null;
    const quietMs = nowMs - job.updatedAtMs;
    if (!Number.isNaN(quietMs) && quietMs < staleAfterMs) return null;
    return { ...job, updatedAtMs: nowMs, stalledAtMs: null };
  },

  /**
   * Does the book owe a pass a DROPPED start never ran? With a job: when the
   * policy changed AFTER the change the job answers (to the nanosecond; no
   * document at all is a change too) AND draws another line than the job —
   * a horizon or lead-time edit moves no line and costs no walk (the
   * owner's rule, refined 2026-09-25; a job that cannot say its line is
   * owed one pass, once). With no job: only when the live window is not the
   * default one the appointments were written under.
   */
  owesCatchUp(
    job: PolicyRecomputeJobEntity | null,
    live: LivePolicyLine,
    defaultWindowHours: number = BookingPolicy.DEFAULT.cancellationWindowHours,
  ): boolean {
    if (job === null) return live.windowHours !== defaultWindowHours;
    const order =
      live.updatedAt === null
        ? null
        : PolicyRecomputeJobSystem.compareInstants(
            live.updatedAt,
            job.changedAt,
          );
    if (order !== null && order <= 0) return false;
    return !(job.windowHours !== null && job.windowHours === live.windowHours);
  },

  /**
   * The daily sweep's catch-up: the pass a dropped policy start owes the
   * book (`owesCatchUp`), started from the top under
   * `SWEEP_GENERATION_PREFIX` + `label` — the change instant as the caller
   * renders it — or `null` when none is owed. Its instant is the policy
   * document's, or `nowMs` when there is no document.
   */
  catchUp(
    job: PolicyRecomputeJobEntity | null,
    live: LivePolicyLine,
    nowMs: number,
    label: string,
    defaultWindowHours: number = BookingPolicy.DEFAULT.cancellationWindowHours,
  ): PolicyRecomputeJobEntity | null {
    if (!PolicyRecomputeJobSystem.owesCatchUp(job, live, defaultWindowHours)) {
      return null;
    }
    return PolicyRecomputeJobSystem.nextStep(
      job,
      {
        generation: `${SWEEP_GENERATION_PREFIX}${label}`,
        changedAt: live.updatedAt ?? PreciseInstant.fromEpochMs(nowMs),
        windowHours: live.windowHours,
      },
      nowMs,
    );
  },

  /**
   * THE POLICY PASS GUARD — a newer pass has the last word. `mine` is the
   * pass doing the recompute, or `null` for a writer that is not one (it
   * carries `stored` forward). An older change than the stamp is
   * superseded; the same generation is a re-run of the same pass; a newer
   * one, one at the same instant, or one whose instant is not valid judges
   * and restamps.
   */
  judgePolicyPass(
    mine: PolicyPass | null,
    stored: PolicyPass | null,
  ): PolicyPassVerdict {
    if (mine === null) {
      return {
        kind: PolicyPassVerdictKind.Judge,
        stamp: stored,
        restamp: false,
      };
    }
    if (stored === null) {
      return { kind: PolicyPassVerdictKind.Judge, stamp: mine, restamp: true };
    }
    if (stored.generation === mine.generation) {
      return {
        kind: PolicyPassVerdictKind.Judge,
        stamp: stored,
        restamp: false,
      };
    }
    const order = PolicyRecomputeJobSystem.compareInstants(
      mine.changedAt,
      stored.changedAt,
    );
    if (order !== null && order < 0) {
      return { kind: PolicyPassVerdictKind.Superseded };
    }
    return { kind: PolicyPassVerdictKind.Judge, stamp: mine, restamp: true };
  },
} as const;
