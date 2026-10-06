import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MediaRef } from '@creativo/domain/catalog';
import { MediaUnavailableError } from '@creativo/application/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_STORAGE } from './storage.provider';

const { refMock, getDownloadURLMock } = vi.hoisted(() => ({
  refMock: vi.fn(),
  getDownloadURLMock: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  getDownloadURL: getDownloadURLMock,
}));

import { StorageMediaReader } from './media-reader.adapter';

function makeMediaRef(): MediaRef {
  const result = MediaRef.create({
    id: 'media-1',
    path: 'catalog/barber-1.jpg',
    width: 800,
    height: 600,
  });
  if (result.isFailure()) throw new Error('unreachable');
  return result.value;
}

function createReader(): StorageMediaReader {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_STORAGE, useValue: {} },
      StorageMediaReader,
    ],
  });
  return TestBed.inject(StorageMediaReader);
}

describe('StorageMediaReader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a single variant at the ref’s native width', async () => {
    refMock.mockReturnValue({ path: 'catalog/barber-1.jpg' });
    getDownloadURLMock.mockResolvedValue('https://example.com/barber-1.jpg');

    const reader = createReader();
    const result = await reader.resolve(makeMediaRef());

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toEqual([
        { width: 800, url: 'https://example.com/barber-1.jpg' },
      ]);
    }
  });

  /** A `StorageError`-shaped rejection — the SDK is mocked, its class is not needed. */
  const storageError = (code: string) =>
    Object.assign(new Error(`Firebase Storage: ${code}`), { code });

  it.each([
    ['storage/object-not-found', 'not_found', 'catalog.media.not_found'],
    ['storage/unauthorized', 'forbidden', 'catalog.media.forbidden'],
  ] as const)(
    'maps %s to the permanent MediaUnavailableError (%s)',
    async (code, reason, domainCode) => {
      refMock.mockReturnValue({});
      const cause = storageError(code);
      getDownloadURLMock.mockRejectedValue(cause);

      const result = await createReader().resolve(makeMediaRef());

      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        const error = result.error;
        expect(error).toBeInstanceOf(MediaUnavailableError);
        if (error instanceof MediaUnavailableError) {
          expect(error.reason).toBe(reason);
          expect(error.code).toBe(domainCode);
          expect(error.path).toBe('catalog/barber-1.jpg');
          expect(error.cause).toBe(cause);
        }
      }
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
  ])(
    'keeps %s transient: a RepositoryError, never permanent',
    async (_label, cause) => {
      refMock.mockReturnValue({});
      getDownloadURLMock.mockRejectedValue(cause);

      const result = await createReader().resolve(makeMediaRef());

      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toBeInstanceOf(RepositoryError);
        expect(result.error).not.toBeInstanceOf(MediaUnavailableError);
        expect(result.error.cause).toBe(cause);
      }
    },
  );
});
