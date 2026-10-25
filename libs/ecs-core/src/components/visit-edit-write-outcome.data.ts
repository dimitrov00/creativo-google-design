/**
 * What one write of the staff visit sheet came to — the field
 * `visitEditWriteOutcome` (pass D, D-10.1; replaces the dashboard's boolean
 * `EditorWrite { batch; sides; stale }`), the ONLY source of these strings.
 * Beside it the write says whether the side documents (the team note, the
 * tip) landed (`sidesWritten`).
 */
export const VisitEditWriteOutcome = {
  /**
   * Refused before anything went out: a side field the write carries was
   * changed by somebody else under the draft (`VisitSidesSystem.movedUnder`).
   */
  Stale: 'STALE',
  /** The staff-edit batch was refused (or could not be built); nothing beside it was written. */
  BatchRefused: 'BATCH_REFUSED',
  /** The batch landed (or there was none to send); the side documents followed. */
  Written: 'WRITTEN',
} as const;
export type VisitEditWriteOutcome =
  (typeof VisitEditWriteOutcome)[keyof typeof VisitEditWriteOutcome];
