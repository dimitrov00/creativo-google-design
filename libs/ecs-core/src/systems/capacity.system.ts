import { CapacityEntry } from '../components/capacity-entry.data';
import { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import type { DayHours } from '../components/opening-hours.data';
import type { RosterWindow } from '../components/roster-window.data';
import type { ScheduleVersion } from '../components/schedule-version.data';
import type { TimeInterval } from '../components/time-interval.data';
import type { BarberId } from '../entities/barber.entity';
import type { CapacityMonthEntity } from '../entities/capacity-month.entity';
import type { LocationId } from '../entities/location.entity';
import { AvailabilitySystem } from './availability.system';
import { IntervalSetSystem } from './interval-set.system';
import {
  type DayException,
  RosterSystem,
  type ShopHours,
} from './roster.system';
import { ZonedTimeSystem } from './zoned-time.system';

/** The legacy walk's ceiling (`capacity-plan.ts:146`): a longer span is an authoring error. */
const MAX_SPAN_DAYS = 500;

/** One ACTIVE shop's published week (`LocationEntity.openingHours`, Mon-first). */
export type CapacityShopWeek = {
  readonly locationId: LocationId;
  readonly week: readonly DayHours[];
};

/** One day of the barber's busy projection, as the UNPADDED instants it stores. */
export type CapacityBusyDay = {
  readonly dayKey: DayKey;
  readonly spans: readonly TimeInterval[];
};

/** The barber's roster, or `null` when they have none — every day then empties. */
export type CapacitySchedule = {
  readonly versions: readonly ScheduleVersion[];
  readonly turnaroundMinutes: number;
};

/**
 * Everything one barber's capacity rebuild reads (`capacity-plan.ts:32-44`),
 * every field present: the scope (`barberId` × `dayKeys`), the roster, the
 * ACTIVE shops only (an archived shop must not sell hours), the busy days
 * and the published exceptions.
 */
export type CapacityPlanInput = {
  readonly barberId: BarberId;
  readonly dayKeys: readonly DayKey[];
  readonly schedule: CapacitySchedule | null;
  readonly shops: readonly CapacityShopWeek[];
  readonly busy: readonly CapacityBusyDay[];
  readonly exceptions: readonly DayException[];
};

/**
 * One barber's recomputed capacity: the SCOPE it replaces (`barberId` ×
 * `dayKeys`, sorted, distinct) and the entries that replace it, sorted by
 * `CapacityEntry.compare`. A day in scope with no entry is a day whose
 * entries are REMOVED — never left as a ghost.
 */
export type CapacityPlan = {
  readonly barberId: BarberId;
  readonly dayKeys: readonly DayKey[];
  readonly entries: readonly CapacityEntry[];
};

/** The part of a plan one month document takes. */
export type CapacityMonthPlan = CapacityPlan & { readonly month: string };

/** What {@link CapacitySystem.dayKeysBetween} walked, and whether it stopped at the cap. */
export type DayKeySpan = {
  readonly keys: readonly DayKey[];
  readonly truncated: boolean;
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day order for anything keyed by a day (string order is day order). */
function byDayKey(
  a: { readonly dayKey: DayKey },
  b: { readonly dayKey: DayKey },
): number {
  return compareStrings(a.dayKey, b.dayKey);
}

const NO_SPANS: readonly TimeInterval[] = [];
const NO_EXCEPTIONS: readonly DayException[] = [];

function isActiveShop(
  shops: readonly CapacityShopWeek[],
  locationId: LocationId,
): boolean {
  for (let i = 0; i < shops.length; i++) {
    if ((shops[i] as CapacityShopWeek).locationId === locationId) return true;
  }
  return false;
}

/**
 * One day's entries for the barber, sorted by shop (`capacity-plan.ts:76-131`),
 * from the day's own busy spans and exceptions (the caller's cursors).
 */
function entriesFor(
  input: CapacityPlanInput,
  schedule: CapacitySchedule,
  day: DayOffset,
  busy: readonly TimeInterval[],
  exceptions: readonly DayException[],
): readonly CapacityEntry[] {
  const shopHours: ShopHours[] = [];
  for (let i = 0; i < input.shops.length; i++) {
    const shop = input.shops[i] as CapacityShopWeek;
    shopHours.push({
      locationId: shop.locationId,
      hours: RosterSystem.shopDayHours(shop.week, day),
    });
  }
  const windows = RosterSystem.buildDayWindows(
    {
      barberId: input.barberId,
      dayKey: day.dayKey,
      versions: schedule.versions,
      exceptions,
      shopHours,
    },
    [day],
  );
  if (windows.length === 0) return [];

  // The ONE turnaround rule the grid and the commit check by.
  const padded = AvailabilitySystem.paddedBusy({
    barberId: input.barberId,
    spans: busy,
    turnaroundMinutes: schedule.turnaroundMinutes,
    release: [],
  });

  // Windows grouped by shop, in window order. A segment rostered at a shop
  // the ACTIVE set does not know — archived, or a typo — contributes NOTHING:
  // the roster treats an absent hours entry as "no bound", which is right for
  // a shop that never authored hours and wrong for one that was retired.
  const shops: LocationId[] = [];
  const windowsByShop: TimeInterval[][] = [];
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i] as RosterWindow;
    if (!isActiveShop(input.shops, window.locationId)) continue;
    let at = shops.indexOf(window.locationId);
    if (at < 0) {
      at = shops.length;
      shops.push(window.locationId);
      windowsByShop.push([]);
    }
    (windowsByShop[at] as TimeInterval[]).push(
      ...RosterSystem.intervalsOf([window], day),
    );
  }

  const entries: CapacityEntry[] = [];
  for (let i = 0; i < shops.length; i++) {
    const free = IntervalSetSystem.totalMinutes(
      IntervalSetSystem.subtract(windowsByShop[i] as TimeInterval[], padded),
    );
    if (free > 0) {
      entries.push(
        CapacityEntry.of(
          day.dayKey,
          input.barberId,
          shops[i] as LocationId,
          free,
        ),
      );
    }
  }
  return entries.sort(CapacityEntry.compare);
}

