/*
 * The policy recompute's answers — how a settings write left the job, how
 * one step delivery left it, and what the daily sweep did to it. Tag
 * dictionaries are components (D-7; moved out of the pipelines tier in
 * pass C, §5 item 1): the pipelines answer them, the edge logs them.
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
