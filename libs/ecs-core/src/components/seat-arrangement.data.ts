/**
 * How one arrangement seats the party — the ONLY source of these strings
 * (Law 6): everybody at once, or one after another. Answered by
 * `BookingCartSystem.arrangementOf` over the arrangement's assignments; the
 * time sheet words it (which sentence heads the arrangement).
 */
export const SeatArrangement = {
  /** Every seat starts at the same minute — side by side (one seat counts). */
  Parallel: 'PARALLEL',
  /** The seats start at different minutes — one after another. */
  Sequential: 'SEQUENTIAL',
} as const;
export type SeatArrangement =
  (typeof SeatArrangement)[keyof typeof SeatArrangement];
