import { LocalDate } from '@core/primitives';
import { MinuteRange } from './minute-range.data';

/**
 * One day a client says they are free, and WHEN within it
 * (`day-windows.ts:41`) — persisted verbatim on the waitlist request
 * (an element of its `flexibleDays`).
 *
 * EMPTY `windows` is "any time that day", never "no time": the common answer
 * is "the 26th works" with nothing further, and the simple case must not pay
 * for the flexible one. "No time on this day" is expressed by not selecting
 * the day at all.
 *
 * Windows are wall-clock minutes of the shop day `localDate` (a claim about
 * clock faces that survives a DST change — Law 7.3: placement math is
 * local) and always NORMALIZED — sorted, overlapping and abutting spans
 * merged, empties dropped — so a summary can never show two spans that are
 * really one.
 */
export type DayWindows = {
  readonly localDate: LocalDate;
  readonly windows: readonly MinuteRange[];
};

export const DayWindows = {
  /** A day with its windows, normalized. No windows ⇒ the whole day. */
  of(localDate: LocalDate, windows: readonly MinuteRange[]): DayWindows {
    return { localDate, windows: MinuteRange.normalize(windows) };
  },

  /** A day offered whole — what selecting a day means before any narrowing. */
  wholeDay(localDate: LocalDate): DayWindows {
    return { localDate, windows: [] };
  },

  /** No windows ⇒ the person is offering the entire day. */
  isWholeDay(day: DayWindows): boolean {
    return day.windows.length === 0;
  },

  /**
   * The edge guard for a stored or persisted value: a real shop day and an
   * array of integer spans inside the day with `start < end`. Normalization
   * is checked by {@link of}, not here — a guard only says "this is the
   * shape", and a caller rebuilding a value runs it through {@link of}.
   */
  is(raw: unknown): raw is DayWindows {
    if (raw === null || typeof raw !== 'object') return false;
    const day = raw as Readonly<Record<string, unknown>>;
    const localDate = day['localDate'];
    if (typeof localDate !== 'string' || !LocalDate.parse(localDate).ok) {
      return false;
    }
    const windows = day['windows'];
    if (!Array.isArray(windows)) return false;
    for (let i = 0; i < windows.length; i++) {
      const range: unknown = windows[i];
      if (range === null || typeof range !== 'object') return false;
      const span = range as Readonly<Record<string, unknown>>;
      const start = span['startMinutes'];
      const end = span['endMinutes'];
      if (
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        start >= end ||
        end > 1440
      ) {
        return false;
      }
    }
    return true;
  },
} as const;
