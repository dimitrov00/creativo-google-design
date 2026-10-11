import { describe, expect, it } from 'vitest';
import { WaitlistError, WaitlistErrorCode } from './waitlist-errors.data';

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
});
