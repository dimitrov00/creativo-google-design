import { type CapacityMonthId, LocalDate, MinuteCount } from '@core/primitives';
import { CalendarGridSystem } from '@core/systems';
import type { UiDateBadgeState } from '@creativo/ui/patterns';

export interface AvailabilityDayCell {
  /** The shop day — also the cell's `data-day-key`. */
  readonly localDate: LocalDate;
  /** The number to render. */
  readonly dayOfMonth: number;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
  /** Outside the bookable horizon, or before today — never tappable. */
  readonly outOfRange: boolean;
  /** Free minutes across every eligible barber. 0 ⇒ nothing to offer. */
  readonly freeMinutes: MinuteCount;
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
 * against the chosen day instead. See the note on the step's `months()`.
 */
export interface ScheduleDayVm {
  readonly localDate: LocalDate;
  readonly dayOfMonth: number;
  readonly isToday: boolean;
  readonly bookable: boolean;
  /**
   * The badge's resting state — the date badge's own input values (a
   * design-system contract), never `selected`, which the template adds.
   */
  readonly state: Exclude<UiDateBadgeState, 'selected'>;
  readonly aria: string;
}

export interface ScheduleMonthVm {
  /** The month's 1st. */
  readonly anchor: LocalDate;
  /** `YYYY-MM` — the month's own key (`LocalDate.monthKey`). */
  readonly key: CapacityMonthId;
  readonly weeks: readonly (readonly (ScheduleDayVm | null)[])[];
}

export interface AvailabilityMonth {
  /** The month's 1st. */
  readonly anchor: LocalDate;
  /** `YYYY-MM` — stable across rebuilds, so `@for` never re-creates a month. */
  readonly key: CapacityMonthId;
  readonly weeks: readonly (readonly AvailabilityGridCell[])[];
}

/**
 * A Monday-first month grid (`CalendarGridSystem.monthGrid`), each cell
 * carrying the free minutes the capacity projection reported for that day.
 *
 * Separate from `client/appointments`' month on purpose: that one counts the
 * viewer's OWN appointments, this one measures a shop's spare capacity. Same
 * shape, opposite meaning — merging them would produce a cell type where
 * half the fields are always wrong.
 *
 * ### A month holds ITS OWN days, and nothing else
 * A paged grid pads both ends with the neighbouring months' real dates,
 * because it shows one month at a time and those cells would otherwise be
 * holes. A scrolling run has the neighbours right there, so padding with real
 * dates renders the same week twice a few rows apart — and across the July/
 * August boundary that meant today appearing twice, dot and all. So: every
 * padding column is BLANK (`null`). Every date on screen appears exactly
 * once, which is what a continuous calendar promises.
 *
 * Shop days and civil arithmetic only (Law 7.3): a DST transition has no say
 * in which dates a month holds.
 */
export function buildAvailabilityMonth(input: {
  readonly anchor: LocalDate;
  readonly today: LocalDate;
  readonly horizonEnd: LocalDate;
  readonly capacityByDay: ReadonlyMap<LocalDate, MinuteCount>;
}): AvailabilityMonth {
  const { today, horizonEnd, capacityByDay } = input;
  const monthStart = LocalDate.startOfMonth(input.anchor);
  const weeks: AvailabilityGridCell[][] = CalendarGridSystem.monthGrid(
    monthStart,
    [],
  ).map((week) =>
    week.map((cell): AvailabilityGridCell => {
      if (!cell.inMonth) return null;
      return {
        localDate: cell.localDate,
        dayOfMonth: cell.dayOfMonth,
        inCurrentMonth: true,
        isToday: cell.localDate === today,
        outOfRange: !CalendarGridSystem.inWindow(
          cell.localDate,
          today,
          horizonEnd,
        ),
        freeMinutes: capacityByDay.get(cell.localDate) ?? MinuteCount.ZERO,
      };
    }),
  );
  return { anchor: monthStart, key: LocalDate.monthKey(monthStart), weeks };
}

/**
 * Every month between today and the horizon, in order — the scroller's spine.
 *
 * Bounded by the policy's horizon in MONTHS, so this is a handful of entries
 * and the whole run renders eagerly. See `ui-calendar-scroller` for why that
 * is deliberate rather than a virtualization gap.
 */
export function buildAvailabilityMonths(input: {
  readonly today: LocalDate;
  readonly horizonEnd: LocalDate;
  readonly capacityByDay: ReadonlyMap<LocalDate, MinuteCount>;
}): readonly AvailabilityMonth[] {
  const months: AvailabilityMonth[] = [];
  let cursor = LocalDate.startOfMonth(input.today);
  // `<=` on the horizon's own month: the horizon lands on a month's last day,
  // so the final month must be included, not stopped short of.
  while (LocalDate.compare(cursor, input.horizonEnd) <= 0) {
    months.push(
      buildAvailabilityMonth({
        anchor: cursor,
        today: input.today,
        horizonEnd: input.horizonEnd,
        capacityByDay: input.capacityByDay,
      }),
    );
    cursor = LocalDate.addMonths(cursor, 1);
  }
  return months;
}
