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
import { groupAppointmentsByDay } from './appointment-groups';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function appointmentAt(id: string, startIso: string): Appointment {
  const start = unwrap(ZonedDateTime.fromISO(startIso, 'Europe/Sofia'));
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

describe('groupAppointmentsByDay', () => {
  it('groups same-day appointments together, sorted chronologically', () => {
    const groups = groupAppointmentsByDay([
      appointmentAt('later', '2030-06-01T15:00:00'),
      appointmentAt('earlier', '2030-06-01T09:00:00'),
      appointmentAt('nextDay', '2030-06-02T09:00:00'),
    ]);

    expect(groups).toHaveLength(2);
    const [first, second] = groups;
    expect(first?.appointments.map((a) => a.id.value)).toEqual([
      'earlier',
      'later',
    ]);
    expect(second?.appointments.map((a) => a.id.value)).toEqual(['nextDay']);
  });

  it('returns an empty array for no appointments', () => {
    expect(groupAppointmentsByDay([])).toEqual([]);
  });
});
