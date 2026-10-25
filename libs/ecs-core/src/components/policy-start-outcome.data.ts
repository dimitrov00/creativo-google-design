/*
 * How a settings write left the policy recompute job — the start pipeline's
 * answer, the edge logs it. A tag dictionary is a component (D-7); split
 * out of `policy-recompute-outcome.data.ts` (pass D, S-21: one dictionary
 * per file, L-1), values unchanged.
 */

/** How a settings write left the recompute job — the ONLY source of these strings, the field `policyStartOutcome`. */
export const PolicyStartOutcome = {
  /** The write moved no late line: nothing to re-judge. */
  Unmoved: 'UNMOVED',
  /** A pass (re)started from the top. */
  Started: 'STARTED',
  /** This change's pass, or a newer one's, already owns the job. */
  Unchanged: 'UNCHANGED',
} as const;
export type PolicyStartOutcome =
  (typeof PolicyStartOutcome)[keyof typeof PolicyStartOutcome];
