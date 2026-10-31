import { describe, expect, it } from 'vitest';
import { localDate, minute, unwrapOk } from '@core/testing';
import {
  AppointmentId,
  BarberId,
  MinuteCount,
  ServiceId,
} from '@core/primitives';
import {
  type BookingCallRefusal,
  BookingError,
  BookingErrorCode,
  BookingErrorField,
  ShopUnavailableReason,
} from './booking.error';
import { SchedulingError } from './scheduling.error';

describe('BookingError', () => {
  it('keeps every booking commit code, SCREAMING with the BOOKING_ prefix (flatten-spec §4.2)', () => {
    expect(Object.values(BookingErrorCode).sort()).toEqual(
      [
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
        // Phase 4a: the booking callables' own refusals (the legacy dotted
        // codes' successors, `legacy-wire-successors.spec.ts`).
        'BOOKING_COMMIT_FORBIDDEN',
        'BOOKING_COMMIT_STORE_FAILED',
        'BOOKING_TRANSITION_UNAUTHENTICATED',
        'BOOKING_TRANSITION_FORBIDDEN',
        'BOOKING_TRANSITION_INVALID_INPUT',
        'BOOKING_TRANSITION_NOT_FOUND',
        'BOOKING_TRANSITION_NOT_ALLOWED',
        'BOOKING_TRANSITION_REOPEN_WINDOW_CLOSED',
        'BOOKING_TRANSITION_SLOT_TAKEN',
        'BOOKING_ARRIVED_UNAUTHENTICATED',
        'BOOKING_ARRIVED_FORBIDDEN',
        'BOOKING_ARRIVED_INVALID_INPUT',
        'BOOKING_ARRIVED_NOT_FOUND',
        'BOOKING_ARRIVED_NOT_ALLOWED',
        'BOOKING_TIP_UNAUTHENTICATED',
        'BOOKING_TIP_FORBIDDEN',
        'BOOKING_TIP_INVALID_INPUT',
        'BOOKING_TIP_NOT_FOUND',
        // Phase 4b: the booking surfaces' own words (the dotted i18n keys'
        // successors, 4B-4) — no pipeline raises them.
        'BOOKING_CALL_FAILED',
        'BOOKING_TRANSITION_SEAT_RESOLVED',
        // Phase 3 WS-D (P3-DEP-18): a seated or created record under erasure.
        'BOOKING_CLIENT_ERASED',
      ].sort(),
    );
  });

  it('has one factory per code, each a plain struct', () => {
    const violation = SchedulingError.appointmentEmptySeats();
    const visit = AppointmentId.of('apt-1');
    const errors: readonly (
      | BookingError
      | BookingCallRefusal
      | BookingError.BareCall<BookingError.SurfaceCode>
    )[] = [
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
      BookingError.clientErased(),
      BookingError.bare(BookingErrorCode.CommitForbidden),
      BookingError.bare(BookingErrorCode.CommitStoreFailed),
      BookingError.bare(BookingErrorCode.TransitionUnauthenticated),
      BookingError.bare(BookingErrorCode.TransitionForbidden),
      BookingError.callInvalidInput(
        BookingErrorCode.TransitionInvalidInput,
        'to',
      ),
      BookingError.callNotFound(BookingErrorCode.TransitionNotFound, visit),
      BookingError.statusMove(
        BookingErrorCode.TransitionNotAllowed,
        'COMPLETED',
        'CONFIRMED',
      ),
      BookingError.statusMove(
        BookingErrorCode.TransitionReopenWindowClosed,
        'CANCELLED',
        'CONFIRMED',
      ),
      BookingError.statusMove(
        BookingErrorCode.TransitionSlotTaken,
        'CANCELLED',
        'CONFIRMED',
      ),
      BookingError.bare(BookingErrorCode.ArrivedUnauthenticated),
      BookingError.bare(BookingErrorCode.ArrivedForbidden),
      BookingError.callInvalidInput(
        BookingErrorCode.ArrivedInvalidInput,
        'appointmentId',
      ),
      BookingError.callNotFound(BookingErrorCode.ArrivedNotFound, visit),
      BookingError.statusMove(
        BookingErrorCode.ArrivedNotAllowed,
        'COMPLETED',
        'arrived',
      ),
      BookingError.bare(BookingErrorCode.TipUnauthenticated),
      BookingError.bare(BookingErrorCode.TipForbidden),
      BookingError.callInvalidInput(BookingErrorCode.TipInvalidInput, 'seatId'),
      BookingError.callNotFound(BookingErrorCode.TipNotFound, visit),
      BookingError.bare(BookingErrorCode.CallFailed),
      BookingError.bare(BookingErrorCode.TransitionSeatResolved),
    ];
    expect(errors.map((error) => error.errorCode).sort()).toEqual(
      Object.values(BookingErrorCode).sort(),
    );
    expect(BookingError.invariantViolated([violation])).toEqual({
      errorCode: 'BOOKING_INVARIANT_VIOLATED',
      violations: [violation],
    });
    expect(
      BookingError.statusMove(
        BookingErrorCode.TransitionNotAllowed,
        'COMPLETED',
        'CONFIRMED',
      ),
    ).toEqual({
      errorCode: 'BOOKING_TRANSITION_NOT_ALLOWED',
      fromBookingStatus: 'COMPLETED',
      toBookingStatus: 'CONFIRMED',
    });
    expect(
      BookingError.callNotFound(BookingErrorCode.TipNotFound, visit),
    ).toEqual({ errorCode: 'BOOKING_TIP_NOT_FOUND', appointmentId: 'apt-1' });
  });

  it('refuses an erased client by its code alone — no id, no contact on the struct (Phase 3 WS-D, P3-RU-20)', () => {
    const error: BookingError = BookingError.clientErased();
    expect(error).toEqual({ errorCode: 'BOOKING_CLIENT_ERASED' });
    expect(Object.keys(error)).toEqual(['errorCode']);
    expect(JSON.parse(JSON.stringify(error))).toEqual(error);
    expect(Object.getPrototypeOf(error)).toBe(Object.prototype);
  });

  it('spells the surfaces’ own words — the successors of the dotted i18n keys (Phase 4b, 4B-4)', () => {
    expect(BookingErrorCode.CallFailed).toBe('BOOKING_CALL_FAILED');
    expect(BookingErrorCode.TransitionSeatResolved).toBe(
      'BOOKING_TRANSITION_SEAT_RESOLVED',
    );
    expect(BookingError.bare(BookingErrorCode.CallFailed)).toEqual({
      errorCode: 'BOOKING_CALL_FAILED',
    });
    expect(BookingError.bare(BookingErrorCode.TransitionSeatResolved)).toEqual({
      errorCode: 'BOOKING_TRANSITION_SEAT_RESOLVED',
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
