import { describe, expect, it } from 'vitest';
import { MediaError, MediaErrorCode } from './media-errors.data';

// media-reader.errors.spec.ts, on plain structs.
describe('MediaError', () => {
  it.each([
    [MediaError.notFound, 'media.not_found'],
    [MediaError.forbidden, 'media.forbidden'],
    [MediaError.transient, 'media.transient'],
  ] as const)(
    'carries a stable code per reason (%#) and the path',
    (build, code) => {
      expect(build('services/fade.jpg')).toEqual({
        code,
        path: 'services/fade.jpg',
      });
    },
  );

  it('separates the permanent answers from the one worth a retry', () => {
    expect(MediaError.isPermanent(MediaError.notFound('a.jpg'))).toBe(true);
    expect(MediaError.isPermanent(MediaError.forbidden('a.jpg'))).toBe(true);
    // A transient failure must never pass as permanent.
    expect(MediaError.isPermanent(MediaError.transient('a.jpg'))).toBe(false);
  });

  it('is() narrows by code', () => {
    const error: MediaError = MediaError.forbidden('a.jpg');
    expect(MediaError.is(error, MediaErrorCode.Forbidden)).toBe(true);
    expect(MediaError.is(error, MediaErrorCode.NotFound)).toBe(false);
  });
});
