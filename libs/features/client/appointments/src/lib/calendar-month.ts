import { ZonedDateTime } from '@creativo/application/accounts';
import { Appointment } from '@creativo/application/booking';

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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Same `YYYY-MM-DD` shape as `TimeSlot.calendarDayKey()` — kept in sync so appointment/day matching is a plain string compare. */
function dayKey(date: ZonedDateTime): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/**
 * A Monday-first month grid, padded to whole weeks, with an appointment
 * count per cell — the "date primitives get a real workout" slice
 * (blueprint §8 Phase 6 item 4). All arithmetic goes through the kernel
 * `ZonedDateTime` (`startOfMonth`/`plusDays`/`weekday`/`daysInMonth`);
 * `today` comes from the injected `Clock` port — never a raw `Date`.
 */
export function buildCalendarMonth(
  anchor: ZonedDateTime,
  today: ZonedDateTime,
  appointments: readonly Appointment[],
): CalendarMonth {
  const monthStart = anchor.startOfMonth();
  const leadingBlanks = monthStart.weekday - 1;
  const gridStart = monthStart.plusDays(-leadingBlanks);
  const totalDays = leadingBlanks + monthStart.daysInMonth;
  const totalCells = Math.ceil(totalDays / 7) * 7;

  const countsByDay = new Map<string, number>();
  for (const appointment of appointments) {
    const key = appointment.timeSlot.calendarDayKey();
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
  }

  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = gridStart.plusDays(i);
    const key = dayKey(date);
    cells.push({
      date,
      dayKey: key,
      inCurrentMonth:
        date.month === monthStart.month && date.year === monthStart.year,
      isToday:
        date.year === today.year &&
        date.month === today.month &&
        date.day === today.day,
      appointmentCount: countsByDay.get(key) ?? 0,
    });
  }

  const weeks: CalendarDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return { year: monthStart.year, month: monthStart.month, weeks };
}
