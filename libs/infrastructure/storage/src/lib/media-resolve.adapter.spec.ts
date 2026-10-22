import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseStorage } from 'firebase/storage';
import { MediaRef } from '@core/components';
import { MediaError } from '@core/primitives';
import { unwrapErr, unwrapOk } from '@core/testing';

const { refMock, getDownloadURLMock } = vi.hoisted(() => ({
  refMock: vi.fn(),
  getDownloadURLMock: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  getDownloadURL: getDownloadURLMock,
}));

const { mediaResolvePorts } = await import('./media-resolve.adapter');

const STORAGE = { app: 'storage' } as unknown as FirebaseStorage;
const PATH = 'catalog/barber-1.jpg';

/** The ref the content service's `MediaRef.parse` guard hands over. */
const MEDIA: MediaRef = unwrapOk(
  MediaRef.parse({
    mediaId: 'media-1',
    mediaPath: PATH,
    mediaWidth: 800,
    mediaHeight: 600,
    mediaBlurhash: null,
    mediaFocalX: null,
    mediaFocalY: null,
  }),
);

describe('mediaResolvePorts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a single rendition at the ref’s native width, by its path', async () => {
    refMock.mockReturnValue({ path: PATH });
    getDownloadURLMock.mockResolvedValue('https://example.com/barber-1.jpg');

    const result = await mediaResolvePorts(STORAGE).resolveMedia(MEDIA);

    expect(unwrapOk(result)).toEqual([
      { width: 800, url: 'https://example.com/barber-1.jpg' },
    ]);
    expect(refMock).toHaveBeenCalledWith(STORAGE, PATH);
  });

  /** A `StorageError`-shaped rejection — the SDK is mocked, its class is not needed. */
  const storageError = (code: string) =>
    Object.assign(new Error(`Firebase Storage: ${code}`), { code });

  it.each([
    ['storage/object-not-found', MediaError.notFound(PATH)],
    ['storage/unauthorized', MediaError.forbidden(PATH)],
  ] as const)(
    'maps %s to the permanent MediaError — the placeholder, never asked again',
    async (code, expected) => {
      refMock.mockReturnValue({});
      getDownloadURLMock.mockRejectedValue(storageError(code));

      const failure = unwrapErr(
        await mediaResolvePorts(STORAGE).resolveMedia(MEDIA),
      );

      expect(failure).toEqual(expected);
      expect(MediaError.isPermanent(failure)).toBe(true);
    },
  );

  it.each<[string, unknown]>([
    [
      'the SDK’s network retries running out',
      storageError('storage/retry-limit-exceeded'),
    ],
    ['an exhausted quota', storageError('storage/quota-exceeded')],
    [
      'a signed-out read (it may succeed after sign-in)',
      storageError('storage/unauthenticated'),
    ],
    ['an unknown Storage error', storageError('storage/unknown')],
    ['an error with no code', new Error('socket hang up')],
    ['a non-error rejection', 'offline'],
    ['a non-string code', { code: 404 }],
  ])('keeps %s transient: worth a bounded retry', async (_label, cause) => {
    refMock.mockReturnValue({});
    getDownloadURLMock.mockRejectedValue(cause);

    const failure = unwrapErr(
      await mediaResolvePorts(STORAGE).resolveMedia(MEDIA),
    );

    expect(failure).toEqual(MediaError.transient(PATH));
    expect(MediaError.isPermanent(failure)).toBe(false);
  });
});
