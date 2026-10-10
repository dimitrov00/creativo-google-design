import { describe, expect, it } from 'vitest';
import {
  BookingFlowError,
  BookingFlowErrorCode,
} from './booking-flow-errors.data';
import { SchedulingError } from './scheduling-errors.data';

describe('BookingFlowError', () => {
  it('keeps every legacy booking.flow.* key verbatim — each has its copy already', () => {
    expect(Object.values(BookingFlowErrorCode).sort()).toEqual([
      'booking.flow.empty_cart',
      'booking.flow.flexible_days_full',
      'booking.flow.guest_not_found',
      'booking.flow.invalid_cart_operation',
      'booking.flow.invalid_guest',
      'booking.flow.invalid_transition',
      'booking.flow.no_flexible_days',
      'booking.flow.party_full',
      'booking.flow.seat_without_service',
    ]);
  });

  it('builds plain structs whose wrapped refusals ride as codes, never structs', () => {
    const errors: readonly BookingFlowError[] = [
      BookingFlowError.invalidTransition('location', 'confirmed'),
      BookingFlowError.invalidGuest('scheduling.seat_label.empty'),
      BookingFlowError.guestNotFound('guest-2'),
      BookingFlowError.partyFull(5),
      BookingFlowError.emptyCart(),
      BookingFlowError.seatWithoutService('guest-1'),
      BookingFlowError.flexibleDaysFull(7),
      BookingFlowError.noFlexibleDays(),
      BookingFlowError.invalidCartOperation(
        'scheduling.booking_cart.line_not_found',
      ),
    ];
    expect(errors.map((error) => error.code).sort()).toEqual(
      Object.values(BookingFlowErrorCode).sort(),
    );
    expect(
      BookingFlowError.invalidGuest('scheduling.seat_label.empty'),
    ).toEqual({
      code: 'booking.flow.invalid_guest',
      reasonCode: 'scheduling.seat_label.empty',
    });
    expect(BookingFlowError.seatWithoutService('guest-1')).toEqual({
      code: 'booking.flow.seat_without_service',
      seatKey: 'guest-1',
    });
  });

  it('passes the party duplicate label through as its own scheduling struct', () => {
    const error: BookingFlowError = SchedulingError.partyDuplicateLabel('Иван');
    expect(
      BookingFlowError.is(error, 'scheduling.booking_party.duplicate_label'),
    ).toBe(true);
    expect(BookingFlowError.is(error, BookingFlowErrorCode.PartyFull)).toBe(
      false,
    );
    const full: BookingFlowError = BookingFlowError.partyFull(5);
    if (BookingFlowError.is(full, BookingFlowErrorCode.PartyFull)) {
      expect(full.max).toBe(5);
    }
  });
});
