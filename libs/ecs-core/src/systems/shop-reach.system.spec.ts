import { describe, expect, it } from 'vitest';
import { ShopReach } from '../components/booking-flow.data';
import { E164 } from '../components/phone-number.data';
import { Latitude, Longitude } from '../primitives/geo.primitive';
import { LocationId } from '../primitives/ids.primitive';
import { deepFreeze, unwrapOk } from '../testing';
import { locationFixture } from '../testing/booking-core.fixtures';
import { ShopReachSystem } from './shop-reach.system';

/*
 * The reach rule of `shopReachKey` (booking-gateway.port.ts:232) and the
 * `tel:`/directions hrefs the booking, the review and the visit sheet build
 * from a shop: «call» only with a number to press, «get in touch» otherwise.
 * A whole `ShopLocation` passes in — its phone and coordinates are flat
 * root fields.
 */

const centre = locationFixture({
  phoneE164: E164.of('+35921234567'),
  phoneDisplay: '02 123 4567',
  latitude: unwrapOk(Latitude.of(42.6977)),
  longitude: unwrapOk(Longitude.of(23.3219)),
});
const shops = [centre];

describe('ShopReachSystem', () => {
  it('offers the call and the directions for a listed shop', () => {
    expect(ShopReachSystem.reach(shops, centre.id)).toEqual({
      callHref: 'tel:+35921234567',
      directionsHref:
        'https://www.google.com/maps/dir/?api=1&destination=42.6977,23.3219',
      reach: ShopReach.Call,
    });
  });

  it('says «get in touch» when the catalogue has no number for the shop', () => {
    expect(ShopReachSystem.reach(shops, LocationId.of('loc-gone'))).toEqual({
      callHref: null,
      directionsHref: null,
      reach: ShopReach.Contact,
    });
    expect(ShopReachSystem.reach([], null).reach).toBe('booking.reach.contact');
  });

  it('dials the canonical number, never the display string', () => {
    expect(ShopReachSystem.callHref(centre)).not.toContain(' ');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze([centre]);
    expect(ShopReachSystem.reach(frozen, centre.id)).toEqual(
      ShopReachSystem.reach(frozen, centre.id),
    );
    expect(frozen[0]?.phoneDisplay).toBe('02 123 4567');
  });
});
