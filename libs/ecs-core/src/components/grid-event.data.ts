/**
 * What a block in a staff grid column is — the field `gridEvent`, the ONLY
 * source of these strings (moved from `grid-layout.system.ts`, values
 * unchanged).
 */
export const GridEvent = {
  /** A booking. */
  Visit: 'VISIT',
  /** A sellable hole — the ABSENCE of a booking, never a collision. */
  Gap: 'GAP',
  /** Time carved OUT of the worked day (a break, an admin hour). */
  Block: 'BLOCK',
} as const;
export type GridEvent = (typeof GridEvent)[keyof typeof GridEvent];
