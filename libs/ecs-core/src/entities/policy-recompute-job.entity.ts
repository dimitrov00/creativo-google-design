import type { PreciseInstant } from '../components/client-stats.data';

/**
 * The stored `job` tag (`policy-recompute-plan.ts:24,112`) — the ONLY source
 * of this string. A different job from the `BackfillJobKind`s, though it
 * lives one document over in the same `backfillJobs/` collection.
 */
export const PolicyRecomputeJobKind = {
  ClientStatsPolicy: 'clientStatsPolicy',
} as const;
export type PolicyRecomputeJobKind =
  (typeof PolicyRecomputeJobKind)[keyof typeof PolicyRecomputeJobKind];

/** `backfillJobs/{id}` — the pass's document id, a brand like every entity id. */
export type PolicyRecomputeJobId = string & {
  readonly __brand: unique symbol;
};
export const PolicyRecomputeJobId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): PolicyRecomputeJobId => raw as PolicyRecomputeJobId,
  /**
   * The one document id there is (`POLICY_RECOMPUTE_JOB`,
   * `policy-recompute-plan.ts:24`) — the id IS the job's tag.
   */
  FIXED: PolicyRecomputeJobKind.ClientStatsPolicy,
} as const;

/**
 * `backfillJobs/clientStatsPolicy` — ONE pass over the stored clients for one
 * booking-policy change (`policy-recompute-plan.ts:34-66`), a different
 * document from the backfill cursor (blueprint §2.6). Moving the late-cancel
 * line re-judges every client, which does not fit one invocation, so the pass
 * walks the clients in id order a time-budgeted step at a time, and each
 * step's write of this document fires the next.
 *
 * `changedAt` orders two passes at full precision (§9 D17: `{ seconds,
 * nanos }`, integer compare — a change is only ever superseded by a NEWER
 * one). `stepKey` is the compare-and-set key of the continuation a delivery
 * was fired for (today's `sameStep` over generation, cursor and finish): a
 * redelivered or overtaken step, or a superseded pass, fails it and writes
 * nothing, so the chain has exactly one continuation.
 */
export type PolicyRecomputeJobEntity = {
  readonly id: PolicyRecomputeJobId;
  readonly job: PolicyRecomputeJobKind;
  /** The settings write this pass answers — its event id (or a `sweep:` generation). */
  readonly generation: string;
  /** That write's time, at full precision. */
  readonly changedAt: PreciseInstant;
  /** The last `clientStats` id this pass finished; `null` at the top. */
  readonly cursor: string | null;
  /** Stored clients walked. */
  readonly storedClients: number;
  /** Of those, answers that changed and were written. */
  readonly recomputed: number;
  /** Clients dropped on a permanent failure — `runBackfill('clientStats')` repairs them. */
  readonly failed: number;
  readonly startedAtMs: number;
  /** When the pass last MOVED — what the daily sweep measures staleness by. */
  readonly updatedAtMs: number;
  /** Set when the walk ran off the end; the job then rests until the next change. */
  readonly finishedAtMs: number | null;
  readonly stepKey: string;
  /** Set when a step could not move the pass and a redelivery cannot help. */
  readonly stalledAtMs: number | null;
  /** The canonical code of the failure that stalled the pass — codes only (T5). */
  readonly lastFailureCode: string | null;
  /**
   * The free-cancellation window, in hours, the starting change drew the late
   * line at; `null` on a job written before the field, or started by a change
   * that did not say.
   */
  readonly windowHours: number | null;
};
