import type { TimeZone } from '@core/primitives';
import type { ShopLocation } from '@core/entities';

/**
 * WHERE A ZONE COMES FROM (Law 7.2; flatten-spec F-4, Phase 4a 4A-11) — the
 * IANA zone is configuration of a shop location only, never a tenant
 * constant. The ONE rule, for the web and the server alike: a location in
 * scope → its `timeZone`; no location in scope (or one that names no
 * document) → the deployment's default location's. Pure: the boundary
 * (`resolveShopZone`) loads the two locations, this picks the zone.
 */
export const ShopZoneSystem = {
  /**
   * The named location's zone; else the fallback (the default location)'s;
   * `null` when neither is stored — each boundary answers that with its own
   * refusal (`ProgramsSystem.zoneOf`'s `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN`,
   * `resolveShopZone`'s `CATALOG_LOCATION_ZONE_UNKNOWN`).
   */
  zoneOf(
    named: ShopLocation | null,
    fallback: ShopLocation | null,
  ): TimeZone | null {
    if (named !== null) return named.timeZone;
    if (fallback !== null) return fallback.timeZone;
    return null;
  },
} as const;
