/**
 * Where a shop stands against its week at one wall-clock minute — the field
 * `shopOpening` (Law 6), the answer of `RosterSystem.shopOpeningAt` (moved
 * from the landing's locations component, values unchanged). The words are
 * the reader's. Split out of `opening-hours.data.ts` (pass D, D-7: it types
 * no `DayHours` field).
 */
export const ShopOpening = {
  /** Open, and the door closes at the answered minute. */
  ClosesAt: 'CLOSES_AT',
  /** Open, with at most `DayHours.CLOSES_SOON_MINUTES` left before it closes. */
  ClosesSoon: 'CLOSES_SOON',
  /** Closed now; today's hours start at the answered minute (or none is known). */
  OpensAt: 'OPENS_AT',
  /** Closed for today; it opens on the answered later day, at the answered minute. */
  OpensOn: 'OPENS_ON',
} as const;
export type ShopOpening = (typeof ShopOpening)[keyof typeof ShopOpening];
