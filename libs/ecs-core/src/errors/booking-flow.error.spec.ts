import { describe, expect, it } from 'vitest';
import { GuestId, SeatKeyText } from '@core/primitives';
import { BookingFlowError, BookingFlowErrorCode } from './booking-flow.error';
import { SchedulingError } from './scheduling.error';

describe('BookingFlowError', () => {
  it('holds one SCREAMING BOOKING_FLOW_ code per legacy booking.flow.* key', () => {
    expect(Object.values(BookingFlowErrorCode).sort()).toEqual([
      'BOOKING_FLOW_EMPTY_CART',
      'BOOKING_FLOW_FLEXIBLE_DAYS_FULL',
      'BOOKING_FLOW_GUEST_NOT_FOUND',
      'BOOKING_FLOW_INVALID_CART_OPERATION',
      'BOOKING_FLOW_INVALID_GUEST',
      'BOOKING_FLOW_INVALID_TRANSITION',
      'BOOKING_FLOW_NO_FLEXIBLE_DAYS',
      'BOOKING_FLOW_PARTY_FULL',
      'BOOKING_FLOW_SEAT_WITHOUT_SERVICE',
    ]);
  });

  it('builds plain structs whose wrapped refusals ride as codes, never structs', () => {
    const errors: readonly BookingFlowError[] = [
      BookingFlowError.invalidTransition('LOCATION', 'CONFIRMED'),
      BookingFlowError.invalidGuest('SCHEDULING_SEAT_LABEL_EMPTY'),
      BookingFlowError.guestNotFound(GuestId.of('guest-2')),
      BookingFlowError.partyFull(5),
      BookingFlowError.emptyCart(),
      BookingFlowError.seatWithoutService(SeatKeyText.of('guest-1')),
      BookingFlowError.flexibleDaysFull(7),
      BookingFlowError.noFlexibleDays(),
      BookingFlowError.invalidCartOperation(
        'SCHEDULING_BOOKING_CART_LINE_NOT_FOUND',
      ),
    ];
    expect(errors.map((error) => error.errorCode).sort()).toEqual(
      Object.values(BookingFlowErrorCode).sort(),
    );
    expect(
      BookingFlowError.invalidGuest('SCHEDULING_SEAT_LABEL_EMPTY'),
    ).toEqual({
      errorCode: 'BOOKING_FLOW_INVALID_GUEST',
      reasonCode: 'SCHEDULING_SEAT_LABEL_EMPTY',
    });
    expect(
      BookingFlowError.seatWithoutService(SeatKeyText.of('guest-1')),
    ).toEqual({
      errorCode: 'BOOKING_FLOW_SEAT_WITHOUT_SERVICE',
      seatKey: 'guest-1',
    });
  });

  it('passes the party duplicate label through as its own scheduling struct', () => {
    const error: BookingFlowError = SchedulingError.partyDuplicateLabel('Иван');
    expect(
      BookingFlowError.is(error, 'SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL'),
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
