import { Result, fail, ok } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import type { InvalidCalendarDayError } from './calendar-day.errors';
import { Interval } from './interval';
import { LocalTimeRange } from './local-time-of-day';
import type { LocalTimeError } from './local-time-of-day.errors';

/** Everything `DayWindows.create` can refuse: a bad date, or a bad span. */
export type DayWindowsError = InvalidCalendarDayError | LocalTimeError;

export interface DayWindowsProps {
  /** `YYYY-MM-DD`. */
  readonly dayKey: string;
  /** `[{from:'08:00', to:'12:00'}]`. Empty ⇒ any time that day. */
  readonly windows: readonly { readonly from: string; readonly to: string }[];
}

/**
 * One day a client says they are free, and WHEN within it.
 *
 * ### Empty is "any time", not "no time"
 * The overwhelmingly common answer is "the 26th works" with no further
 * qualification, and forcing a window on that person would make the simple
 * case pay for the flexible one. So an empty window list means the whole day
 * is offered — {@link toIntervals} returns the day itself, and every consumer
 * gets one rule instead of a null check. "No time on this day" is expressed
 * by not selecting the day at all, which is the same gesture that created it.
 *
 * ### Windows are wall-clock, the mask is instants
 * The person means "eight in the morning", not an epoch offset — so the
 * declaration is stored as {@link LocalTimeRange} and only becomes an
 * `Interval` against a specific day, where DST is resolved once. Storing
 * instants instead would silently shift a saved request by an hour when the
 * clocks change between declaring and matching.
 *
 * Windows are normalized on construction: overlapping and abutting spans
 * merge, so "08:00–12:00, 11:00–13:00" is held as the single 08:00–13:00 the
 * person actually described, and a summary row can never show two spans that
 * are really one.
 */
export class DayWindows {
  private constructor(
    readonly day: CalendarDay,
    /** Normalized, sorted, non-overlapping. Empty ⇒ the whole day. */
    readonly windows: readonly LocalTimeRange[],
  ) {}

  static of(
    day: CalendarDay,
    windows: readonly LocalTimeRange[] = [],
  ): DayWindows {
    return new DayWindows(day, LocalTimeRange.normalize(windows));
  }

  static create(
    props: DayWindowsProps,
    zone: string,
  ): Result<DayWindows, DayWindowsError> {
    const day = CalendarDay.create(props.dayKey, zone);
    if (day.isFailure()) return fail(day.error);

    const windows: LocalTimeRange[] = [];
    for (const raw of props.windows) {
      const range = LocalTimeRange.create(raw.from, raw.to);
      if (range.isFailure()) return fail(range.error);
      windows.push(range.value);
    }
    return ok(DayWindows.of(day.value, windows));
  }

  get dayKey(): string {
    return this.day.key();
  }

  /** No windows ⇒ the person is offering the entire day. */
  isWholeDay(): boolean {
    return this.windows.length === 0;
  }

  /**
   * The mask to hand the availability engine for this day.
   *
   * A whole-day declaration returns the day's own bounds rather than an empty
   * list, because an empty mask would read as "nothing is allowed" to
   * `Interval.intersect` — the exact inversion of what the person said.
   *
   * A window the day's DST transition erased is DROPPED rather than failing
   * the whole request: losing one span beats refusing a search over four other
   * days that are perfectly fine, and the engine can only ever offer real
   * instants anyway.
   */
  toIntervals(): readonly Interval[] {
    // `bounds()` rather than midnight-to-midnight arithmetic: a transition day
    // is 23 or 25 hours, and the whole-day mask has to be the whole day.
    if (this.isWholeDay()) return [this.day.bounds()];
    return this.windows.flatMap((window) => {
      const interval = window.onDay(this.day);
      return interval.isSuccess() ? [interval.value] : [];
    });
  }

  /** Add a span, re-normalizing — the window sheet's only write. */
  withWindow(range: LocalTimeRange): DayWindows {
    return DayWindows.of(this.day, [...this.windows, range]);
  }

  /** Drop the span at `index`; out of range is a no-op, not a throw. */
  withoutWindow(index: number): DayWindows {
    if (index < 0 || index >= this.windows.length) return this;
    return DayWindows.of(
      this.day,
      this.windows.filter((_, at) => at !== index),
    );
  }

  /** Back to "any time" — the way out of over-specifying. */
  clearWindows(): DayWindows {
    return DayWindows.of(this.day, []);
  }

  toProps(): DayWindowsProps {
    return {
      dayKey: this.dayKey,
      windows: this.windows.map((window) => ({
        from: window.start.toString(),
        to: window.end.toString(),
      })),
    };
  }
}
