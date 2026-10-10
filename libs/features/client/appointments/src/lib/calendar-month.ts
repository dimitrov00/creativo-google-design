import { ZonedDateTime } from '@creativo/application/accounts';
import { Appointment } from '@creativo/application/booking';
import {
  CalendarGridSystem,
  type CalendarWeek,
  DayKey,
  ZonedTimeSystem,
} from '@creativo/ecs-core';

export interface CalendarDayCell {
  readonly date: ZonedDateTime;
  readonly dayKey: string;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly appointmentCount: number;
}

export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
  readonly weeks: readonly (readonly CalendarDayCell[])[];
}

/**
 * A Monday-first month grid, padded to whole weeks, with an appointment
 * count per cell — the "date primitives get a real workout" slice
 * (blueprint §8 Phase 6 item 4). `today` comes from the injected `Clock`
 * port — never a raw `Date`.
 *
 * Phase 2 shim: the grid is `CalendarGridSystem.monthGrid` in
 * `@creativo/ecs-core` over the anchor zone's day table; this keeps the
 * legacy cells (each with its `ZonedDateTime`) for its callers.
 */
export function buildCalendarMonth(
  anchor: ZonedDateTime,
  today: ZonedDateTime,
  appointments: readonly Appointment[],
): CalendarMonth {
  const monthStart = anchor.startOfMonth();
  const monthKey = dayKeyOf(monthStart);
  const range = CalendarGridSystem.gridRange(monthKey);
  const weeks = CalendarGridSystem.monthGrid(
    monthKey,
    ZonedTimeSystem.dayTable(anchor.zoneName, range.fromDayKey, range.toDayKey),
    appointments.map((appointment) =>
      DayKey.of(appointment.timeSlot.calendarDayKey()),
    ),
  );
  return {
    year: monthStart.year,
    month: monthStart.month,
    weeks: toLegacyWeeks(weeks, monthStart, monthKey, dayKeyOf(today)),
  };
}

/* ── ECS ↔ legacy converters ─────────────────────────────────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Same `YYYY-MM-DD` shape as `TimeSlot.calendarDayKey()`, on the instant's own calendar. */
function dayKeyOf(date: ZonedDateTime): DayKey {
  return DayKey.of(`${date.year}-${pad2(date.month)}-${pad2(date.day)}`);
}

/** The system's weeks → the legacy cells, each dated off the month's start. */
function toLegacyWeeks(
  weeks: readonly CalendarWeek[],
  monthStart: ZonedDateTime,
  monthKey: DayKey,
  todayKey: DayKey,
): readonly (readonly CalendarDayCell[])[] {
  return weeks.map((week) =>
    week.map((cell) => ({
      date: monthStart.plusDays(
        ZonedTimeSystem.daysBetween(monthKey, cell.dayKey),
      ),
      dayKey: cell.dayKey,
      inCurrentMonth: cell.inMonth,
      isToday: cell.dayKey === todayKey,
      appointmentCount: cell.marks,
    })),
  );
}
