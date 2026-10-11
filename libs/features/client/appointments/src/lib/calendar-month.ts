import { ZonedDateTime } from '@creativo/application/accounts';
import { Appointment } from '@creativo/application/booking';
import { LocalDate, defect } from '@core/primitives';
import { CalendarGridSystem, type CalendarWeek } from '@core/systems';

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
 * `@core/systems`, on the shop's civil days (`LocalDate`, no zone, no
 * day table — flatten pass, Law 7); this keeps the legacy cells (each with
 * its `ZonedDateTime`, dated in the anchor's own zone) for its callers.
 */
export function buildCalendarMonth(
  anchor: ZonedDateTime,
  today: ZonedDateTime,
  appointments: readonly Appointment[],
): CalendarMonth {
  const monthStart = anchor.startOfMonth();
  const monthKey = localDateOf(monthStart);
  const weeks = CalendarGridSystem.monthGrid(
    monthKey,
    appointments.map((appointment) =>
      parseDay(appointment.timeSlot.calendarDayKey()),
    ),
  );
  return {
    year: monthStart.year,
    month: monthStart.month,
    weeks: toLegacyWeeks(weeks, monthStart, monthKey, localDateOf(today)),
  };
}

/* ── ECS ↔ legacy converters ─────────────────────────────────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** A `YYYY-MM-DD` the legacy calendar produced — a civil date by construction. */
function parseDay(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  if (!day.ok) defect(`unreachable: not a civil date: ${raw}`);
  return day.value;
}

/** Same `YYYY-MM-DD` shape as `TimeSlot.calendarDayKey()`, on the instant's own calendar. */
function localDateOf(date: ZonedDateTime): LocalDate {
  return parseDay(`${date.year}-${pad2(date.month)}-${pad2(date.day)}`);
}

/** The system's weeks → the legacy cells, each dated off the month's start. */
function toLegacyWeeks(
  weeks: readonly CalendarWeek[],
  monthStart: ZonedDateTime,
  monthKey: LocalDate,
  todayKey: LocalDate,
): readonly (readonly CalendarDayCell[])[] {
  return weeks.map((week) =>
    week.map((cell) => ({
      date: monthStart.plusDays(
        LocalDate.daysBetween(monthKey, cell.localDate),
      ),
      dayKey: cell.localDate,
      inCurrentMonth: cell.inMonth,
      isToday: cell.localDate === todayKey,
      appointmentCount: cell.marks,
    })),
  );
}
