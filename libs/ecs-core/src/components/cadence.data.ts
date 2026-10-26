/**
 * A client's rhythm — the mean gap between their worked visits, in SHOP
 * CALENDAR DAYS, to one decimal: the card's `avgCadenceDays` («на ~N
 * седмици») and a personal streak's habit. OR-46: a multi-day span is
 * `LocalDate` arithmetic (flatten-spec T8), so the time of day and a DST
 * weekend between two visits leak into neither figure, and the card and the
 * rhythm share ONE gap rule — whole days between the two visits' shop days,
 * a same-day pair being no gap at all (the caller skips it) — and ONE mean
 * ({@link Cadence.meanDays}).
 */
export type Cadence = number;

export const Cadence = {
  /**
   * The mean of `gaps` day gaps summing to `totalDays`, rounded to one
   * decimal — enough for "every ~4 weeks", and a stable number to store.
   * `null` when there is no gap to measure (`gaps < 1`).
   */
  meanDays(totalDays: number, gaps: number): Cadence | null {
    if (gaps < 1) return null;
    return Math.round((totalDays / gaps) * 10) / 10;
  },
} as const;
