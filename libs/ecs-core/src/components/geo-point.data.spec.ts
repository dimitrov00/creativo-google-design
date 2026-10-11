import { describe, expect, it } from 'vitest';
import { unwrapOk } from '../testing';
import { Latitude, Longitude } from '../primitives/geo.primitive';
import { GeoPoint } from './geo-point.data';

const point = (latitude: number, longitude: number): GeoPoint => ({
  latitude: unwrapOk(Latitude.of(latitude)),
  longitude: unwrapOk(Longitude.of(longitude)),
});

// catalog location.spec.ts's geo cases, on the flat slice.
describe('GeoPoint.parse', () => {
  it('accepts a real position, the bounds included', () => {
    expect(GeoPoint.parse(42.6977, 23.3219)).toEqual({
      ok: true,
      value: { latitude: 42.6977, longitude: 23.3219 },
    });
    expect(GeoPoint.parse(-90, 180).ok).toBe(true);
    expect(GeoPoint.parse(90, -180).ok).toBe(true);
  });

  it('rejects a latitude outside −90..90', () => {
    expect(GeoPoint.parse(91, 0)).toEqual({
      ok: false,
      error: {
        errorCode: 'CATALOG_LOCATION_INVALID_GEO_COORDINATE',
        geoAxis: 'LAT',
        rawValue: 91,
      },
    });
    expect(GeoPoint.parse(-90.5, 0).ok).toBe(false);
  });

  it('rejects a longitude outside −180..180', () => {
    expect(GeoPoint.parse(0, 181)).toEqual({
      ok: false,
      error: {
        errorCode: 'CATALOG_LOCATION_INVALID_GEO_COORDINATE',
        geoAxis: 'LNG',
        rawValue: 181,
      },
    });
  });

  it('reports latitude first when both are bad, and rejects non-finite degrees', () => {
    const both = GeoPoint.parse(100, 200);
    expect(!both.ok && both.error).toEqual({
      errorCode: 'CATALOG_LOCATION_INVALID_GEO_COORDINATE',
      geoAxis: 'LAT',
      rawValue: 100,
    });
    expect(GeoPoint.parse(Number.NaN, 0).ok).toBe(false);
    expect(GeoPoint.parse(0, Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});

describe('GeoPoint.equals', () => {
  it('compares both coordinates', () => {
    expect(GeoPoint.equals(point(1, 2), point(1, 2))).toBe(true);
    expect(GeoPoint.equals(point(1, 2), point(1, 3))).toBe(false);
  });
});
