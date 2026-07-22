import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MediaRef } from '@creativo/domain/catalog';
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

  it('maps a Storage failure into a fail Result', async () => {
    refMock.mockReturnValue({});
    getDownloadURLMock.mockRejectedValue(new Error('object-not-found'));

    const reader = createReader();
    const result = await reader.resolve(makeMediaRef());

    expect(result.isFailure()).toBe(true);
  });
});
