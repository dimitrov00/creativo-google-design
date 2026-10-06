import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { GuestId, SeatKey, seatKeyValue } from '@creativo/domain/scheduling';
import {
  BookingGatewayError,
  isGuestKey,
  shopReachKey,
  wordError,
} from './booking-gateway.port';

/** A catalogue as a lookup: copy for the codes it knows, the code itself else. */
function catalogue(copy: Readonly<Record<string, string>>) {
  const known = new Map(Object.entries(copy));
  const asked: string[] = [];
  return {
    asked,
    translate: (code: string): string => {
      asked.push(code);
      return known.get(code) ?? code;
    },
  };
}

describe('wordError — the most specific words the catalogue has', () => {
  it('tries the server’s code one level deep, then the code, then the gateway’s own', () => {
    const words = catalogue({ 'booking.gateway.failed': 'generic' });
    const error = new BookingGatewayError('invalid_request', 'x', {
      serverCode: 'booking.commit.invalid_input',
      field: 'person_overlap',
    });

    expect(wordError(error, words.translate)).toBe('generic');
    expect(words.asked).toEqual([
      'booking.commit.invalid_input.person_overlap',
      'booking.commit.invalid_input',
      'booking.gateway.failed',
    ]);
  });

  it('stops at the first code with copy', () => {
    const words = catalogue({
      'booking.reschedule.carried_seat_unplaceable': 'carried',
      'booking.reschedule.carried_seat_unplaceable.shop_only': 'shop only',
    });
    const refused = (refusal: string) =>
      new BookingGatewayError('invalid_request', 'x', {
        serverCode: 'booking.reschedule.carried_seat_unplaceable',
        refusal,
      });

    expect(wordError(refused('shop_only'), words.translate)).toBe('shop only');
    // A reason the catalogue does not know yet is the code's own copy.
    expect(wordError(refused('newer'), words.translate)).toBe('carried');
  });

  it('words a server code that names no reason by itself — the retryable cancel', () => {
    const words = catalogue({
      'booking.cancel.policy_unavailable': 'try again in a moment',
      'booking.gateway.failed': 'generic',
    });
    const error = new BookingGatewayError('unavailable', 'x', {
      serverCode: 'booking.cancel.policy_unavailable',
    });

    expect(wordError(error, words.translate)).toBe('try again in a moment');
  });

  it('is the error’s own code when the server sent none', () => {
    const words = catalogue({ 'booking.gateway.failed': 'generic' });
    expect(
      wordError(new BookingGatewayError('unavailable', 'x'), words.translate),
    ).toBe('generic');
    expect(words.asked).toEqual(['booking.gateway.failed']);
  });
});

describe('shopReachKey — how a sentence sends the client to the shop', () => {
  it('says "call" only when the page has a call to place', () => {
    expect(shopReachKey('tel:+359888123456')).toBe('booking.reach.call');
    expect(shopReachKey(null)).toBe('booking.reach.contact');
  });
});

describe('isGuestKey — the guest key on the wire', () => {
  it('holds every key the cart mints for a guest (property)', () => {
    // The client sends `seatKeyValue` as `guestKey`; the server keeps only
    // what `isGuestKey` accepts. A key the cart can mint and the server
    // drops would switch the duplicate-guest refusal off for that party.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (sequence) =>
        isGuestKey(seatKeyValue(SeatKey.guest(GuestId.fromSequence(sequence)))),
      ),
    );
  });

  it('turns away anything that is not a bounded, id-shaped string', () => {
    expect(isGuestKey('guest-3')).toBe(true);
    expect(isGuestKey('')).toBe(false);
    expect(isGuestKey('guest 3')).toBe(false);
    expect(isGuestKey('guest/3')).toBe(false);
    expect(isGuestKey('g'.repeat(65))).toBe(false);
    expect(isGuestKey(3)).toBe(false);
    expect(isGuestKey(null)).toBe(false);
    expect(isGuestKey({ key: 'guest-3' })).toBe(false);
  });
});
