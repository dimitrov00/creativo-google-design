import type { DayKey } from './day-key.data';
import { DayWindows } from './day-windows.data';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';

function byDayKey(a: DayWindows, b: DayWindows): number {
  return a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0;
}

/** Index of `dayKey` in a day-sorted list (binary search), or `-1`. */
function indexOfDay(days: readonly DayWindows[], dayKey: DayKey): number {
  let lo = 0;
  let hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const key = (days[mid] as DayWindows).dayKey;
    if (key === dayKey) return mid;
    if (key < dayKey) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * WHEN a client can come, said flexibly: a set of days, each optionally
 * narrowed to spans within it (`flexible-when.ts:42`). The input to two
 * questions that must never disagree — *is there something now?* (the
 * flexible search) and *tell me when something opens* (the waitlist request,
 * which persists it verbatim).
 *
 * Days are keyed by their own date — the 26th removed and re-added IS the
 * same day, and its old windows must not come back with it. `days` is always
 * chronological (never tap order) and holds each day once.
 */
export type FlexibleWhen = {
  readonly days: readonly DayWindows[];
};

const EMPTY: FlexibleWhen = { days: [] };

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
        if ((unique[k] as DayWindows).dayKey === day.dayKey) {
          unique[k] = day;
          replaced = true;
          break;
        }
      }
      if (!replaced) unique.push(day);
    }
    unique.sort(byDayKey);
    return { days: unique };
  },

  isEmpty(when: FlexibleWhen): boolean {
    return when.days.length === 0;
  },

  has(when: FlexibleWhen, dayKey: DayKey): boolean {
    return indexOfDay(when.days, dayKey) !== -1;
  },

  /** The day's declaration, or `null` when the day is not selected. */
  windowsFor(when: FlexibleWhen, dayKey: DayKey): DayWindows | null {
    const at = indexOfDay(when.days, dayKey);
    return at === -1 ? null : (when.days[at] as DayWindows);
  },

  /**
   * Select a day, as "any time" — narrowing is a second, deliberate act.
   * Re-selecting a held day is a no-op, never a reset (a double-fire must not
   * discard windows somebody just authored). Refused past `maxDays`
   * (`scheduling.flexible_when.full`): each day is its own search.
   */
  withDay(
    when: FlexibleWhen,
    dayKey: DayKey,
    maxDays: number,
  ): Result<FlexibleWhen, SchedulingError> {
    if (FlexibleWhen.has(when, dayKey)) return Result.ok(when);
    if (when.days.length >= maxDays) {
      return Result.err(SchedulingError.flexibleWhenFull(maxDays));
    }
    const days = [...when.days, DayWindows.wholeDay(dayKey)];
    days.sort(byDayKey);
    return Result.ok({ days });
  },

  /** Deselect a day — its windows leave with it, which is the point. */
  withoutDay(when: FlexibleWhen, dayKey: DayKey): FlexibleWhen {
    const at = indexOfDay(when.days, dayKey);
    if (at === -1) return when;
    const days: DayWindows[] = [];
    for (let i = 0; i < when.days.length; i++) {
      if (i !== at) days.push(when.days[i] as DayWindows);
    }
    return { days };
  },

  /** Replace one SELECTED day's windows; windows for an unselected day are ignored. */
  withWindows(when: FlexibleWhen, dayWindows: DayWindows): FlexibleWhen {
    const at = indexOfDay(when.days, dayWindows.dayKey);
    if (at === -1) return when;
    const days = [...when.days];
    days[at] = dayWindows;
    return { days };
  },

  /** The selected day keys, chronological — the waitlist request's `dayKeys` query mirror. */
  dayKeys(when: FlexibleWhen): readonly DayKey[] {
    const keys: DayKey[] = [];
    for (let i = 0; i < when.days.length; i++) {
      keys.push((when.days[i] as DayWindows).dayKey);
    }
    return keys;
  },

  /** The last day named — what a request is waiting for — or `null`. */
  lastDayKey(when: FlexibleWhen): DayKey | null {
    const last = when.days[when.days.length - 1];
    return last === undefined ? null : last.dayKey;
  },

  /**
   * The edge guard for a stored or persisted declaration: every day a
   * {@link DayWindows}, strictly chronological (sorted and unique).
   */
  is(raw: unknown): raw is FlexibleWhen {
    if (raw === null || typeof raw !== 'object') return false;
    const days = (raw as Readonly<Record<string, unknown>>)['days'];
    if (!Array.isArray(days)) return false;
    for (let i = 0; i < days.length; i++) {
      const day: unknown = days[i];
      if (!DayWindows.is(day)) return false;
      if (i > 0 && (days[i - 1] as DayWindows).dayKey >= day.dayKey) {
        return false;
      }
    }
    return true;
  },
} as const;
