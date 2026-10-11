import { describe, expect, it } from 'vitest';
import { BookingLifecycle } from '../components/booking-lifecycle.data';
import { CancellationReasonSet } from '../components/seat-outcome.data';
import { Seat } from '../components/seat.data';
import { BusyKey } from '../primitives/busy-key.primitive';
import { ZonedTimeSystem } from '../systems/zoned-time.system';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  utcMs,
} from '../testing';
import { appointmentFixture, seatFixture } from './appointment.fixtures';

// The appointment cases of `testing.spec.ts`'s "fixture builders" block.

describe('appointment fixture builders', () => {
  it('the appointment agrees with its seat, busy key and day', () => {
    const appointment = appointmentFixture();
    const seat = appointment.seats[0] as Seat;
    expect({
      startMinutes: appointment.startMinutes,
      endMinutes: appointment.endMinutes,
    }).toEqual(Seat.range(seat));
    expect(appointment.startMinutes).toBe(600);
    expect(appointment.localDate).toBe(FIXTURE_TODAY);
    expect(appointment.utcEpochMs).toBe(utcMs('2026-09-28T10:00:00+03:00'));
    expect(appointment.busyKeys).toEqual([
      BusyKey.of(seat.barberId, FIXTURE_TODAY),
    ]);
    expect(appointment.barberIds).toEqual([FIXTURE_IDS.barber]);
    expect(
      ZonedTimeSystem.toLocal(appointment.utcEpochMs, FIXTURE_TIME_ZONE),
    ).toEqual({ localDate: FIXTURE_TODAY, minute: 600 });
    expect(appointmentFixture({ revision: 4 }).revision).toBe(4);
  });

  it('is confirmed, booked a day before now, with nobody to call and no zone', () => {
    const appointment = appointmentFixture();
    expect(appointment.bookingStatus).toBe('CONFIRMED');
    expect(appointment.bookedAtUtcMs).toBe(FIXTURE_NOW_UTC_MS - 86_400_000);
    expect(appointment.contactName).toBeNull();
    expect('zone' in appointment).toBe(false);
  });

  it('takes a whole lifecycle variant, leaving no field of the default one', () => {
    const cancelled = appointmentFixture({
      lifecycle: BookingLifecycle.cancel(
        FIXTURE_NOW_UTC_MS,
        CancellationReasonSet.of(['CLIENT_UNWELL']),
      ),
    });
    expect(cancelled.bookingStatus).toBe('CANCELLED');
    expect('confirmedAtUtcMs' in cancelled).toBe(false);
  });

  it('the seat is the client’s own scheduled cut, flat', () => {
    expect(seatFixture()).toMatchObject({
      seatId: FIXTURE_IDS.seat,
      seatSubject: 'ACCOUNT',
      subjectUserId: FIXTURE_IDS.client,
      subjectRelationship: 'SELF',
      attendanceState: 'SCHEDULED',
      priceCents: 2800,
      currency: 'EUR',
      durationMinutes: 30,
      tipCents: null,
    });
  });

  it('every fixture survives deepFreeze (no builder shares a mutable value)', () => {
    const a = deepFreeze(appointmentFixture());
    const b = appointmentFixture();
    expect(Object.isFrozen(b)).toBe(false);
    expect(b).toEqual(a);
  });
});
