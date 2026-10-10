import { describe, expect, it } from 'vitest';
import {
  BookingCommitError,
  BookingCommitErrorCode,
  BookingCommitField,
  ShopUnavailableReason,
} from './booking-commit-errors.data';
import { SchedulingError } from './scheduling-errors.data';

describe('BookingCommitError', () => {
  it('keeps every legacy booking.commit.* key verbatim', () => {
    expect(Object.values(BookingCommitErrorCode).sort()).toEqual([
      'booking.commit.barber_not_rostered',
      'booking.commit.beyond_horizon',
      'booking.commit.conflicting_services',
      'booking.commit.invalid_input',
      'booking.commit.invariant_violated',
      'booking.commit.party_too_large',
      'booking.commit.service_not_at_location',
      'booking.commit.slot_unavailable',
      'booking.commit.too_soon',
      'booking.commit.unauthenticated',
      'booking.commit.unknown_service',
    ]);
  });

  it('has one factory per code, each a plain struct', () => {
    const violation = SchedulingError.appointmentEmptySeats();
    const errors: readonly BookingCommitError[] = [
      BookingCommitError.invalidInput('seats'),
      BookingCommitError.unauthenticated(),
      BookingCommitError.unknownService('svc-1'),
      BookingCommitError.serviceNotAtLocation('svc-1', 'loc-1'),
      BookingCommitError.conflictingServices('svc-1', 'svc-2'),
      BookingCommitError.barberNotRostered('b-1', '2026-10-10'),
      BookingCommitError.slotUnavailable('b-1', 1_000, 0),
      BookingCommitError.tooSoon(30),
      BookingCommitError.beyondHorizon(3),
      BookingCommitError.partyTooLarge(5),
      BookingCommitError.invariantViolated([violation]),
    ];
    expect(errors.map((error) => error.code).sort()).toEqual(
      Object.values(BookingCommitErrorCode).sort(),
    );
    expect(BookingCommitError.invariantViolated([violation])).toEqual({
      code: 'booking.commit.invariant_violated',
      violations: [violation],
    });
  });

  it('gives every invalid_input one shape, the three reasoned fields included', () => {
    expect(BookingCommitError.invalidInput('seats')).toEqual({
      code: BookingCommitErrorCode.InvalidInput,
      field: 'seats',
      detail: null,
      reason: null,
    });
    expect(
      BookingCommitError.shopUnavailable(
        'loc-1',
        ShopUnavailableReason.Unlisted,
      ),
    ).toEqual({
      code: BookingCommitErrorCode.InvalidInput,
      field: BookingCommitField.LocationId,
      detail: 'loc-1',
      reason: 'unlisted',
    });
    expect(BookingCommitError.personDoubleBooked('self')).toEqual({
      code: BookingCommitErrorCode.InvalidInput,
      field: 'person_overlap',
      detail: 'self',
      reason: null,
    });
    expect(BookingCommitError.duplicateGuestLabel('Иван')).toEqual({
      code: BookingCommitErrorCode.InvalidInput,
      field: 'guest_label',
      detail: 'Иван',
      reason: null,
    });
  });
});