/** `dayKeys` distinct and sorted (string order is day order): one sort, then adjacent duplicates dropped. */
function scopeOf(dayKeys: readonly DayKey[]): readonly DayKey[] {
  const sorted = [...dayKeys].sort(compareStrings);
  const out: DayKey[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const key = sorted[i] as DayKey;
    if (out.length === 0 || out[out.length - 1] !== key) out.push(key);
  }
  return out;
}

/**
 * CapacitySystem — the `capacity/{YYYY-MM}` rollup (§9 D7): one barber's free
 * minutes per day per shop (`capacity-plan.ts:56-160`, `rebuild-capacity.ts:
 * 322-351`), from the SAME window math the commit re-check runs — roster ∩
 * the ACTIVE shops' hours, minus the day's exceptions, minus busy padded by
 * the barber's turnaround — and the replace-not-merge fold of a plan into a
 * month document's sorted `entries[]` (§3.6).
 *
 * Day arithmetic is over the zone table (hot path #5): no zone lookup per
 * day, no `Intl`, no `Date`.
 */
export const CapacitySystem = {
  /**
   * One barber's entries for every day of `input.dayKeys`. A day the table
   * does not cover, a barber with no roster, a whole-day absence, a fully
   * booked day and a shop's rest day all yield NO entry — absent and zero
   * render the same, and an emptied day must not survive as a zero.
   */
  planBarberCapacity(
    input: CapacityPlanInput,
    days: readonly DayOffset[],
  ): CapacityPlan {
    const dayKeys = scopeOf(input.dayKeys);
    const entries: CapacityEntry[] = [];
    if (input.schedule !== null) {
      // Busy days and exceptions sorted once (copies — stable, so a day's
      // own keep their input order), then walked by two cursors beside the
      // sorted scope: each day reads its own, never the whole list.
      const busy = [...input.busy].sort(byDayKey);
      const exceptions = [...input.exceptions].sort(byDayKey);
      let b = 0;
      let x = 0;
      for (let i = 0; i < dayKeys.length; i++) {
        const dayKey = dayKeys[i] as DayKey;
        while (
          b < busy.length &&
          (busy[b] as CapacityBusyDay).dayKey < dayKey
        ) {
          b++;
        }
        // The FIRST entry for the day, as the scan it replaces read it.
        const spans =
          b < busy.length && (busy[b] as CapacityBusyDay).dayKey === dayKey
            ? (busy[b] as CapacityBusyDay).spans
            : NO_SPANS;
        while (
          x < exceptions.length &&
          (exceptions[x] as DayException).dayKey < dayKey
        ) {
          x++;
        }
        let end = x;
        while (
          end < exceptions.length &&
          (exceptions[end] as DayException).dayKey === dayKey
        ) {
          end++;
        }
        const own = end === x ? NO_EXCEPTIONS : exceptions.slice(x, end);
        const day = DayOffset.find(dayKey, days);
        if (day === null) continue;
        const dayEntries = entriesFor(input, input.schedule, day, spans, own);
        for (let k = 0; k < dayEntries.length; k++) {
          entries.push(dayEntries[k] as CapacityEntry);
        }
      }
    }
    return { barberId: input.barberId, dayKeys, entries };
  },

  /**
   * A plan split by the month documents it touches (`capacity-plan.ts:54-69`),
   * months in order — each month carries its own slice of the scope and of
   * the entries, both still sorted.
   */
  byMonth(plan: CapacityPlan): readonly CapacityMonthPlan[] {
    const months: CapacityMonthPlan[] = [];
    let e = 0;
    let d = 0;
    while (d < plan.dayKeys.length) {
      const month = CapacityEntry.monthOf(plan.dayKeys[d] as DayKey);
      const dayKeys: DayKey[] = [];
      while (
        d < plan.dayKeys.length &&
        CapacityEntry.monthOf(plan.dayKeys[d] as DayKey) === month
      ) {
        dayKeys.push(plan.dayKeys[d++] as DayKey);
      }
      // Entries are sorted by day, so this month's are one contiguous run.
      while (
        e < plan.entries.length &&
        CapacityEntry.monthOf((plan.entries[e] as CapacityEntry).dayKey) < month
      ) {
        e++;
      }
      const entries: CapacityEntry[] = [];
      while (
        e < plan.entries.length &&
        CapacityEntry.monthOf((plan.entries[e] as CapacityEntry).dayKey) ===
          month
      ) {
        entries.push(plan.entries[e++] as CapacityEntry);
      }
      months.push({ barberId: plan.barberId, month, dayKeys, entries });
    }
    return months;
  },

  /**
   * THE REPLACE-NOT-MERGE FOLD (§3.6): a month document's sorted `entries[]`
   * with every entry in the plan's `(barberId, dayKey)` scope dropped and the
   * plan's own entries for this month merged in at their key position. A
   * two-pointer merge — one pass over both sorted arrays, O(n + m), no sort,
   * no allocation beyond the result and one scope set. Other barbers' entries
   * are untouched; a scoped day with no new contribution disappears, never
   * left as a ghost. A month document that does not exist yet is
   * `{ month, entries: [] }`; plan entries of other months are skipped.
   */
  applyPlan(
    month: Pick<CapacityMonthEntity, 'month' | 'entries'>,
    plan: CapacityPlan,
  ): readonly CapacityEntry[] {
    const existing = month.entries;
    const scope = new Set<string>(plan.dayKeys);
    const out: CapacityEntry[] = [];
    let i = 0;
    let j = 0;
    while (i < existing.length || j < plan.entries.length) {
      const old = existing[i];
      if (
        old !== undefined &&
        old.barberId === plan.barberId &&
        scope.has(old.dayKey)
      ) {
        i++;
        continue;
      }
      const next = plan.entries[j];
      if (
        next !== undefined &&
        CapacityEntry.monthOf(next.dayKey) !== month.month
      ) {
        j++;
        continue;
      }
      if (old === undefined) {
        out.push(next as CapacityEntry);
        j++;
      } else if (next === undefined || CapacityEntry.compare(old, next) <= 0) {
        out.push(old);
        i++;
      } else {
        out.push(next);
        j++;
      }
    }
    return out;
  },

  /**
   * Every day `fromKey … toKey` inclusive, civil arithmetic — `truncated`
   * when the walk stopped at {@link MAX_SPAN_DAYS} (the shell owns the
   * warning). Empty when inverted.
   */
  dayKeysBetween(fromKey: DayKey, toKey: DayKey): DayKeySpan {
    const span = ZonedTimeSystem.daysBetween(fromKey, toKey) + 1;
    if (span <= 0) return { keys: [], truncated: false };
    const count = span > MAX_SPAN_DAYS ? MAX_SPAN_DAYS : span;
    const keys: DayKey[] = [];
    const first = DayKey.toEpochDay(fromKey);
    for (let i = 0; i < count; i++) keys.push(DayKey.fromEpochDay(first + i));
    return { keys, truncated: span > MAX_SPAN_DAYS };
  },

  /**
   * The LAST day of the month after `horizonEndKey`'s — the month the
   * horizon is about to slide into must already exist when it arrives
   * (`2026-01-31` → `2026-02-28`, never rolling through a short month).
   */
  horizonSpanEndKey(horizonEndKey: DayKey): DayKey {
    return ZonedTimeSystem.addDays(
      ZonedTimeSystem.addMonths(ZonedTimeSystem.startOfMonth(horizonEndKey), 2),
      -1,
    );
  },
} as const;
