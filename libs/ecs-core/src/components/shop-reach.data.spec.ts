import { describe, expect, it } from 'vitest';
import { ShopReach } from './shop-reach.data';

describe('ShopReach — the shopReachKey values', () => {
  it('calls when there is a number to press, and says get in touch otherwise', () => {
    expect(ShopReach.forCallHref('tel:+359888000000')).toBe(
      'booking.reach.call',
    );
    expect(ShopReach.forCallHref(null)).toBe('booking.reach.contact');
    expect([ShopReach.Call, ShopReach.Contact]).toEqual([
      'booking.reach.call',
      'booking.reach.contact',
    ]);
  });
});
