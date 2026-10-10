import { ShopReach } from '../components/booking-flow.data';
import type { GeoPoint } from '../components/geo-point.data';
import type { LocationEntity, LocationId } from '../entities/location.entity';

/** What reaching a shop reads of it — a whole `LocationEntity` passes in. */
export type ReachableShop = Pick<LocationEntity, 'id' | 'phone' | 'geo'>;

/**
 * How a client reaches one shop from a refusal or a visit sheet: the number
 * to press (`tel:` on the canonical E.164 — the display string is
 * punctuated for reading, not for dialling), the directions to hand the
 * phone's navigator, and which "reach the shop" phrase the copy ends with.
 */
export type ShopReachLinks = {
  readonly callHref: string | null;
  readonly directionsHref: string | null;
  readonly reach: ShopReach;
};

const DIRECTIONS_BASE = 'https://www.google.com/maps/dir/?api=1&destination=';

/**
 * ShopReachSystem — the one way every surface sends a client to a shop
 * (`client-booking.ts:274-290`, `client-appointments.ts:567-588`,
 * `booking-review-step.ts:235-238`, `booking-gateway.port.ts:232`
 * `shopReachKey`): «call the shop» when there is a number to press, «get in
 * touch» when the catalogue has no number for it (a shop missing from the
 * active catalogue, or locations still loading). Strings for hrefs and an
 * i18n key, never worded copy.
 */
export const ShopReachSystem = {
  /** `tel:` for the shop's canonical number. */
  callHref(shop: ReachableShop): string {
    return `tel:${shop.phone.e164}`;
  },

  /** The universal Maps URL — iOS offers Apple Maps, everything else Google Maps. */
  directionsHref(geo: GeoPoint): string {
    return `${DIRECTIONS_BASE}${geo.lat},${geo.lng}`;
  },

  /**
   * The links for the shop `locationId` names among `shops`, linear scan;
   * `null` (not listed, nothing named) has no number to press and no
   * destination, so the copy says «get in touch».
   */
  reach(
    shops: readonly ReachableShop[],
    locationId: LocationId | null,
  ): ShopReachLinks {
    let shop: ReachableShop | null = null;
    if (locationId !== null) {
      for (let i = 0; i < shops.length; i++) {
        const candidate = shops[i] as ReachableShop;
        if (candidate.id === locationId) {
          shop = candidate;
          break;
        }
      }
    }
    const callHref = shop === null ? null : ShopReachSystem.callHref(shop);
    return {
      callHref,
      directionsHref:
        shop === null ? null : ShopReachSystem.directionsHref(shop.geo),
      reach: ShopReach.forCallHref(callHref),
    };
  },
} as const;
