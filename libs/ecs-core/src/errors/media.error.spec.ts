import { describe, expect, it } from 'vitest';
import { MediaError, MediaErrorCode } from './media.error';

// media-reader.errors.spec.ts, on plain structs.
describe('MediaError', () => {
  it.each([
    [MediaError.notFound, 'MEDIA_NOT_FOUND'],
    [MediaError.forbidden, 'MEDIA_FORBIDDEN'],
    [MediaError.transient, 'MEDIA_TRANSIENT'],
  ] as const)(
    'carries a stable errorCode per reason (%#) and the path',
    (build, errorCode) => {
      expect(build('services/fade.jpg')).toEqual({
        errorCode,
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

  it('is() narrows by errorCode', () => {
    const error: MediaError = MediaError.forbidden('a.jpg');
    expect(MediaError.is(error, MediaErrorCode.Forbidden)).toBe(true);
    expect(MediaError.is(error, MediaErrorCode.NotFound)).toBe(false);
  });
});
