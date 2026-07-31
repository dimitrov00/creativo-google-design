import { CalendarDay, DateRange } from '@creativo/application/booking';

export interface AvailabilityDayCell {
  readonly day: CalendarDay;
  readonly dayKey: string;
  /** The number to render. */
  readonly dayOfMonth: number;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
  /** Outside the bookable horizon, or before today — never tappable. */
  readonly outOfRange: boolean;
  /** Free minutes across every eligible barber. 0 ⇒ nothing to offer. */
  readonly freeMinutes: number;
}

export interface AvailabilityMonth {
  readonly anchor: CalendarDay;
  readonly weeks: readonly (readonly AvailabilityDayCell[])[];
}

/** First of the month `day` falls in, same zone. */
function startOfMonth(day: CalendarDay): CalendarDay {
  const first = CalendarDay.create(`${day.key().slice(0, 8)}01`, day.zone);
  if (first.isFailure()) throw new Error('unreachable: validated day');
  return first.value;
}

function addDays(day: CalendarDay, count: number): CalendarDay {
  let cursor = day;
  for (let i = 0; i < Math.abs(count); i++) {
    cursor = count > 0 ? cursor.next() : cursor.previous();
  }
  return cursor;
}

/**
 * A Monday-first month grid padded to whole weeks, each cell carrying the
 * free minutes the capacity projection reported for that day.
 *
 * Separate from `client/appointments`' `buildCalendarMonth` on purpose: that
 * one counts the viewer's OWN appointments, this one measures a shop's spare
 * capacity. Same shape, opposite meaning — merging them would produce a cell
 * type where half the fields are always wrong.
 *
 * Everything walks `CalendarDay.next()`/`.previous()`, never `+24h`: on a DST
 * transition a day is 23 or 25 hours, and a grid built on millisecond
 * arithmetic silently repeats or skips a date twice a year.
 */
export function buildAvailabilityMonth(input: {
  readonly anchor: CalendarDay;
  readonly today: CalendarDay;
  readonly horizonEnd: CalendarDay;
  readonly capacityByDay: ReadonlyMap<string, number>;
}): AvailabilityMonth {
  const { anchor, today, horizonEnd, capacityByDay } = input;
  const monthStart = startOfMonth(anchor);

  // ISO weekday is 1..7 Monday-first, so the lead-in is simply weekday − 1.
  const gridStart = addDays(monthStart, -(monthStart.weekday() - 1));

  const cells: AvailabilityDayCell[] = [];
  let cursor = gridStart;
  // Six rows always: a month grid that changes height between months makes
  // the content below it jump, which is worse than one blank trailing row.
  for (let index = 0; index < 42; index++) {
    const key = cursor.key();
    cells.push({
      day: cursor,
      dayKey: key,
      dayOfMonth: cursor.day,
      inCurrentMonth:
        cursor.year === monthStart.year && cursor.month === monthStart.month,
      isToday: cursor.equals(today),
      outOfRange: cursor.isBefore(today) || horizonEnd.isBefore(cursor),
      freeMinutes: capacityByDay.get(key) ?? 0,
    });
    cursor = cursor.next();
  }

  const weeks: AvailabilityDayCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return { anchor: monthStart, weeks };
}

/**
 * The range the capacity query should cover for a month view — the visible
 * grid, clipped to the bookable horizon.
 *
 * Takes the ANCHOR, not a built month, and that is load-bearing: the month
 * carries the capacity it was built from, so deriving the query range from
 * it would make the query depend on its own result. Both are derived from
 * the anchor instead, and neither depends on the other.
 *
 * Clipped rather than the raw grid because the projection is one document
 * read per barber per day: fetching a trailing week nobody may book is
 * 3 barbers × 7 days of reads that can only ever answer "no".
 */
export function monthQueryRange(
  anchor: CalendarDay,
  today: CalendarDay,
  horizonEnd: CalendarDay,
): DateRange | null {
  const monthStart = startOfMonth(anchor);
  const first = addDays(monthStart, -(monthStart.weekday() - 1));
  const last = addDays(first, 41);

  const from = first.isBefore(today) ? today : first;
  const to = horizonEnd.isBefore(last) ? horizonEnd : last;
  if (to.isBefore(from)) return null;

  const range = DateRange.create(from, to);
  return range.isSuccess() ? range.value : null;
}
