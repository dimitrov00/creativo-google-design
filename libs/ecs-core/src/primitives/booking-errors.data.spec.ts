import { describe, expect, it } from 'vitest';
import { localDate, minute, unwrapOk } from '@core/testing';
import { MinuteCount } from './duration-minutes.primitive';
import { BarberId, ServiceId } from './ids.primitive';
import {
  BookingError,
  BookingErrorCode,
  BookingErrorField,
  ShopUnavailableReason,
} from './booking-errors.data';
import { SchedulingError } from './scheduling-errors.data';

describe('BookingError', () => {
  it('keeps every booking commit code, SCREAMING with the BOOKING_ prefix (flatten-spec §4.2)', () => {
    expect(Object.values(BookingErrorCode).sort()).toEqual([
      'BOOKING_BARBER_NOT_ROSTERED',
      'BOOKING_BEYOND_HORIZON',
      'BOOKING_CONFLICTING_SERVICES',
      'BOOKING_INVALID_INPUT',
      'BOOKING_INVARIANT_VIOLATED',
      'BOOKING_PARTY_TOO_LARGE',
      'BOOKING_SERVICE_NOT_AT_LOCATION',
      'BOOKING_SLOT_UNAVAILABLE',
      'BOOKING_TOO_SOON',
      'BOOKING_UNAUTHENTICATED',
      'BOOKING_UNKNOWN_SERVICE',
    ]);
  });

  it('has one factory per code, each a plain struct', () => {
    const violation = SchedulingError.appointmentEmptySeats();
    const errors: readonly BookingError[] = [
      BookingError.invalidInput('seats'),
      BookingError.unauthenticated(),
      BookingError.unknownService('svc-1'),
      BookingError.serviceNotAtLocation('svc-1', 'loc-1'),
      BookingError.conflictingServices(
        ServiceId.of('svc-1'),
        ServiceId.of('svc-2'),
      ),
      BookingError.barberNotRostered(
        BarberId.of('b-1'),
        localDate('2026-10-10'),
      ),
      BookingError.slotUnavailable(
        BarberId.of('b-1'),
        localDate('2026-10-10'),
        minute(600),
        0,
      ),
      BookingError.tooSoon(unwrapOk(MinuteCount.of(30))),
      BookingError.beyondHorizon(3),
      BookingError.partyTooLarge(5),
      BookingError.invariantViolated([violation]),
    ];
    expect(errors.map((error) => error.errorCode).sort()).toEqual(
      Object.values(BookingErrorCode).sort(),
    );
    expect(BookingError.invariantViolated([violation])).toEqual({
      errorCode: 'BOOKING_INVARIANT_VIOLATED',
      violations: [violation],
    });
  });

  it('carries the slot refusal on the shop’s wall clock — the day and the minute, never an instant', () => {
    expect(
      BookingError.slotUnavailable(
        BarberId.of('b-1'),
        localDate('2026-10-10'),
        minute(615),
        2,
      ),
    ).toEqual({
      errorCode: 'BOOKING_SLOT_UNAVAILABLE',
      barberId: 'b-1',
      localDate: '2026-10-10',
      startMinutes: 615,
      seatIndex: 2,
    });
    expect(
      BookingError.barberNotRostered(
        BarberId.of('b-1'),
        localDate('2026-10-10'),
      ),
    ).toEqual({
      errorCode: 'BOOKING_BARBER_NOT_ROSTERED',
      barberId: 'b-1',
      localDate: '2026-10-10',
    });
  });

  it('gives every invalid_input one shape, the three reasoned fields included', () => {
    expect(BookingError.invalidInput('seats')).toEqual({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'seats',
      detail: null,
      reason: null,
    });
    expect(
      BookingError.shopUnavailable('loc-1', ShopUnavailableReason.Unlisted),
    ).toEqual({
      errorCode: BookingErrorCode.InvalidInput,
      field: BookingErrorField.LocationId,
      detail: 'loc-1',
      reason: 'unlisted',
    });
    expect(BookingError.personDoubleBooked('self')).toEqual({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'person_overlap',
      detail: 'self',
      reason: null,
    });
    expect(BookingError.duplicateGuestLabel('Иван')).toEqual({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'guest_label',
      detail: 'Иван',
      reason: null,
    });
  });

  it('keeps the wire refinement vocabularies spelled as today (flatten-spec §4.1)', () => {
    expect(BookingErrorField).toEqual({
      LocationId: 'locationId',
      PersonOverlap: 'person_overlap',
      GuestLabel: 'guest_label',
    });
    expect(ShopUnavailableReason).toEqual({
      NotFound: 'not_found',
      Unlisted: 'unlisted',
    });
  });
});
