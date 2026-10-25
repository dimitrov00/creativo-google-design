/*
 * What the daily sweep did to the policy recompute job — the sweep
 * pipeline's answer, the edge logs it. A tag dictionary is a component
 * (D-7); split out of `policy-recompute-outcome.data.ts` (pass D, S-21: one
 * dictionary per file, L-1), values unchanged.
 */

/** What the daily sweep did to the job — the ONLY source of these strings, the field `policySweepOutcome`. */
export const PolicySweepOutcome = {
  /** No job, a finished one, or one that moved within the hour — and no dropped change. */
  Idle: 'IDLE',
  /** A policy change whose start was dropped: its pass started from the top. */
  Started: 'STARTED',
  /** An unfinished pass that had stopped moving: its step fired again. */
  Nudged: 'NUDGED',
  /** The policy or the job could not be read or written. */
  Failed: 'FAILED',
} as const;
export type PolicySweepOutcome =
  (typeof PolicySweepOutcome)[keyof typeof PolicySweepOutcome];
