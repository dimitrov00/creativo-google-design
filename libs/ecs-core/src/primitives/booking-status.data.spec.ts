import { describe, expect, it } from 'vitest';
import { BookingStatus, isBookingStatus } from './booking-status.data';

describe('isBookingStatus — the edge guard of the stored tag', () => {
  it('accepts every stored tag', () => {
    for (const status of Object.values(BookingStatus)) {
      expect(isBookingStatus(status)).toBe(true);
    }
  });

  it('rejects a legacy lower-case form, an unknown tag and non-strings', () => {
    expect(isBookingStatus('confirmed')).toBe(false);
    expect(isBookingStatus('no_show')).toBe(false);
    expect(isBookingStatus('ARRIVED')).toBe(false);
    expect(isBookingStatus('')).toBe(false);
    expect(isBookingStatus(null)).toBe(false);
    expect(isBookingStatus(undefined)).toBe(false);
    expect(isBookingStatus(3)).toBe(false);
    expect(isBookingStatus({ bookingStatus: 'CONFIRMED' })).toBe(false);
  });

  it('narrows to the dictionary type', () => {
    const raw: unknown = 'NO_SHOW';
    if (isBookingStatus(raw)) {
      const status: BookingStatus = raw;
      expect(status).toBe(BookingStatus.NoShow);
    } else {
      expect.unreachable('NO_SHOW is a stored tag');
    }
  });

  it('is pure: same input → same output', () => {
    expect(isBookingStatus('CANCELLED')).toBe(isBookingStatus('CANCELLED'));
    expect(isBookingStatus('nope')).toBe(isBookingStatus('nope'));
  });
});
