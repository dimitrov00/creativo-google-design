import { describe, expect, it } from 'vitest';
import { WaitlistError, WaitlistErrorCode } from './waitlist-errors.data';

describe('WaitlistError', () => {
  it('keeps every legacy booking.waitlist.* key verbatim', () => {
    expect(Object.values(WaitlistErrorCode).sort()).toEqual([
      'booking.waitlist.already_watching',
      'booking.waitlist.invalid_request',
      'booking.waitlist.too_many_days',
      'booking.waitlist.unauthenticated',
    ]);
  });

  it('builds one plain struct per code, its parameters beside it', () => {
    const errors: readonly WaitlistError[] = [
      WaitlistError.unauthenticated(),
      WaitlistError.invalidRequest('dayKey'),
      WaitlistError.tooManyDays(7),
      WaitlistError.alreadyWatching(),
    ];
    expect(errors.map((error) => error.code).sort()).toEqual(
      Object.values(WaitlistErrorCode).sort(),
    );
    expect(WaitlistError.invalidRequest('dayKey')).toEqual({
      code: 'booking.waitlist.invalid_request',
      field: 'dayKey',
    });
    expect(WaitlistError.tooManyDays(7)).toEqual({
      code: 'booking.waitlist.too_many_days',
      max: 7,
    });
  });
});
