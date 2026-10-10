import { CatalogError, GeoAxis } from './catalog-errors.data';
import { Result } from './result.data';

/**
 * A WGS 84 position in decimal degrees — `Location.geo`, stored as the plain
 * `{ lat, lng }` map (`location.ts:42-45`'s `LocationGeo`, now its own
 * component).
 */
export type GeoPoint = {
  readonly lat: number;
  readonly lng: number;
};

export const GeoPoint = {
  /**
   * The edge guard: latitude in −90..90 and longitude in −180..180, both
   * finite — latitude checked first, the first bad axis reported as
   * `catalog.location.invalid_geo_coordinate`.
   */
  parse(lat: number, lng: number): Result<GeoPoint, CatalogError> {
    if (!inRange(lat, 90)) {
      return Result.err(
        CatalogError.locationInvalidGeoCoordinate(GeoAxis.Lat, lat),
      );
    }
    if (!inRange(lng, 180)) {
      return Result.err(
        CatalogError.locationInvalidGeoCoordinate(GeoAxis.Lng, lng),
      );
    }
    return Result.ok({ lat, lng });
  },

  equals(a: GeoPoint, b: GeoPoint): boolean {
    return a.lat === b.lat && a.lng === b.lng;
  },
} as const;

function inRange(degrees: number, bound: number): boolean {
  return Number.isFinite(degrees) && degrees >= -bound && degrees <= bound;
}
