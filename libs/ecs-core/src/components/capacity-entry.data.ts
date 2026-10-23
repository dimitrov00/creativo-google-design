import {
  MinuteCount,
  type BarberId,
  type LocationId,
  type LocalDate,
} from '@core/primitives';

/**
 * One barber's free minutes on one shop day at one shop — an element of the
 * `capacity/{YYYY-MM}` month document's sorted `entries[]` (§9 D7; the
 * dynamic `days.{dayKey}.{barberId}.{locationId}` map of `capacity-document.ts`
 * flattened). A projection, rebuilt by triggers from the same window math the
 * commit re-check runs; a barber with nothing free simply has no entry —
 * absent and zero render the same.
 *
 * Sorted by `(localDate, barberId, locationId)`, one entry per key, so a
 * month view is one read and a linear scan. (Until the booking-core flip the
 * stored body named the day `dayKey`, and the legacy shim converted it.)
 */
export type CapacityEntry = {
  readonly localDate: LocalDate;
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly freeMinutes: MinuteCount;
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const CapacityEntry = {
  of(
    localDate: LocalDate,
    barberId: BarberId,
    locationId: LocationId,
    freeMinutes: MinuteCount,
  ): CapacityEntry {
    return { localDate, barberId, locationId, freeMinutes };
  },

  /**
   * The entry's identity as one string, `localDate|barberId|locationId` —
   * for equality and de-duplication only (ids never contain `|`). It is NOT
   * a sort key: `ana|…` sorts after `ana2|…` although `ana` precedes `ana2`;
   * the document's order is {@link compare}.
   */
  keyOf(entry: CapacityEntry): string {
    return `${entry.localDate}|${entry.barberId}|${entry.locationId}`;
  },

  /** The month document's order: day, then barber, then shop. */
  compare(a: CapacityEntry, b: CapacityEntry): number {
    return (
      compareStrings(a.localDate, b.localDate) ||
      compareStrings(a.barberId, b.barberId) ||
      compareStrings(a.locationId, b.locationId)
    );
  },

  /**
   * A day's free minutes for the barbers the caller knows, optionally narrowed
   * to one shop — the ONE place the rollup's read semantics live
   * (`capacity-document.ts` `freeMinutesFor`). One linear scan of the sorted
   * entries; a day with no entry is `0`.
   */
  freeMinutesOn(
    entries: readonly CapacityEntry[],
    localDate: LocalDate,
    barberIds: readonly BarberId[],
    locationId: LocationId | null,
  ): MinuteCount {
    let total = MinuteCount.ZERO;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as CapacityEntry;
      if (entry.localDate < localDate) continue;
      if (entry.localDate > localDate) break;
      if (!barberIds.includes(entry.barberId)) continue;
      if (locationId !== null && entry.locationId !== locationId) continue;
      total = MinuteCount.add(total, entry.freeMinutes);
    }
    return total;
  },
} as const;
