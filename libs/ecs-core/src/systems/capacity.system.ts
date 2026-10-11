import { CapacityEntry } from '../components/capacity-entry.data';
import type { MinuteRange } from '../components/minute-range.data';
import type { DayHours } from '../components/opening-hours.data';
import type { RosterWindow } from '../components/roster-window.data';
import type { ScheduleVersion } from '../components/schedule-version.data';
import type { CapacityMonth } from '../entities/capacity-month.entity';
import type { MinuteCount } from '../primitives/duration-minutes.primitive';
import type {
  BarberId,
  CapacityMonthId,
  LocationId,
} from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';
import { AvailabilitySystem } from './availability.system';
import { IntervalSetSystem } from './interval-set.system';
import {
  type DayException,
  RosterSystem,
  type ShopHours,
} from './roster.system';

/** The legacy walk's ceiling (`capacity-plan.ts:146`): a longer span is an authoring error. */
const MAX_SPAN_DAYS = 500;

/** One ACTIVE shop's published week (`ShopLocation.openingHours`, Mon-first). */
export type CapacityShopWeek = {
  readonly locationId: LocationId;
  readonly week: readonly DayHours[];
};

/** One shop day of the barber's busy projection, as the UNPADDED minute ranges it stores. */
export type CapacityBusyDay = {
  readonly localDate: LocalDate;
  readonly spans: readonly MinuteRange[];
};

/** The barber's roster, or `null` when they have none — every day then empties. */
export type CapacitySchedule = {
  readonly versions: readonly ScheduleVersion[];
  readonly turnaroundMinutes: MinuteCount;
};

/**
 * Everything one barber's capacity rebuild reads (`capacity-plan.ts:32-44`),
 * every field present: the scope (`barberId` × `localDates`), the roster, the
 * ACTIVE shops only (an archived shop must not sell hours), the busy days
 * and the published exceptions.
 */
export type CapacityPlanInput = {
  readonly barberId: BarberId;
  readonly localDates: readonly LocalDate[];
  readonly schedule: CapacitySchedule | null;
  readonly shops: readonly CapacityShopWeek[];
  readonly busy: readonly CapacityBusyDay[];
  readonly exceptions: readonly DayException[];
};

/**
 * One barber's recomputed capacity: the SCOPE it replaces (`barberId` ×
 * `localDates`, sorted, distinct) and the entries that replace it, sorted by
 * `CapacityEntry.compare`. A day in scope with no entry is a day whose
 * entries are REMOVED — never left as a ghost.
 */
export type CapacityPlan = {
  readonly barberId: BarberId;
  readonly localDates: readonly LocalDate[];
  readonly entries: readonly CapacityEntry[];
};

/** The part of a plan one month document takes. */
export type CapacityMonthPlan = CapacityPlan & {
  readonly month: CapacityMonthId;
};

/** What {@link CapacitySystem.localDatesBetween} walked, and whether it stopped at the cap. */
export type LocalDateSpan = {
  readonly keys: readonly LocalDate[];
  readonly truncated: boolean;
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day order for anything on a shop day (string order is day order). */
function byLocalDate(
  a: { readonly localDate: LocalDate },
  b: { readonly localDate: LocalDate },
): number {
  return compareStrings(a.localDate, b.localDate);
}

const NO_SPANS: readonly MinuteRange[] = [];
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
  localDate: LocalDate,
  busy: readonly MinuteRange[],
  exceptions: readonly DayException[],
): readonly CapacityEntry[] {
  const shopHours: ShopHours[] = [];
  for (let i = 0; i < input.shops.length; i++) {
    const shop = input.shops[i] as CapacityShopWeek;
    shopHours.push({
      locationId: shop.locationId,
      hours: RosterSystem.shopDayHours(shop.week, localDate),
    });
  }
  const windows = RosterSystem.buildDayWindows({
    barberId: input.barberId,
    localDate,
    versions: schedule.versions,
    exceptions,
    shopHours,
  });
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
  const windowsByShop: RosterWindow[][] = [];
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i] as RosterWindow;
    if (!isActiveShop(input.shops, window.locationId)) continue;
    let at = shops.indexOf(window.locationId);
    if (at < 0) {
      at = shops.length;
      shops.push(window.locationId);
      windowsByShop.push([]);
    }
    // A roster window IS a minute range of the day (structurally).
    (windowsByShop[at] as RosterWindow[]).push(window);
  }

  const entries: CapacityEntry[] = [];
  for (let i = 0; i < shops.length; i++) {
    const free = IntervalSetSystem.totalMinutes(
      IntervalSetSystem.subtract(windowsByShop[i] as RosterWindow[], padded),
    );
    if (free > 0) {
      entries.push(
        CapacityEntry.of(
          localDate,
          input.barberId,
          shops[i] as LocationId,
          free,
        ),
      );
    }
  }
  return entries.sort(CapacityEntry.compare);
}

