/**
 * The marks a worked visit's row carries, in DRAWING order — the field
 * `visitMark`, the ONLY source of these strings (`VisitStorySystem.marksOf`):
 *
 * - `PHOTOS` — the visit has photos;
 * - `DISCOUNT` — the figure beside it is the discounted bill;
 * - `VOUCHER` — a voucher draw that still stands paid some of that bill.
 *
 * A tag, never a word: the presenter picks the glyph and the label.
 */
export const VisitMark = {
  Photos: 'PHOTOS',
  Discount: 'DISCOUNT',
  Voucher: 'VOUCHER',
} as const;
export type VisitMark = (typeof VisitMark)[keyof typeof VisitMark];
