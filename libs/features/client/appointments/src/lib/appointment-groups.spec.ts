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
import { groupAppointmentsByDay } from './appointment-groups';

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

describe('groupAppointmentsByDay', () => {
  it('groups same-day appointments together, sorted chronologically', () => {
    const groups = groupAppointmentsByDay([
      appointmentAt('later', '2030-06-01', 15 * 60),
      appointmentAt('earlier', '2030-06-01', 9 * 60),
      appointmentAt('nextDay', '2030-06-02', 9 * 60),
    ]);

    expect(groups).toHaveLength(2);
    const [first, second] = groups;
    expect(first?.appointments.map((a) => a.id)).toEqual(['earlier', 'later']);
    expect(second?.appointments.map((a) => a.id)).toEqual(['nextDay']);
  });

  it('returns an empty array for no appointments', () => {
    expect(groupAppointmentsByDay([])).toEqual([]);
  });
});
