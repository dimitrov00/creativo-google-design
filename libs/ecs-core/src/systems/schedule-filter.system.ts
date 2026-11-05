import type { BookingStatus } from '@core/primitives';

/** The slice the schedule's status filter reads — any visit carrying it is accepted as is. */
export type BookingStatusSlice = {
  readonly bookingStatus: BookingStatus;
};

/**
 * WHICH VISITS THE SCHEDULE DRAWS — the staff's own status filter
 * (owner, 2026-11-05: "filter by statuses"). The filter names the states
 * it HIDES, so a state the product adds later is shown until somebody
 * hides it, and an empty list hides nothing.
 *
 * It decides what is DRAWN, never what is true: the day's free time, its
 * totals and the frames a sheet draws round a visit read every visit.
 */
export const ScheduleFilterSystem = {
  /**
   * The visits whose state is not hidden, in their order — the same array
   * when nothing is hidden. One linear scan; the inputs are read, never
   * written.
   */
  shown<T extends BookingStatusSlice>(
    visits: readonly T[],
    hidden: readonly BookingStatus[],
  ): readonly T[] {
    if (hidden.length === 0) return visits;
    const out: T[] = [];
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i] as T;
      if (!hidden.includes(visit.bookingStatus)) out.push(visit);
    }
    return out;
  },
} as const;