/** `localDates` distinct and sorted (string order is day order): one sort, then adjacent duplicates dropped. */
function scopeOf(localDates: readonly LocalDate[]): readonly LocalDate[] {
  const sorted = [...localDates].sort(compareStrings);
  const out: LocalDate[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const day = sorted[i] as LocalDate;
    if (out.length === 0 || out[out.length - 1] !== day) out.push(day);
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
 * Day arithmetic is `LocalDate` arithmetic (flatten-spec T8) and the window
 * math runs on each shop day's wall clock (T1): no zone, no `Intl`, no
 * `Date`.
 */
export const CapacitySystem = {
  /**
   * One barber's entries for every day of `input.localDates`. A barber with
   * no roster, a whole-day absence, a fully booked day and a shop's rest day
   * all yield NO entry — absent and zero render the same, and an emptied day
   * must not survive as a zero.
   */
  planBarberCapacity(input: CapacityPlanInput): CapacityPlan {
    const localDates = scopeOf(input.localDates);
    const entries: CapacityEntry[] = [];
    if (input.schedule !== null) {
      // Busy days and exceptions sorted once (copies — stable, so a day's
      // own keep their input order), then walked by two cursors beside the
      // sorted scope: each day reads its own, never the whole list.
      const busy = [...input.busy].sort(byLocalDate);
      const exceptions = [...input.exceptions].sort(byLocalDate);
      let b = 0;
      let x = 0;
      for (let i = 0; i < localDates.length; i++) {
        const localDate = localDates[i] as LocalDate;
        while (
          b < busy.length &&
          (busy[b] as CapacityBusyDay).localDate < localDate
        ) {
          b++;
        }
        // The FIRST entry for the day, as the scan it replaces read it.
        const spans =
          b < busy.length &&
          (busy[b] as CapacityBusyDay).localDate === localDate
            ? (busy[b] as CapacityBusyDay).spans
            : NO_SPANS;
        while (
          x < exceptions.length &&
          (exceptions[x] as DayException).localDate < localDate
        ) {
          x++;
        }
        let end = x;
        while (
          end < exceptions.length &&
          (exceptions[end] as DayException).localDate === localDate
        ) {
          end++;
        }
        const own = end === x ? NO_EXCEPTIONS : exceptions.slice(x, end);
        const dayEntries = entriesFor(
          input,
          input.schedule,
          localDate,
          spans,
          own,
        );
        for (let k = 0; k < dayEntries.length; k++) {
          entries.push(dayEntries[k] as CapacityEntry);
        }
      }
    }
    return { barberId: input.barberId, localDates, entries };
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
    while (d < plan.localDates.length) {
      const month = LocalDate.monthKey(plan.localDates[d] as LocalDate);
      const localDates: LocalDate[] = [];
      while (
        d < plan.localDates.length &&
        LocalDate.monthKey(plan.localDates[d] as LocalDate) === month
      ) {
        localDates.push(plan.localDates[d++] as LocalDate);
      }
      // Entries are sorted by day, so this month's are one contiguous run.
      while (
        e < plan.entries.length &&
        LocalDate.monthKey((plan.entries[e] as CapacityEntry).localDate) < month
      ) {
        e++;
      }
      const entries: CapacityEntry[] = [];
      while (
        e < plan.entries.length &&
        LocalDate.monthKey((plan.entries[e] as CapacityEntry).localDate) ===
          month
      ) {
        entries.push(plan.entries[e++] as CapacityEntry);
      }
      months.push({ barberId: plan.barberId, month, localDates, entries });
    }
    return months;
  },

  /**
   * THE REPLACE-NOT-MERGE FOLD (§3.6): a month document's sorted `entries[]`
   * with every entry in the plan's `(barberId, localDate)` scope dropped and the
   * plan's own entries for this month merged in at their key position. A
   * two-pointer merge — one pass over both sorted arrays, O(n + m), no sort,
   * no allocation beyond the result and one scope set. Other barbers' entries
   * are untouched; a scoped day with no new contribution disappears, never
   * left as a ghost. A month document that does not exist yet is
   * `{ month, entries: [] }`; plan entries of other months are skipped.
   */
  applyPlan(
    month: Pick<CapacityMonth, 'month' | 'entries'>,
    plan: CapacityPlan,
  ): readonly CapacityEntry[] {
    const existing = month.entries;
    const scope = new Set<string>(plan.localDates);
    const out: CapacityEntry[] = [];
    let i = 0;
    let j = 0;
    while (i < existing.length || j < plan.entries.length) {
      const old = existing[i];
      if (
        old !== undefined &&
        old.barberId === plan.barberId &&
        scope.has(old.localDate)
      ) {
        i++;
        continue;
      }
      const next = plan.entries[j];
      if (
        next !== undefined &&
        LocalDate.monthKey(next.localDate) !== month.month
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
   * Every day `from … to` inclusive, civil arithmetic — `truncated` when the
   * walk stopped at {@link MAX_SPAN_DAYS} (the shell owns the warning).
   * Empty when inverted.
   */
  localDatesBetween(from: LocalDate, to: LocalDate): LocalDateSpan {
    const span = LocalDate.daysBetween(from, to) + 1;
    if (span <= 0) return { keys: [], truncated: false };
    const count = span > MAX_SPAN_DAYS ? MAX_SPAN_DAYS : span;
    const keys: LocalDate[] = [];
    const first = LocalDate.toEpochDay(from);
    for (let i = 0; i < count; i++)
      keys.push(LocalDate.fromEpochDay(first + i));
    return { keys, truncated: span > MAX_SPAN_DAYS };
  },

  /**
   * The LAST day of the month after `horizonEnd`'s — the month the horizon
   * is about to slide into must already exist when it arrives
   * (`2026-01-31` → `2026-02-28`, never rolling through a short month).
   */
  horizonSpanEnd(horizonEnd: LocalDate): LocalDate {
    return LocalDate.addDays(
      LocalDate.addMonths(LocalDate.startOfMonth(horizonEnd), 2),
      -1,
    );
  },
} as const;
