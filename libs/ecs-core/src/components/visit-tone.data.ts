/**
 * How a visit's day tile is drawn — the field `visitTone`, the ONLY source
 * of these strings (`VisitStorySystem.toneOf`):
 *
 * - `HOLLOW` — a visit that did not happen (called off, or nobody came),
 *   whatever its day; it wins over the two below;
 * - `UPCOMING` — an hour still to come on the shop's wall clock;
 * - `PAST` — everything else.
 *
 * A tag, never a word: the row's presenter maps it to its own tile tone.
 */
export const VisitTone = {
  Hollow: 'HOLLOW',
  Upcoming: 'UPCOMING',
  Past: 'PAST',
} as const;
export type VisitTone = (typeof VisitTone)[keyof typeof VisitTone];
