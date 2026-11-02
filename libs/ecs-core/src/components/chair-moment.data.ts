/**
 * Where a chair stands at this moment, as its row's clock says it — the field
 * `chairMoment`, the ONLY source of these strings
 * (`VisitStorySystem.chairMoment`), in precedence order:
 *
 * - `HOLLOW` — the hour did not happen (called off, or nobody came); it wins
 *   over everything below;
 * - `IN_CHAIR` — the visit is running now;
 * - `ARRIVED` — the party is in the shop and the chair is not settled;
 * - `SCHEDULED` — everything else: still to come, or finished.
 *
 * A tag, never a word: the page words it.
 */
export const ChairMoment = {
  Hollow: 'HOLLOW',
  InChair: 'IN_CHAIR',
  Arrived: 'ARRIVED',
  Scheduled: 'SCHEDULED',
} as const;
export type ChairMoment = (typeof ChairMoment)[keyof typeof ChairMoment];
