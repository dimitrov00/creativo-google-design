import type { PreciseInstant } from './precise-instant.data';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1).
 */

/**
 * THE POLICY PASS a stored answer was judged by (`client-stats-document.ts:
 * 364-395`): a pass stamps every client it judges with its generation and
 * change instant, and a pass whose change is OLDER than the stamp it finds
 * writes nothing — a superseded pass's late write never overwrites a newer
 * answer. Writers that are not a pass carry the stamp forward. A VALUE type
 * for `PolicyRecomputeJobSystem.judgePolicyPass`; stored, it is the flat
 * `PolicyPassStamp`.
 */
export type PolicyPass = {
  /** The pass's job generation (`PolicyRecomputeJob.generation`). */
  readonly generation: string;
  /** The settings write it answers — what orders two passes (§9 D17). */
  readonly changedAt: PreciseInstant;
};

export const PolicyPass = {
  of(generation: string, changedAt: PreciseInstant): PolicyPass {
    return { generation, changedAt };
  },
} as const;
