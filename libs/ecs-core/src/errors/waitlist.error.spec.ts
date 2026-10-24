import { describe, expect, it } from 'vitest';
import { BookingError, BookingErrorCode } from './booking.error';
import { WaitlistError, WaitlistErrorCode } from './waitlist.error';

describe('WaitlistError', () => {
  it('holds one SCREAMING BOOKING_WAITLIST_ code per legacy booking.waitlist.* key', () => {
    expect(Object.values(WaitlistErrorCode).sort()).toEqual([
      'BOOKING_WAITLIST_ALREADY_WATCHING',
      'BOOKING_WAITLIST_INVALID_REQUEST',
      'BOOKING_WAITLIST_TOO_MANY_DAYS',
      'BOOKING_WAITLIST_UNAUTHENTICATED',
    ]);
  });

  it('builds one plain struct per code, its parameters beside it', () => {
    const errors: readonly WaitlistError[] = [
      WaitlistError.unauthenticated(),
      WaitlistError.invalidRequest('localDate'),
      WaitlistError.tooManyDays(7),
      WaitlistError.alreadyWatching(),
    ];
    expect(errors.map((error) => error.errorCode).sort()).toEqual(
      Object.values(WaitlistErrorCode).sort(),
    );
    expect(WaitlistError.invalidRequest('localDate')).toEqual({
      errorCode: 'BOOKING_WAITLIST_INVALID_REQUEST',
      field: 'localDate',
    });
    expect(WaitlistError.tooManyDays(7)).toEqual({
      errorCode: 'BOOKING_WAITLIST_TOO_MANY_DAYS',
      max: 7,
    });
  });

  it('carries the commit’s refusal of the bag as the invalid request’s field — one wire shape', () => {
    const refused = WaitlistError.cartRefused(BookingError.partyTooLarge(5));
    expect(refused).toEqual({
      errorCode: 'BOOKING_WAITLIST_INVALID_REQUEST',
      field: BookingErrorCode.PartyTooLarge,
    });
    expect(refused).toEqual(
      WaitlistError.invalidRequest(BookingErrorCode.PartyTooLarge),
    );
  });
});
