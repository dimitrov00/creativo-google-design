import { describe, expect, it } from 'vitest';
import { unwrapErr } from '../testing';
import { Latitude, Longitude } from './geo.primitive';

describe('Latitude / Longitude — WGS-84 degrees (§1.6)', () => {
  it('take a finite value in range', () => {
    expect(Latitude.of(42.6977)).toEqual({ ok: true, value: 42.6977 });
    expect(Latitude.of(-90).ok).toBe(true);
    expect(Longitude.of(23.3219)).toEqual({ ok: true, value: 23.3219 });
    expect(Longitude.of(180).ok).toBe(true);
  });

  it('refuse anything outside, as flat PrimitiveErrors', () => {
    expect(unwrapErr(Latitude.of(90.1))).toEqual({
      errorCode: 'PRIMITIVE_LATITUDE_OUT_OF_RANGE',
      raw: 90.1,
      brand: 'Latitude',
    });
    expect(Latitude.of(Number.NaN).ok).toBe(false);
    expect(unwrapErr(Longitude.of(-180.5))).toEqual({
      errorCode: 'PRIMITIVE_LONGITUDE_OUT_OF_RANGE',
      raw: -180.5,
      brand: 'Longitude',
    });
    expect(Longitude.of(Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});
