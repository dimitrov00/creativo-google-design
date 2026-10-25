import type { UtcEpochMs } from '@core/primitives';
import type { WriteOp } from './write-op.data';

/*
 * The client-stats revision guard's verdict (`ClientStatsSystem.planWrite`)
 * — its tag and the plan it types. Moved out of `client-stats.system.ts`
 * (pass D, S-21; D-7.4: a tag dictionary and the union it types are
 * components), values unchanged.
 */

/** The revision guard's verdict tags — the ONLY source of these strings, the field `statsWriteDecision`. */
export const StatsWriteDecision = {
  Unchanged: 'UNCHANGED',
  Write: 'WRITE',
} as const;
export type StatsWriteDecision =
  (typeof StatsWriteDecision)[keyof typeof StatsWriteDecision];

/** What the revision guard decided, discriminated by `statsWriteDecision`. */
export type ClientStatsWritePlan =
  ClientStatsWritePlan.Unchanged | ClientStatsWritePlan.Write;

export const ClientStatsWritePlan = {
  /** The same answer: nothing written, or the stamp's move alone. */
  unchanged(writes: readonly WriteOp[]): ClientStatsWritePlan.Unchanged {
    return { statsWriteDecision: StatsWriteDecision.Unchanged, writes };
  },

  /** A new answer: both documents written at one new version. */
  write(
    version: number,
    updatedAtUtcMs: UtcEpochMs,
    writes: readonly WriteOp[],
  ): ClientStatsWritePlan.Write {
    return {
      statsWriteDecision: StatsWriteDecision.Write,
      version,
      updatedAtUtcMs,
      writes,
    };
  },
} as const;

export namespace ClientStatsWritePlan {
  export type Unchanged = {
    readonly statsWriteDecision: typeof StatsWriteDecision.Unchanged;
    /** Nothing, or the stamp's move alone. */
    readonly writes: readonly WriteOp[];
  };
  export type Write = {
    readonly statsWriteDecision: typeof StatsWriteDecision.Write;
    readonly version: number;
    readonly updatedAtUtcMs: UtcEpochMs;
    /** Both documents, at one version. */
    readonly writes: readonly WriteOp[];
  };
}
