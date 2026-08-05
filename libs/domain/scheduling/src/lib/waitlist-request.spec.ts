import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import {
  WaitlistRequest,
  type WaitlistRequestProps,
  type WaitlistStatus,
} from './waitlist-request';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const day = (key: string) => unwrap(CalendarDay.create(key, ZONE));

const VALID: WaitlistRequestProps = {
  id: 'wl-1',
  ownerId: 'user-1',
  locationId: 'loc-center',
  when: {
    days: [
      { dayKey: '2026-08-25', windows: [] },
      {
        dayKey: '2026-08-26',
        windows: [
          { from: '08:00', to: '12:00' },
          { from: '15:00', to: '16:30' },
        ],
      },
    ],
  },
  cart: {
    seats: [
      {
        seatKey: 'self',
        lines: [
          {
            id: 'line-0',
            serviceId: 'svc-fade',
            variantId: null,
            barberId: null,
          },
        ],
      },
    ],
    nextSequence: 1,
  },
  status: 'open',
  createdAtIso: '2026-08-03T10:00:00.000+03:00',
  zone: ZONE,
};

const build = (overrides: Partial<WaitlistRequestProps> = {}) =>
  WaitlistRequest.create({ ...VALID, ...overrides });

describe('WaitlistRequest', () => {
  it('carries the declaration and the bag', () => {
    const request = unwrap(build());
    expect(request.when.dayCount).toBe(2);
    expect(request.when.for(day('2026-08-26'))?.windows.map(String)).toEqual([
      '08:00–12:00',
      '15:00–16:30',
    ]);
    expect(request.cart.seats[0]?.lines).toHaveLength(1);
  });

  it('accepts "any shop"', () => {
    expect(unwrap(build({ locationId: null })).locationId).toBeNull();
  });

  // The one place in the flow where signing in is the thing being bought,
  // not a formality at the end: there is nobody to notify without an account.
  it('REFUSES an unowned request', () => {
    const result = build({ ownerId: '' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('scheduling.waitlist.invalid');
    }
  });

  it('refuses a request that names no days', () => {
    const result = build({ when: { days: [] } });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('scheduling.waitlist.no_days');
    }
  });

  it('refuses a request with nothing in the bag', () => {
    const result = build({ cart: { seats: [], nextSequence: 0 } });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('scheduling.waitlist.empty_cart');
    }
  });

  it('round-trips through props', () => {
    expect(unwrap(build()).toProps()).toEqual(VALID);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  it('goes open → matched → booked', () => {
    const matched = unwrap(unwrap(build()).markMatched());
    expect(matched.status).toBe('matched');
    expect(unwrap(matched.markBooked()).status).toBe('booked');
  });

  // The edge that matters most: being notified is not the same as having
  // acted, and a graph without it drops people for being asleep.
  it('reopens a match that went unclaimed', () => {
    const matched = unwrap(unwrap(build()).markMatched());
    expect(unwrap(matched.reopen()).status).toBe('open');
  });

  it('refuses to leave a terminal state', () => {
    for (const terminal of ['booked', 'cancelled', 'expired'] as const) {
      const request = unwrap(build({ status: terminal }));
      const result = request.markMatched();
      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error.code).toBe(
          'scheduling.waitlist.invalid_transition',
        );
        expect(result.error.params).toMatchObject({
          from: terminal,
          to: 'matched',
        });
      }
    }
  });

  it('only watches while open or matched', () => {
    const watching: readonly WaitlistStatus[] = ['open', 'matched'];
    for (const status of [
      'open',
      'matched',
      'booked',
      'cancelled',
      'expired',
    ] as const) {
      expect(unwrap(build({ status })).isWatching()).toBe(
        watching.includes(status),
      );
    }
  });

  // ── Expiry ────────────────────────────────────────────────────────────

  it('lapses once every day it named is behind us', () => {
    const request = unwrap(build());
    expect(request.lastDay()?.key()).toBe('2026-08-26');
    expect(request.hasLapsedBy(day('2026-08-26'))).toBe(false);
    expect(request.hasLapsedBy(day('2026-08-27'))).toBe(true);
  });

  it('is still live on the last day itself', () => {
    // A request for today has all of today left to be fulfilled.
    expect(unwrap(build()).hasLapsedBy(day('2026-08-25'))).toBe(false);
  });
});
