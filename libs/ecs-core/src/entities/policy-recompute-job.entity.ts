import type {
  PolicyRecomputeJobId,
  CustomerId,
  EpochSeconds,
  HourCount,
  SubsecondNanos,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The policy pass's job tag — the ONLY source of this string, the job's own
 * field `recomputeJobName` (N15). A different job from the
 * `BackfillJobName`s, though it lives one document over in the same
 * `backfillJobs/` collection (document id `PolicyRecomputeJobId.FIXED`,
 * the tag string kept as a stable path key by flip (1) — OQ-9).
 */
export const RecomputeJobName = {
  ClientStatsPolicy: 'CLIENT_STATS_POLICY',
} as const;
export type RecomputeJobName =
  (typeof RecomputeJobName)[keyof typeof RecomputeJobName];

/**
 * `backfillJobs/clientStatsPolicy` — ONE pass over the stored clients for one
 * booking-policy change (`policy-recompute-plan.ts:34-66`), a different
 * document from the backfill cursor (blueprint §2.6), one flat archetype
 * (Law 6). Moving the late-cancel line re-judges every client, which does
 * not fit one invocation, so the pass walks the clients in id order a
 * time-budgeted step at a time, and each step's write of this document
 * fires the next.
 *
 * `changedAtSeconds` + `changedAtNanos` order two passes at full precision
 * (§9 D17, flattened: `PreciseInstant` halves, a change is only ever
 * superseded by a NEWER one). `stepKey` is the compare-and-set key of the
 * continuation a delivery was fired for (today's `sameStep` over
 * generation, cursor and finish): a redelivered or overtaken step, or a
 * superseded pass, fails it and writes nothing, so the chain has exactly
 * one continuation.
 */
export type PolicyRecomputeJob = {
  readonly id: PolicyRecomputeJobId;
  readonly recomputeJobName: RecomputeJobName;
  /** The settings write this pass answers — its event id (or a `sweep:` generation). */
  readonly generation: string;
  /** That write's time, whole seconds (D17). */
  readonly changedAtSeconds: EpochSeconds;
  /** That write's time, the nanoseconds inside its second (D17). */
  readonly changedAtNanos: SubsecondNanos;
  /** The last `clientStats` id (a client record, D29) this pass finished; `null` at the top. */
  readonly cursor: CustomerId | null;
  /** Stored clients walked. */
  readonly storedClients: number;
  /** Of those, answers that changed and were written. */
  readonly recomputed: number;
  /** Clients dropped on a permanent failure — the `CLIENT_STATS` backfill repairs them. */
  readonly failed: number;
  readonly startedAtUtcMs: UtcEpochMs;
  /** When the pass last MOVED — what the daily sweep measures staleness by. */
  readonly updatedAtUtcMs: UtcEpochMs;
  /** Set when the walk ran off the end; the job then rests until the next change. */
  readonly finishedAtUtcMs: UtcEpochMs | null;
  readonly stepKey: string;
  /** Set when a step could not move the pass and a redelivery cannot help. */
  readonly stalledAtUtcMs: UtcEpochMs | null;
  /** The canonical code of the failure that stalled the pass — codes only (T5). */
  readonly lastFailureCode: string | null;
  /**
   * The free-cancellation window, in hours, the starting change drew the late
   * line at; `null` on a job written before the field, or started by a change
   * that did not say.
   */
  readonly windowHours: HourCount | null;
};
