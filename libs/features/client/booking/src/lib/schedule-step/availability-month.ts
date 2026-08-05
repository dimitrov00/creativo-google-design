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

/**
 * A cell, or the blank that holds a column open before the 1st.
 *
 * `null` rather than a day from the previous month, and that is the whole
 * difference between a paged grid and a continuous one. A pager pads with the
 * neighbouring month's real dates because it shows one month at a time and
 * those cells would otherwise be empty holes. A SCROLLER already has the
 * previous month directly above, so padding with real dates renders the same
 * days twice, three rows apart — and on the boundary that includes today,
 * which then appears twice with its dot. Apple's own scrolling calendar leaves
 * them blank for exactly this reason.
 */
export type AvailabilityGridCell = AvailabilityDayCell | null;

/**
 * A cell with every RESTING fact already resolved — what the template binds.
 *
 * Selection is deliberately absent: it is the one thing that changes on a tap,
 * and baking it in here would mean rebuilding every cell in the run each time
 * someone picks a day. The template answers selection with a string compare
 * against the chosen key instead. See the note on the step's `months()`.
 */
export interface ScheduleDayVm {
  readonly day: CalendarDay;
  readonly dayKey: string;
  readonly dayOfMonth: number;
  readonly isToday: boolean;
  readonly bookable: boolean;
  /** The badge's resting state — never `selected`, which the template adds. */
  readonly state: 'plain' | 'outside' | 'unavailable';
  readonly aria: string;
}

export interface ScheduleMonthVm {
  readonly anchor: CalendarDay;
  readonly key: string;
  readonly weeks: readonly (readonly (ScheduleDayVm | null)[])[];
}

export interface AvailabilityMonth {
  readonly anchor: CalendarDay;
  /** `YYYY-MM` — stable across rebuilds, so `@for` never re-creates a month. */
  readonly key: string;
  readonly weeks: readonly (readonly AvailabilityGridCell[])[];
}

/**
 * A Monday-first month grid, each cell carrying the free minutes the capacity
 * projection reported for that day.
 *
 * Separate from `client/appointments`' `buildCalendarMonth` on purpose: that
 * one counts the viewer's OWN appointments, this one measures a shop's spare
 * capacity. Same shape, opposite meaning — merging them would produce a cell
 * type where half the fields are always wrong.
 *
 * ### A month holds ITS OWN days, and nothing else
 * A paged grid pads both ends with the neighbouring months' real dates,
 * because it shows one month at a time and those cells would otherwise be
 * holes. A scrolling run has the neighbours right there, so padding with real
 * dates renders the same week twice a few rows apart — and across the July/
 * August boundary that meant today appearing twice, dot and all. So: the
 * leading pad is BLANK (`null`) and there is no trailing pad. Every date on
 * screen appears exactly once, which is what a continuous calendar promises.
 *
 * Everything walks `CalendarDay.next()`, never `+24h`: on a DST transition a
 * day is 23 or 25 hours, and a grid built on millisecond arithmetic silently
 * repeats or skips a date twice a year.
 */
export function buildAvailabilityMonth(input: {
  readonly anchor: CalendarDay;
  readonly today: CalendarDay;
  readonly horizonEnd: CalendarDay;
  readonly capacityByDay: ReadonlyMap<string, number>;
}): AvailabilityMonth {
  const { anchor, today, horizonEnd, capacityByDay } = input;
  const monthStart = anchor.startOfMonth();
  const monthEnd = anchor.endOfMonth();

  // ISO weekday is 1..7 Monday-first, so the lead-in is simply weekday − 1.
  const cells: AvailabilityGridCell[] = Array.from(
    { length: monthStart.weekday() - 1 },
    () => null,
  );

  let cursor = monthStart;
  while (!monthEnd.isBefore(cursor)) {
    const key = cursor.key();
    cells.push({
      day: cursor,
      dayKey: key,
      dayOfMonth: cursor.day,
      inCurrentMonth: true,
      isToday: cursor.equals(today),
      outOfRange: cursor.isBefore(today) || horizonEnd.isBefore(cursor),
      freeMinutes: capacityByDay.get(key) ?? 0,
    });
    cursor = cursor.next();
  }

  // Pad the LAST row to seven so the grid's columns stay square; these are
  // blanks, not the next month's days.
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: AvailabilityGridCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return { anchor: monthStart, key: monthStart.key().slice(0, 7), weeks };
}

/**
 * Every month between today and the horizon, in order — the scroller's spine.
 *
 * Bounded by the policy's horizon in MONTHS, so this is a handful of entries
 * and the whole run renders eagerly. See `ui-calendar-scroller` for why that
 * is deliberate rather than a virtualization gap.
 */
export function buildAvailabilityMonths(input: {
  readonly today: CalendarDay;
  readonly horizonEnd: CalendarDay;
  readonly capacityByDay: ReadonlyMap<string, number>;
}): readonly AvailabilityMonth[] {
  const months: AvailabilityMonth[] = [];
  let cursor = input.today.startOfMonth();
  // `<=` on the horizon's own month: the horizon lands on a month's last day,
  // so the final month must be included, not stopped short of.
  while (!input.horizonEnd.isBefore(cursor)) {
    months.push(
      buildAvailabilityMonth({
        anchor: cursor,
        today: input.today,
        horizonEnd: input.horizonEnd,
        capacityByDay: input.capacityByDay,
      }),
    );
    cursor = cursor.endOfMonth().next();
  }
  return months;
}

/**
 * The range the capacity query should cover — today through the horizon.
 *
 * One range for the WHOLE run rather than one per visible month: the scroller
 * renders every month at once, so a per-month query would fire a handful of
 * overlapping listeners for a span the reader can answer in one. It is
 * clipped to the horizon because the projection is one document read per
 * barber per day, and a day nobody may book can only ever answer "no".
 */
export function horizonQueryRange(
  today: CalendarDay,
  horizonEnd: CalendarDay,
): DateRange | null {
  if (horizonEnd.isBefore(today)) return null;
  const range = DateRange.create(today, horizonEnd);
  return range.isSuccess() ? range.value : null;
}
