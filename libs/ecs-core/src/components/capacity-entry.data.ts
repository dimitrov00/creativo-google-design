import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { DayKey } from './day-key.data';

/**
 * One barber's free minutes on one day at one shop — an entry of the
 * `capacity/{YYYY-MM}` month document's sorted `entries[]` (§9 D7; the
 * dynamic `days.{dayKey}.{barberId}.{locationId}` map of `capacity-document.ts`
 * flattened). A projection, rebuilt by triggers from the same window math the
 * commit re-check runs; a barber with nothing free simply has no entry —
 * absent and zero render the same.
 *
 * Sorted by `(dayKey, barberId, locationId)`, one entry per key, so a month
 * view is one read and a linear scan.
 */
export type CapacityEntry = {
  readonly dayKey: DayKey;
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly freeMinutes: number;
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const CapacityEntry = {
  of(
    dayKey: DayKey,
    barberId: BarberId,
    locationId: LocationId,
    freeMinutes: number,
  ): CapacityEntry {
    return { dayKey, barberId, locationId, freeMinutes };
  },

  /**
   * The entry's identity as one string, `dayKey|barberId|locationId` — for
   * equality and de-duplication only (ids never contain `|`). It is NOT a
   * sort key: `ana|…` sorts after `ana2|…` although `ana` precedes `ana2`;
   * the document's order is {@link compare}.
   */
  keyOf(entry: CapacityEntry): string {
    return `${entry.dayKey}|${entry.barberId}|${entry.locationId}`;
  },

  /** The month document an entry (or a day) belongs to: `2026-08-14` → `2026-08`. */
  monthOf(dayKey: DayKey): string {
    return dayKey.slice(0, 7);
  },

  /** The month document's order: day, then barber, then shop. */
  compare(a: CapacityEntry, b: CapacityEntry): number {
    return (
      compareStrings(a.dayKey, b.dayKey) ||
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
    dayKey: DayKey,
    barberIds: readonly BarberId[],
    locationId: LocationId | null,
  ): number {
    let total = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as CapacityEntry;
      if (entry.dayKey < dayKey) continue;
      if (entry.dayKey > dayKey) break;
      if (!barberIds.includes(entry.barberId)) continue;
      if (locationId !== null && entry.locationId !== locationId) continue;
      total += entry.freeMinutes;
    }
    return total;
  },
} as const;
