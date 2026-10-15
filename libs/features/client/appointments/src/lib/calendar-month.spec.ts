import type { Result } from '@creativo/application/booking';
import { ZonedDateTime } from '@creativo/application/accounts';
import type { Appointment } from '@core/entities';
import { Seat } from '@core/components';
import { AppointmentId, BusyKey, LocalDate } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  minute,
  seatFixture,
  unwrapOk,
} from '@core/testing';
import { buildCalendarMonth } from './calendar-month';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function at(iso: string): ZonedDateTime {
  return unwrap(ZonedDateTime.fromISO(iso, 'Europe/Sofia'));
}

/** A confirmed one-seat visit at `startMinutes` on the shop day `localDate`. */
function appointmentAt(
  id: string,
  localDate: string,
  startMinutes: number,
): Appointment {
  const day = unwrapOk(LocalDate.parse(localDate));
  const seat = seatFixture({ startMinutes: minute(startMinutes) });
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: day,
    startMinutes: seat.startMinutes,
    endMinutes: Seat.endMinutes(seat),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(day, seat.startMinutes, FIXTURE_TIME_ZONE),
    ),
    seats: [seat],
    busyKeys: [BusyKey.of(seat.barberId, day)],
  });
}

describe('buildCalendarMonth', () => {
  it('builds a Monday-first grid padded to whole weeks, anchored on the given month', () => {
    const month = buildCalendarMonth(
      at('2026-03-17T00:00:00'),
      at('2026-03-05T00:00:00'),
      [],
    );
    expect(month.year).toBe(2026);
    expect(month.month).toBe(3);
    for (const week of month.weeks) {
      expect(week).toHaveLength(7);
    }
    // 2026-03-01 is a Sunday: 6 leading blanks from the prior month.
    const firstWeek = month.weeks[0];
    expect(firstWeek?.[0]?.inCurrentMonth).toBe(false);
    expect(firstWeek?.[6]?.inCurrentMonth).toBe(true);
    expect(firstWeek?.[6]?.date.day).toBe(1);
  });

  it('marks the cell matching `today` and counts appointments per day', () => {
    const today = at('2026-03-05T00:00:00');
    const appointments = [
      appointmentAt('a1', '2026-03-05', 10 * 60),
      appointmentAt('a2', '2026-03-05', 15 * 60),
    ];
    const month = buildCalendarMonth(today, today, appointments);

    const cell = month.weeks
      .flat()
      .find((c) => c.date.day === 5 && c.inCurrentMonth);
    expect(cell?.isToday).toBe(true);
    expect(cell?.appointmentCount).toBe(2);

    const otherCell = month.weeks
      .flat()
      .find((c) => c.date.day === 6 && c.inCurrentMonth);
    expect(otherCell?.isToday).toBe(false);
    expect(otherCell?.appointmentCount).toBe(0);
  });
});
