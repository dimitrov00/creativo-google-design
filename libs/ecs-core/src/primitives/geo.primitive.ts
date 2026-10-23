import { Result } from './result.data';
import type { Brand } from './brand';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';

/**
 * A WGS-84 latitude in degrees, `[-90, 90]` — a coordinate of a shop on the
 * map, never a time.
 */
export type Latitude = Brand<number, 'Latitude'>;

/** A WGS-84 longitude in degrees, `[-180, 180]`. */
export type Longitude = Brand<number, 'Longitude'>;

export const Latitude = {
  /** The smart constructor: finite, `-90 ≤ raw ≤ 90`. */
  of(raw: number): Result<Latitude, PrimitiveError> {
    return Number.isFinite(raw) && raw >= -90 && raw <= 90
      ? Result.ok(raw as Latitude)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.LatitudeOutOfRange,
            raw,
            'Latitude',
          ),
        );
  },
} as const;

export const Longitude = {
  /** The smart constructor: finite, `-180 ≤ raw ≤ 180`. */
  of(raw: number): Result<Longitude, PrimitiveError> {
    return Number.isFinite(raw) && raw >= -180 && raw <= 180
      ? Result.ok(raw as Longitude)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.LongitudeOutOfRange,
            raw,
            'Longitude',
          ),
        );
  },
} as const;
