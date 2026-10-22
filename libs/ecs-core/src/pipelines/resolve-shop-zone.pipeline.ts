import {
  CatalogError,
  type LocationId,
  type RepositoryError,
  Result,
  type TimeZone,
} from '@core/primitives';
import type { DefaultLocationPorts, LocationLoadPorts } from '@core/ports';
import { ShopZoneSystem } from '@core/systems';

export type ResolveShopZonePorts = LocationLoadPorts & DefaultLocationPorts;

/**
 * WHICH ZONE A BOUNDARY'S WALL CLOCK IS ON (Law 7.2; flatten-spec F-4,
 * Phase 4a 4A-11) — browser and server alike. A location in scope → its
 * `timeZone`; none named, or one that names no document → the
 * deployment's default location's (`DefaultLocationPorts`). The rule is
 * `ShopZoneSystem.zoneOf`; this is its impure read. Neither stored →
 * `CATALOG_LOCATION_ZONE_UNKNOWN` naming the location last asked for; a
 * read that fails → its own `RepositoryError` (each boundary answers both
 * with its existing store-failure outcome, 4A-2 (e)).
 */
export const resolveShopZone =
  (ports: ResolveShopZonePorts) =>
  async (
    locationId: LocationId | null,
  ): Promise<
    Result<TimeZone, RepositoryError | CatalogError.LocationZoneUnknown>
  > => {
    if (locationId !== null) {
      const named = await ports.loadLocation(locationId);
      if (!named.ok) return named;
      if (named.value !== null) {
        const zone = ShopZoneSystem.zoneOf(named.value, null);
        if (zone !== null) return Result.ok(zone);
      }
    }
    const fallback = await ports.loadLocation(ports.defaultLocationId);
    if (!fallback.ok) return fallback;
    const zone = ShopZoneSystem.zoneOf(null, fallback.value);
    return zone === null
      ? Result.err(CatalogError.locationZoneUnknown(ports.defaultLocationId))
      : Result.ok(zone);
  };
