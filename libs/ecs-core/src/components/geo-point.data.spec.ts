import { describe, expect, it } from 'vitest';
import { GeoPoint } from './geo-point.data';

// catalog location.spec.ts's geo cases, on the component.
describe('GeoPoint.parse', () => {
  it('accepts a real position, the bounds included', () => {
    expect(GeoPoint.parse(42.6977, 23.3219)).toEqual({
      ok: true,
      value: { lat: 42.6977, lng: 23.3219 },
    });
    expect(GeoPoint.parse(-90, 180).ok).toBe(true);
    expect(GeoPoint.parse(90, -180).ok).toBe(true);
  });

  it('rejects a latitude outside −90..90', () => {
    expect(GeoPoint.parse(91, 0)).toEqual({
      ok: false,
      error: {
        code: 'catalog.location.invalid_geo_coordinate',
        axis: 'lat',
        rawValue: 91,
      },
    });
    expect(GeoPoint.parse(-90.5, 0).ok).toBe(false);
  });

  it('rejects a longitude outside −180..180', () => {
    expect(GeoPoint.parse(0, 181)).toEqual({
      ok: false,
      error: {
        code: 'catalog.location.invalid_geo_coordinate',
        axis: 'lng',
        rawValue: 181,
      },
    });
  });

  it('reports latitude first when both are bad, and rejects non-finite degrees', () => {
    const both = GeoPoint.parse(100, 200);
    expect(!both.ok && both.error).toEqual({
      code: 'catalog.location.invalid_geo_coordinate',
      axis: 'lat',
      rawValue: 100,
    });
    expect(GeoPoint.parse(Number.NaN, 0).ok).toBe(false);
    expect(GeoPoint.parse(0, Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});

describe('GeoPoint.equals', () => {
  it('compares both coordinates', () => {
    expect(GeoPoint.equals({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(true);
    expect(GeoPoint.equals({ lat: 1, lng: 2 }, { lat: 1, lng: 3 })).toBe(false);
  });
});
