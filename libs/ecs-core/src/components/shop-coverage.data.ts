/**
 * Can the chosen shop serve the visit — the field `shopCoverage`, the ONLY
 * source of these strings (Law 6). Answered by
 * `BookingCartSystem.shopCoverage` (moved from the booking schedule step,
 * values unchanged): the grid answers, another active shop does, or no
 * active shop offers everything on the visit together.
 */
export const ShopCoverage = {
  /** The grid answers: the chosen shop (or one of "any shop") serves it. */
  Served: 'SERVED',
  /** The chosen shop does not, another active shop does. */
  Elsewhere: 'ELSEWHERE',
  /** No active shop offers everything on the visit together. */
  Nowhere: 'NOWHERE',
} as const;
export type ShopCoverage = (typeof ShopCoverage)[keyof typeof ShopCoverage];
