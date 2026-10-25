/*
 * How one `runBackfill` call ended, for its audit row — the pipeline's
 * tag. A pipeline-local dictionary moved to components under its domain
 * name (pass D, S-21, D-7.7: was `CallEnd`, field `callEnd`), values
 * unchanged and internal — the audit row records `BackfillOutcome`, never
 * this tag.
 */

/** How a backfill call ended — the ONLY source of these strings, the field `backfillCallEnd`. */
export const BackfillCallEnd = {
  /** The call returned a page. */
  Returned: 'RETURNED',
  /** The call failed. */
  Failed: 'FAILED',
} as const;
export type BackfillCallEnd =
  (typeof BackfillCallEnd)[keyof typeof BackfillCallEnd];
