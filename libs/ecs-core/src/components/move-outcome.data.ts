/*
 * How one client move ended — `rescheduleAppointment`'s answer from its
 * transaction (pass D, D-7.7; moved out of the pipelines tier, name and
 * field kept). A tag dictionary is a component (D-7); its values are
 * internal — the call answers `replayed`, never the tag.
 */

/** How a client's move ended — the ONLY source of these strings, the field `moveOutcome`. */
export const MoveOutcome = {
  /** The visit was moved: written at the next revision. */
  Moved: 'MOVED',
  /** The named move had already been applied: its original answer, nothing written. */
  Replayed: 'REPLAYED',
  /** The request names exactly where the visit already is: nothing written, nothing logged. */
  Unchanged: 'UNCHANGED',
} as const;
export type MoveOutcome = (typeof MoveOutcome)[keyof typeof MoveOutcome];
