import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';

const { getDocMock, docMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  docMock: vi.fn((_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })),
}));

vi.mock('firebase/firestore', () => ({ doc: docMock, getDoc: getDocMock }));

import { FirestoreClientStatsReader } from './client-stats-reader.adapter';

function createReader(): FirestoreClientStatsReader {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} },
      FirestoreClientStatsReader,
    ],
  });
  return TestBed.inject(FirestoreClientStatsReader);
}

const STORED = {
  userId: 'ana',
  lifetime: {
    visitsCompleted: 4,
    noShows: 1,
    lateCancels: 0,
    clientCancels: 1,
  },
  last365: {
    visitsCompleted: [{ appointmentId: 'a4', at: '2026-09-01T07:00:00.000Z' }],
    noShows: [],
    lateCancels: [],
  },
  firstVisitAt: '2025-11-01T08:00:00.000Z',
  lastVisit: null,
  nextVisit: null,
  avgCadenceDays: 29.3,
  preferredBarberId: null,
  usualServiceIds: ['cut'],
  pauseSuggestion: null,
  version: 3,
  updatedAt: '2026-09-01T08:00:00.000Z',
};

describe('FirestoreClientStatsReader', () => {
  beforeEach(() => {
    getDocMock.mockReset();
    docMock.mockClear();
  });

  it('reads clientStats/{uid} once and parses it through the port mapper', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => STORED });
    const result = await createReader().get('ana');

    expect(docMock).toHaveBeenCalledWith({}, 'clientStats', 'ana');
    expect(result.isSuccess()).toBe(true);
    if (result.isFailure()) return;
    expect(result.value?.lifetime.visitsCompleted).toBe(4);
    expect(result.value?.version).toBe(3);
    expect(result.value?.usualServiceIds.map((id) => id.value)).toEqual([
      'cut',
    ]);
  });

  it('answers null for a client with no stats yet', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const result = await createReader().get('ana');
    expect(result.isSuccess() && result.value === null).toBe(true);
  });

  it('never reads for a blank id', async () => {
    const result = await createReader().get('  ');
    expect(getDocMock).not.toHaveBeenCalled();
    expect(result.isSuccess() && result.value === null).toBe(true);
  });

  it('turns a refused read into a failed Result', async () => {
    getDocMock.mockRejectedValue(new Error('permission-denied'));
    const result = await createReader().get('ana');
    expect(result.isFailure()).toBe(true);
  });

  it('reads the spend from the restricted sub-document', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        userId: 'ana',
        lifetimeSpendMinor: 12_000,
        currencyCode: 'EUR',
        version: 3,
        updatedAt: '2026-09-01T08:00:00.000Z',
      }),
    });
    const result = await createReader().getMoney('ana');

    expect(docMock).toHaveBeenCalledWith(
      {},
      'clientStats',
      'ana',
      'restricted',
      'money',
    );
    expect(result.isSuccess() && result.value?.lifetimeSpendMinor).toBe(12_000);
  });
});
