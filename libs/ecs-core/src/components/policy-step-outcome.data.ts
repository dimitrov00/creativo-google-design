/*
 * How one step delivery left the policy recompute job — the continue
 * pipeline's answer, the edge logs it. A tag dictionary is a component
 * (D-7); split out of `policy-recompute-outcome.data.ts` (pass D, S-21: one
 * dictionary per file, L-1), values unchanged.
 */

/** How one delivery left the job — the ONLY source of these strings, the field `policyStepOutcome`. */
export const PolicyStepOutcome = {
  /** No job, its pass is finished, or it is stalled and waits for the sweep. */
  Idle: 'IDLE',
  /** The job moved on without this delivery. */
  Superseded: 'SUPERSEDED',
  /** A step taken; its write of the job fires the next. */
  Advanced: 'ADVANCED',
  /** The last step: every stored client is on the new line. */
  Finished: 'FINISHED',
  /** The step could not move the pass. */
  Stalled: 'STALLED',
} as const;
export type PolicyStepOutcome =
  (typeof PolicyStepOutcome)[keyof typeof PolicyStepOutcome];
