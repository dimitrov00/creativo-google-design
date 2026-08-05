import { Result, fail, ok } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import {
  DayWindows,
  type DayWindowsError,
  type DayWindowsProps,
} from './day-windows';
import {
  FlexibleWhenFullError,
  type FlexibleWhenError,
} from './flexible-when.errors';

export interface FlexibleWhenProps {
  readonly days: readonly DayWindowsProps[];
}

/**
 * WHEN a client can come, said flexibly: a set of days, each optionally
 * narrowed to spans within it.
 *
 * "I'm free on the 25th and the 26th, but on the 26th only 08:00–12:00 and
 * 15:00–16:30" is one of these. It is the input to two different questions
 * that must never disagree: *is there something right now?* (the flexible
 * search, which turns it into an engine mask) and *tell me if something opens
 * up* (the waitlist request, which persists it verbatim).
 *
 * ### Days are keyed by their own date, deliberately
 * `BookingParty` needs a monotonic counter because two guests can be
 * indistinguishable — "Guest 2" removed and "Guest 2" re-added are different
 * people, and v2's bug 7.7 was minting the same id for both. A DAY has no
 * such problem: the 26th removed and the 26th re-added IS the same day, and
 * anything keyed to it (its windows) SHOULD be replaced rather than
 * resurrected. So this holds a `Map` keyed by `dayKey` and the §7.7 hazard
 * cannot arise here — worth stating, because the phase plan inherited
 * "monotonic ids" from a file where it was load-bearing and here it would be
 * ceremony that makes re-selecting a day mean something subtly different.
 *
 * Insertion order is NOT the iteration order: {@link days} sorts
 * chronologically, because a summary list of dates that runs 26th, 24th, 25th
 * because that is the order they were tapped is a list nobody can scan.
 */
export class FlexibleWhen {
  private constructor(
    private readonly byDayKey: ReadonlyMap<string, DayWindows>,
  ) {}

  static empty(): FlexibleWhen {
    return new FlexibleWhen(new Map());
  }

  static of(days: readonly DayWindows[]): FlexibleWhen {
    return new FlexibleWhen(new Map(days.map((day) => [day.dayKey, day])));
  }

  static create(
    props: FlexibleWhenProps,
    zone: string,
  ): Result<FlexibleWhen, DayWindowsError> {
    const days: DayWindows[] = [];
    for (const raw of props.days) {
      const day = DayWindows.create(raw, zone);
      if (day.isFailure()) return fail(day.error);
      days.push(day.value);
    }
    return ok(FlexibleWhen.of(days));
  }

  /** Chronological, always — never tap order. */
  get days(): readonly DayWindows[] {
    return [...this.byDayKey.values()].sort((a, b) =>
      a.dayKey.localeCompare(b.dayKey),
    );
  }

  get dayCount(): number {
    return this.byDayKey.size;
  }

  isEmpty(): boolean {
    return this.byDayKey.size === 0;
  }

  has(day: CalendarDay): boolean {
    return this.byDayKey.has(day.key());
  }

  for(day: CalendarDay): DayWindows | null {
    return this.byDayKey.get(day.key()) ?? null;
  }

  /**
   * Select a day, as "any time" — narrowing is a second, deliberate act.
   *
   * Re-selecting a day already held is a no-op rather than a reset: the
   * calendar's tap target toggles, so the only way to reach this twice for one
   * day is a double-fire, and silently discarding the windows someone just
   * authored would be the worst possible reading of it.
   */
  withDay(
    day: CalendarDay,
    maxDays: number,
  ): Result<FlexibleWhen, FlexibleWhenError> {
    if (this.byDayKey.has(day.key())) return ok(this);
    if (this.byDayKey.size >= maxDays) {
      return fail(new FlexibleWhenFullError(maxDays));
    }
    const next = new Map(this.byDayKey);
    next.set(day.key(), DayWindows.of(day));
    return ok(new FlexibleWhen(next));
  }

  /** Deselect a day — its windows leave with it, which is the point. */
  withoutDay(day: CalendarDay): FlexibleWhen {
    if (!this.byDayKey.has(day.key())) return this;
    const next = new Map(this.byDayKey);
    next.delete(day.key());
    return new FlexibleWhen(next);
  }

  /** Replace one day's windows — what the per-day window sheet commits. */
  withWindows(dayWindows: DayWindows): FlexibleWhen {
    if (!this.byDayKey.has(dayWindows.dayKey)) return this;
    const next = new Map(this.byDayKey);
    next.set(dayWindows.dayKey, dayWindows);
    return new FlexibleWhen(next);
  }

  toProps(): FlexibleWhenProps {
    return { days: this.days.map((day) => day.toProps()) };
  }
}
