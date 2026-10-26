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
   * `null` when neither is stored — the boundary answers that with its own
   * refusal (`resolveShopZone`'s `CATALOG_LOCATION_ZONE_UNKNOWN`). An event's
   * shop no longer falls back (OR-38): `ProgramsSystem.zoneOf` reads the one
   * shop it names.
   */
  zoneOf(
    named: ShopLocation | null,
    fallback: ShopLocation | null,
  ): TimeZone | null {
    if (named !== null) return named.timeZone;
    if (fallback !== null) return fallback.timeZone;
    return null;
  },

  /**
   * The named location's zone, else a zone already resolved
   * (`staff-day.store.ts` `writeBlocks`: the shop the block is written at,
   * else the page's own zone) — `null` when neither is known, which the
   * caller answers with its own refusal. The same named-first rule as
   * {@link zoneOf}, for a caller whose fallback is a zone rather than a
   * location.
   */
  zoneOr(
    named: ShopLocation | null,
    fallback: TimeZone | null,
  ): TimeZone | null {
    return named?.timeZone ?? fallback;
  },

  /**
   * A browser page's zone (`staff-day.store.ts` `zone`,
   * `booking-schedule-step.ts` `timeZone`): the chosen location's; under no
   * choice (or before the catalogue answers), the first listed location's —
   * every shop of the tenant keeps one clock; and the deployment's default
   * location's zone otherwise. `null` until one of them is known. Composes
   * {@link zoneOr}; the server's two-step {@link zoneOf} is unchanged.
   */
  zoneOfScope(
    named: ShopLocation | null,
    firstListed: ShopLocation | null,
    fallback: TimeZone | null,
  ): TimeZone | null {
    return ShopZoneSystem.zoneOr(
      named,
      ShopZoneSystem.zoneOr(firstListed, fallback),
    );
  },
} as const;
