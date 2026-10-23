/**
 * The status a visit's row or card names beside it — the field
 * `visitStatusMark`, the ONLY source of these strings
 * (`VisitStorySystem.statusMark`):
 *
 * - `NO_SHOW` — nobody came (the row's own outcome);
 * - `PENDING` — an hour still open that the shop has not confirmed;
 * - `CONFIRMED` — an hour still open that the shop has confirmed.
 *
 * No mark (`null`) for anything else: a worked visit, a cancellation (its
 * side is `CancelledSide`'s). Which surface words which mark is the
 * presenter's — a tag, never a word.
 */
export const VisitStatusMark = {
  NoShow: 'NO_SHOW',
  Pending: 'PENDING',
  Confirmed: 'CONFIRMED',
} as const;
export type VisitStatusMark =
  (typeof VisitStatusMark)[keyof typeof VisitStatusMark];
