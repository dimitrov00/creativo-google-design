import type { PolicyPass } from './policy-pass.data';

/*
 * The policy pass guard's verdict (`PolicyRecomputeJobSystem.judgePolicyPass`)
 * — its tag and the judgement it types. Moved out of
 * `policy-recompute-job.system.ts` (pass D, S-21; D-7.4: a tag dictionary
 * and the union it types are components), values unchanged.
 */

/** The pass-guard verdict tags — the ONLY source of these strings, the field `policyPassVerdict`. */
export const PolicyPassVerdict = {
  /** A newer pass has judged this client: write nothing. */
  Superseded: 'SUPERSEDED',
  /** Judge the client. */
  Judge: 'JUDGE',
} as const;
export type PolicyPassVerdict =
  (typeof PolicyPassVerdict)[keyof typeof PolicyPassVerdict];

/**
 * What a client's recompute may do, given its own pass and the stamp it
 * found. On `JUDGE`, `stamp` is what the written document carries (one of
 * the two inputs, by reference), and `restamp` says the stored one must
 * move to it even when the answer itself is unchanged — a newer pass must
 * leave its mark on every client it reaches.
 */
export type PolicyPassJudgement =
  PolicyPassJudgement.Superseded | PolicyPassJudgement.Judge;

export const PolicyPassJudgement = {
  /** A newer pass has judged this client. */
  superseded(): PolicyPassJudgement.Superseded {
    return { policyPassVerdict: PolicyPassVerdict.Superseded };
  },

  /** Judge the client, stamping the written document with `stamp`. */
  judge(stamp: PolicyPass | null, restamp: boolean): PolicyPassJudgement.Judge {
    return { policyPassVerdict: PolicyPassVerdict.Judge, stamp, restamp };
  },
} as const;

export namespace PolicyPassJudgement {
  export type Superseded = {
    readonly policyPassVerdict: typeof PolicyPassVerdict.Superseded;
  };
  export type Judge = {
    readonly policyPassVerdict: typeof PolicyPassVerdict.Judge;
    readonly stamp: PolicyPass | null;
    readonly restamp: boolean;
  };
}
