import type { EpochSeconds, SubsecondNanos } from '@core/primitives';
import type { PolicyPass } from './policy-pass.data';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1).
 */

/**
 * The policy pass as the stats document stores it — the 1-to-1 nullable
 * `policyPass` flattened by prefix (N9), the D17 instant as its two branded
 * halves. The three fields are `null` together: no pass has judged this
 * answer yet (most documents, today).
 */
export type PolicyPassStamp = {
  readonly policyPassGeneration: string | null;
  readonly policyPassChangedAtSeconds: EpochSeconds | null;
  readonly policyPassChangedAtNanos: SubsecondNanos | null;
};

const NO_POLICY_PASS: PolicyPassStamp = {
  policyPassGeneration: null,
  policyPassChangedAtSeconds: null,
  policyPassChangedAtNanos: null,
};

export const PolicyPassStamp = {
  /** No pass has judged the answer. */
  NONE: NO_POLICY_PASS,

  /** The stamp a pass leaves — {@link NONE} for no pass. */
  of(judgedBy: PolicyPass | null): PolicyPassStamp {
    if (judgedBy === null) return NO_POLICY_PASS;
    return {
      policyPassGeneration: judgedBy.generation,
      policyPassChangedAtSeconds: judgedBy.changedAt.seconds,
      policyPassChangedAtNanos: judgedBy.changedAt.nanos,
    };
  },

  /** The pass a stamp records, or `null` when it records none (any field missing). */
  read(stamp: PolicyPassStamp): PolicyPass | null {
    if (
      stamp.policyPassGeneration === null ||
      stamp.policyPassChangedAtSeconds === null ||
      stamp.policyPassChangedAtNanos === null
    ) {
      return null;
    }
    return {
      generation: stamp.policyPassGeneration,
      changedAt: {
        seconds: stamp.policyPassChangedAtSeconds,
        nanos: stamp.policyPassChangedAtNanos,
      },
    };
  },
} as const;
