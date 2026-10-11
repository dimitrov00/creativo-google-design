import { Latitude, Longitude } from '../primitives/geo.primitive';
import { CatalogError, GeoAxis } from './catalog-errors.data';
import { Result } from './result.data';

/**
 * A WGS 84 position — a flat SLICE (Law 6): `ShopLocation` intersects it, so
 * `latitude` and `longitude` sit at the location's root as the branded
 * coordinates of `primitives/geo.primitive.ts` (flatten-spec §1.6, §3.1;
 * was the nested `geo: { lat, lng }` map — the stored document keeps it until
 * the booking-core flip, and the shim converts).
 */
export type GeoPoint = {
  readonly latitude: Latitude;
  readonly longitude: Longitude;
};

export const GeoPoint = {
  /**
   * The edge guard: latitude in −90..90 and longitude in −180..180, both
   * finite — latitude checked first, the first bad axis reported as
   * `CATALOG_LOCATION_INVALID_GEO_COORDINATE` (the catalogue's refusal,
   * built on the primitives' own checks).
   */
  parse(latitude: number, longitude: number): Result<GeoPoint, CatalogError> {
    const lat = Latitude.of(latitude);
    if (!lat.ok) {
      return Result.err(
        CatalogError.locationInvalidGeoCoordinate(GeoAxis.Lat, latitude),
      );
    }
    const lng = Longitude.of(longitude);
    if (!lng.ok) {
      return Result.err(
        CatalogError.locationInvalidGeoCoordinate(GeoAxis.Lng, longitude),
      );
    }
    return Result.ok({ latitude: lat.value, longitude: lng.value });
  },

  equals(a: GeoPoint, b: GeoPoint): boolean {
    return a.latitude === b.latitude && a.longitude === b.longitude;
  },
} as const;
