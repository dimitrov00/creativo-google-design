import { describe, expect, it } from 'vitest';
import { FocalPoint, MediaRef, MediaRefId } from './media-ref.data';

function validInput() {
  return {
    id: 'media_1',
    path: 'barbers/ivan/avatar.jpg',
    width: 800,
    height: 800,
    blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
    focalPoint: { x: 0.5, y: 0.4 },
  };
}

// catalog media-ref.spec.ts, on the stored struct.
describe('FocalPoint.parse', () => {
  it('accepts coordinates within 0..1', () => {
    expect(FocalPoint.parse(0, 1)).toEqual({ ok: true, value: { x: 0, y: 1 } });
  });

  it('rejects an out-of-range or non-finite coordinate', () => {
    expect(FocalPoint.parse(-0.1, 0.5)).toEqual({
      ok: false,
      error: {
        code: 'catalog.media_ref.focal_point_out_of_range',
        x: -0.1,
        y: 0.5,
      },
    });
    expect(FocalPoint.parse(0.5, 1.1).ok).toBe(false);
    expect(FocalPoint.parse(Number.NaN, 0.5).ok).toBe(false);
  });

  it('center() returns the normalised midpoint', () => {
    expect(FocalPoint.center()).toEqual({ x: 0.5, y: 0.5 });
  });

  it('equals() compares both axes', () => {
    expect(FocalPoint.equals(FocalPoint.center(), FocalPoint.center())).toBe(
      true,
    );
    expect(FocalPoint.equals(FocalPoint.center(), { x: 0.5, y: 0.4 })).toBe(
      false,
    );
  });
});

describe('MediaRef.parse', () => {
  it('accepts a fully valid ref', () => {
    expect(MediaRef.parse(validInput())).toEqual({
      ok: true,
      value: {
        id: MediaRefId.of('media_1'),
        path: 'barbers/ivan/avatar.jpg',
        width: 800,
        height: 800,
        blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
        focalPoint: { x: 0.5, y: 0.4 },
      },
    });
  });

  it('accepts an absent blurhash/focal point as null — every key present', () => {
    const result = MediaRef.parse({
      ...validInput(),
      blurhash: null,
      focalPoint: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blurhash).toBeNull();
      expect(result.value.focalPoint).toBeNull();
      expect(Object.keys(result.value)).toEqual([
        'id',
        'path',
        'width',
        'height',
        'blurhash',
        'focalPoint',
      ]);
    }
  });

  it('trims the path and turns a blank blurhash into null', () => {
    const result = MediaRef.parse({
      ...validInput(),
      path: '  a/b.jpg ',
      blurhash: '   ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe('a/b.jpg');
      expect(result.value.blurhash).toBeNull();
    }
  });

  it('rejects an empty id', () => {
    expect(MediaRef.parse({ ...validInput(), id: '' })).toEqual({
      ok: false,
      error: [{ code: 'catalog.id.empty', idType: 'MediaRefId' }],
    });
  });

  it('rejects an empty path', () => {
    expect(MediaRef.parse({ ...validInput(), path: '  ' })).toEqual({
      ok: false,
      error: [{ code: 'catalog.media_ref.empty_path' }],
    });
  });

  it('rejects a non-positive width or height', () => {
    expect(MediaRef.parse({ ...validInput(), width: 0 })).toEqual({
      ok: false,
      error: [
        {
          code: 'catalog.media_ref.invalid_dimension',
          dimension: 'width',
          rawValue: 0,
        },
      ],
    });
    expect(MediaRef.parse({ ...validInput(), height: -5 })).toEqual({
      ok: false,
      error: [
        {
          code: 'catalog.media_ref.invalid_dimension',
          dimension: 'height',
          rawValue: -5,
        },
      ],
    });
  });

  it('rejects a non-integer dimension', () => {
    expect(MediaRef.parse({ ...validInput(), width: 10.5 }).ok).toBe(false);
  });

  it('rejects an out-of-range focal point', () => {
    expect(
      MediaRef.parse({ ...validInput(), focalPoint: { x: 2, y: 0.5 } }),
    ).toEqual({
      ok: false,
      error: [
        { code: 'catalog.media_ref.focal_point_out_of_range', x: 2, y: 0.5 },
      ],
    });
  });

  it('collects every invalid field at once', () => {
    const result = MediaRef.parse({
      ...validInput(),
      id: '',
      width: 0,
      height: 0,
      focalPoint: { x: -1, y: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((e) => e.code)).toEqual([
        'catalog.id.empty',
        'catalog.media_ref.invalid_dimension',
        'catalog.media_ref.invalid_dimension',
        'catalog.media_ref.focal_point_out_of_range',
      ]);
    }
  });
});

describe('MediaRefId', () => {
  it('is nominal: a raw string is not a MediaRefId', () => {
    // @ts-expect-error — only MediaRefId.of (after MediaRef.parse) makes one
    const raw: MediaRefId = 'media_1';
    expect(raw).toBe(MediaRefId.of('media_1'));
  });
});
