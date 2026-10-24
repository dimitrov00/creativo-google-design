/*
 * How one client's statistics recompute ended — the projection pipeline's
 * answer (`project-client-stats.pipeline.ts`). A tag dictionary is a
 * component (D-7; moved out of the pipelines tier in pass C, §5 item 1).
 */

/** How one client's recompute ended — the ONLY source of these strings, the field `statsOutcome`. */
export const ClientStatsOutcome = {
  /** The answer changed: both documents written at a new version. */
  Written: 'WRITTEN',
  /** The same answer (perhaps with the newer pass's stamp moved onto it). */
  Unchanged: 'UNCHANGED',
  /** A NEWER policy pass has judged this client: nothing written. */
  Superseded: 'SUPERSEDED',
} as const;
export type ClientStatsOutcome =
  (typeof ClientStatsOutcome)[keyof typeof ClientStatsOutcome];
