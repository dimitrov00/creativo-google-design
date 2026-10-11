import { describe, expect, it } from 'vitest';
import { MediaRefId } from '../primitives/ids.primitive';
import { MediaRef, type MediaRefInput } from './media-ref.data';

function validInput(): MediaRefInput {
  return {
    mediaId: 'media_1',
    mediaPath: 'barbers/ivan/avatar.jpg',
    mediaWidth: 800,
    mediaHeight: 800,
    mediaBlurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
    mediaFocalX: 0.5,
    mediaFocalY: 0.4,
  };
}

// catalog media-ref.spec.ts, on the flat struct (the focal point folded in).
describe('MediaRef.parseFocus', () => {
  it('accepts coordinates within 0..1', () => {
    expect(MediaRef.parseFocus(0, 1)).toEqual({
      ok: true,
      value: { mediaFocalX: 0, mediaFocalY: 1 },
    });
  });

  it('rejects an out-of-range or non-finite coordinate', () => {
    expect(MediaRef.parseFocus(-0.1, 0.5)).toEqual({
      ok: false,
      error: {
        errorCode: 'CATALOG_MEDIA_REF_FOCAL_POINT_OUT_OF_RANGE',
        x: -0.1,
        y: 0.5,
      },
    });
    expect(MediaRef.parseFocus(0.5, 1.1).ok).toBe(false);
    expect(MediaRef.parseFocus(Number.NaN, 0.5).ok).toBe(false);
  });

  it('centerFocus() returns the normalised midpoint', () => {
    expect(MediaRef.centerFocus()).toEqual({
      mediaFocalX: 0.5,
      mediaFocalY: 0.5,
    });
  });

  it('sameFocus() compares both axes', () => {
    expect(
      MediaRef.sameFocus(MediaRef.centerFocus(), MediaRef.centerFocus()),
    ).toBe(true);
    expect(
      MediaRef.sameFocus(MediaRef.centerFocus(), {
        mediaFocalX: 0.5,
        mediaFocalY: 0.4,
      }),
    ).toBe(false);
  });
});

describe('MediaRef.parse', () => {
  it('accepts a fully valid ref', () => {
    expect(MediaRef.parse(validInput())).toEqual({
      ok: true,
      value: {
        mediaId: MediaRefId.of('media_1'),
        mediaPath: 'barbers/ivan/avatar.jpg',
        mediaWidth: 800,
        mediaHeight: 800,
        mediaBlurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
        mediaFocalX: 0.5,
        mediaFocalY: 0.4,
      },
    });
  });

  it('accepts an absent blurhash/focal point as null — every key present', () => {
    const result = MediaRef.parse({
      ...validInput(),
      mediaBlurhash: null,
      mediaFocalX: null,
      mediaFocalY: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mediaBlurhash).toBeNull();
      expect(result.value.mediaFocalX).toBeNull();
      expect(result.value.mediaFocalY).toBeNull();
      expect(Object.keys(result.value)).toEqual([
        'mediaId',
        'mediaPath',
        'mediaWidth',
        'mediaHeight',
        'mediaBlurhash',
        'mediaFocalX',
        'mediaFocalY',
      ]);
    }
  });

  it('trims the path and turns a blank blurhash into null', () => {
    const result = MediaRef.parse({
      ...validInput(),
      mediaPath: '  a/b.jpg ',
      mediaBlurhash: '   ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mediaPath).toBe('a/b.jpg');
      expect(result.value.mediaBlurhash).toBeNull();
    }
  });

  it('rejects an empty id', () => {
    expect(MediaRef.parse({ ...validInput(), mediaId: '' })).toEqual({
      ok: false,
      error: [{ errorCode: 'CATALOG_ID_EMPTY', idType: 'MediaRefId' }],
    });
  });

  it('rejects an empty path', () => {
    expect(MediaRef.parse({ ...validInput(), mediaPath: '  ' })).toEqual({
      ok: false,
      error: [{ errorCode: 'CATALOG_MEDIA_REF_EMPTY_PATH' }],
    });
  });

  it('rejects a non-positive width or height', () => {
    expect(MediaRef.parse({ ...validInput(), mediaWidth: 0 })).toEqual({
      ok: false,
      error: [
        {
          errorCode: 'CATALOG_MEDIA_REF_INVALID_DIMENSION',
          mediaDimension: 'WIDTH',
          rawValue: 0,
        },
      ],
    });
    expect(MediaRef.parse({ ...validInput(), mediaHeight: -5 })).toEqual({
      ok: false,
      error: [
        {
          errorCode: 'CATALOG_MEDIA_REF_INVALID_DIMENSION',
          mediaDimension: 'HEIGHT',
          rawValue: -5,
        },
      ],
    });
  });

  it('rejects a non-integer dimension', () => {
    expect(MediaRef.parse({ ...validInput(), mediaWidth: 10.5 }).ok).toBe(
      false,
    );
  });

  it('rejects an out-of-range focal point — and half of one', () => {
    expect(MediaRef.parse({ ...validInput(), mediaFocalX: 2 })).toEqual({
      ok: false,
      error: [
        {
          errorCode: 'CATALOG_MEDIA_REF_FOCAL_POINT_OUT_OF_RANGE',
          x: 2,
          y: 0.4,
        },
      ],
    });
    expect(MediaRef.parse({ ...validInput(), mediaFocalY: null }).ok).toBe(
      false,
    );
  });

  it('collects every invalid field at once', () => {
    const result = MediaRef.parse({
      ...validInput(),
      mediaId: '',
      mediaWidth: 0,
      mediaHeight: 0,
      mediaFocalX: -1,
      mediaFocalY: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((e) => e.errorCode)).toEqual([
        'CATALOG_ID_EMPTY',
        'CATALOG_MEDIA_REF_INVALID_DIMENSION',
        'CATALOG_MEDIA_REF_INVALID_DIMENSION',
        'CATALOG_MEDIA_REF_FOCAL_POINT_OUT_OF_RANGE',
      ]);
    }
  });
});

describe('MediaRefId', () => {
  it('is nominal: a raw string is not a MediaRefId', () => {
    // @ts-expect-error — only MediaRefId.of / parse (after MediaRef.parse) makes one
    const raw: MediaRefId = 'media_1';
    expect(raw).toBe(MediaRefId.of('media_1'));
  });
});
