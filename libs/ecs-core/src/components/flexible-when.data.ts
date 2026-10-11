import { type LocalDate, Result, SchedulingError } from '@core/primitives';
import { DayWindows } from './day-windows.data';

function byLocalDate(a: DayWindows, b: DayWindows): number {
  return a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0;
}

/** Index of `localDate` in a day-sorted list (binary search), or `-1`. */
function indexOfDay(days: readonly DayWindows[], localDate: LocalDate): number {
  let lo = 0;
  let hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const day = (days[mid] as DayWindows).localDate;
    if (day === localDate) return mid;
    if (day < localDate) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * WHEN a client can come, said flexibly: a set of shop days, each optionally
 * narrowed to spans within it (`flexible-when.ts:42`). The input to two
 * questions that must never disagree — *is there something now?* (the
 * flexible search) and *tell me when something opens* (the waitlist request,
 * which persists it verbatim).
 *
 * A flat slice (Law 6) — `WaitlistRequest` intersects it, so its one field
 * is named for its domain (`flexibleDays`, was `days` under `when`). Days
 * are keyed by their own date — the 26th removed and re-added IS the same
 * day, and its old windows must not come back with it. `flexibleDays` is
 * always chronological (never tap order) and holds each day once.
 */
export type FlexibleWhen = {
  readonly flexibleDays: readonly DayWindows[];
};

const EMPTY: FlexibleWhen = { flexibleDays: [] };

export const FlexibleWhen = {
  empty(): FlexibleWhen {
    return EMPTY;
  },

  /** From any list of days: one entry per day (a later one replaces an earlier), chronological. */
  of(days: readonly DayWindows[]): FlexibleWhen {
    const unique: DayWindows[] = [];
    for (let i = 0; i < days.length; i++) {
      const day = days[i] as DayWindows;
      let replaced = false;
      for (let k = 0; k < unique.length; k++) {
        if ((unique[k] as DayWindows).localDate === day.localDate) {
          unique[k] = day;
          replaced = true;
          break;
        }
      }
      if (!replaced) unique.push(day);
    }
    unique.sort(byLocalDate);
    return { flexibleDays: unique };
  },

  isEmpty(when: FlexibleWhen): boolean {
    return when.flexibleDays.length === 0;
  },

  has(when: FlexibleWhen, localDate: LocalDate): boolean {
    return indexOfDay(when.flexibleDays, localDate) !== -1;
  },

  /** The day's declaration, or `null` when the day is not selected. */
  windowsFor(when: FlexibleWhen, localDate: LocalDate): DayWindows | null {
    const at = indexOfDay(when.flexibleDays, localDate);
    return at === -1 ? null : (when.flexibleDays[at] as DayWindows);
  },

  /**
   * Select a day, as "any time" — narrowing is a second, deliberate act.
   * Re-selecting a held day is a no-op, never a reset (a double-fire must not
   * discard windows somebody just authored). Refused past `maxDays`
   * (`SCHEDULING_FLEXIBLE_WHEN_FULL`): each day is its own search.
   */
  withDay(
    when: FlexibleWhen,
    localDate: LocalDate,
    maxDays: number,
  ): Result<FlexibleWhen, SchedulingError> {
    if (FlexibleWhen.has(when, localDate)) return Result.ok(when);
    if (when.flexibleDays.length >= maxDays) {
      return Result.err(SchedulingError.flexibleWhenFull(maxDays));
    }
    const days = [...when.flexibleDays, DayWindows.wholeDay(localDate)];
    days.sort(byLocalDate);
    return Result.ok({ flexibleDays: days });
  },

  /** Deselect a day — its windows leave with it, which is the point. */
  withoutDay(when: FlexibleWhen, localDate: LocalDate): FlexibleWhen {
    const at = indexOfDay(when.flexibleDays, localDate);
    if (at === -1) return when;
    const days: DayWindows[] = [];
    for (let i = 0; i < when.flexibleDays.length; i++) {
      if (i !== at) days.push(when.flexibleDays[i] as DayWindows);
    }
    return { flexibleDays: days };
  },

  /** Replace one SELECTED day's windows; windows for an unselected day are ignored. */
  withWindows(when: FlexibleWhen, dayWindows: DayWindows): FlexibleWhen {
    const at = indexOfDay(when.flexibleDays, dayWindows.localDate);
    if (at === -1) return when;
    const days = [...when.flexibleDays];
    days[at] = dayWindows;
    return { flexibleDays: days };
  },

  /** The selected shop days, chronological — the waitlist request's `localDates` query mirror. */
  localDates(when: FlexibleWhen): readonly LocalDate[] {
    const days: LocalDate[] = [];
    for (let i = 0; i < when.flexibleDays.length; i++) {
      days.push((when.flexibleDays[i] as DayWindows).localDate);
    }
    return days;
  },

  /** The last day named — what a request is waiting for — or `null`. */
  lastLocalDate(when: FlexibleWhen): LocalDate | null {
    const last = when.flexibleDays[when.flexibleDays.length - 1];
    return last === undefined ? null : last.localDate;
  },

  /**
   * The edge guard for a stored or persisted declaration: every day a
   * {@link DayWindows}, strictly chronological (sorted and unique).
   */
  is(raw: unknown): raw is FlexibleWhen {
    if (raw === null || typeof raw !== 'object') return false;
    const days = (raw as Readonly<Record<string, unknown>>)['flexibleDays'];
    if (!Array.isArray(days)) return false;
    for (let i = 0; i < days.length; i++) {
      const day: unknown = days[i];
      if (!DayWindows.is(day)) return false;
      if (i > 0 && (days[i - 1] as DayWindows).localDate >= day.localDate) {
        return false;
      }
    }
    return true;
  },
} as const;
