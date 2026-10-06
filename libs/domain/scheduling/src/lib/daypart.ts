import type { LocalTimeOfDay, LocalTimeRange } from './local-time-of-day';

/**
 * A part of the day, the way people say it: «сутрин», «следобед», «вечер».
 *
 * ONE rule for the whole product (lead ruling LR5, 2026-09-28): the booking
 * time sheet heads the starts it offers with these parts, and a waiting
 * request's row names the parts its windows ask for. A client who picked a
 * time under «следобед» must read «следобед» back on the barber's card, so
 * both read the boundaries from here and no copy can drift.
 */
export type Daypart = 'morning' | 'afternoon' | 'evening';

/** In the day's order — the order the time sheet heads its runs in. */
export const DAYPARTS: readonly Daypart[] = [
  'morning',
  'afternoon',
  'evening',
] as const;

/**
 * The boundaries, in minutes from midnight: before 12:00 is the morning,
 * before 17:00 the afternoon, the rest the evening — so 12:00 sharp is
 * already the afternoon, and 17:00 sharp the evening.
 */
const AFTERNOON_STARTS = 12 * 60;
const EVENING_STARTS = 17 * 60;
const MIDNIGHT = 24 * 60;

/**
 * The part of the day a wall-clock reading falls in. Takes anything that
 * reads a clock face — a `LocalTimeOfDay`, or a `ZonedDateTime` already on
 * the shop's calendar — never an instant, because «сутрин» is a claim about
 * the clock in the shop, not about UTC.
 */
export function daypartOf(
  time: Pick<LocalTimeOfDay, 'hour' | 'minute'>,
): Daypart {
  const minutes = time.hour * 60 + time.minute;
  if (minutes < AFTERNOON_STARTS) return 'morning';
  if (minutes < EVENING_STARTS) return 'afternoon';
  return 'evening';
}

/**
 * The parts of the day the spans touch, in the day's order. Half-open like
 * the spans themselves: `09:00–12:00` is the morning alone, `11:30–12:30`
 * touches the morning and the afternoon. No spans, no parts — a caller whose
 * empty list means "any time that day" says so itself (`DayWindows.isWholeDay`).
 */
export function daypartsTouchedBy(
  ranges: readonly LocalTimeRange[],
): readonly Daypart[] {
  return DAYPARTS.filter((part) => {
    const { from, to } = spanOf(part);
    return ranges.some(
      (range) =>
        range.start.minutesFromMidnight() < to &&
        range.end.minutesFromMidnight() > from,
    );
  });
}

/** A part as the half-open span `[from, to)` of minutes from midnight. */
function spanOf(part: Daypart): { readonly from: number; readonly to: number } {
  switch (part) {
    case 'morning':
      return { from: 0, to: AFTERNOON_STARTS };
    case 'afternoon':
      return { from: AFTERNOON_STARTS, to: EVENING_STARTS };
    case 'evening':
      return { from: EVENING_STARTS, to: MIDNIGHT };
  }
}
