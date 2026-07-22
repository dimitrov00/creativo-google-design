import {
  Appointment,
  Result,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/application/booking';
import { ServiceId } from '@creativo/application/catalog';
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import { buildCalendarMonth } from './calendar-month';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function at(iso: string): ZonedDateTime {
  return unwrap(ZonedDateTime.fromISO(iso, 'Europe/Sofia'));
}

function appointmentAt(id: string, startIso: string): Appointment {
  const start = at(startIso);
  const timeSlot = unwrap(
    TimeSlot.create({
      startIso,
      endIso: start.plusMinutes(30).toISO(),
      zone: 'Europe/Sofia',
    }),
  );
  const seat = Seat.of({
    id: unwrap(SeatId.create('seat_1')),
    subject: SeatSubject.account(unwrap(UserId.create('user_1')), 'self'),
    serviceId: unwrap(ServiceId.create('service_1')),
  });
  return unwrap(
    Appointment.reconstitute({
      id,
      barberId: 'barber_1',
      locationId: 'location_1',
      timeSlot,
      seats: [seat],
      status: { kind: 'confirmed' },
    }),
  );
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
      appointmentAt('a1', '2026-03-05T10:00:00'),
      appointmentAt('a2', '2026-03-05T15:00:00'),
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
