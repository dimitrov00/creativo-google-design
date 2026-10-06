import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';

const { getDocsMock, whereMock, orderByMock, limitMock } = vi.hoisted(() => ({
  getDocsMock: vi.fn(),
  whereMock: vi.fn((...parts: unknown[]) => ({ where: parts })),
  orderByMock: vi.fn((...parts: unknown[]) => ({ orderBy: parts })),
  limitMock: vi.fn((max: number) => ({ limit: max })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ collection: name })),
  query: vi.fn((...parts: unknown[]) => parts),
  where: whereMock,
  orderBy: orderByMock,
  limit: limitMock,
  getDocs: getDocsMock,
}));

import { FirebaseClientPhotosReader } from './client-photos-reader.adapter';

function createReader(): FirebaseClientPhotosReader {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} },
      FirebaseClientPhotosReader,
    ],
  });
  return TestBed.inject(FirebaseClientPhotosReader);
}

/** A stored photo document, as the visit's own photos write it. */
function stored(
  photoId: string,
  appointmentId: string,
  takenAtIso: string,
  over: Record<string, unknown> = {},
) {
  return {
    id: photoId,
    data: () => ({
      appointmentId,
      barberId: 'ivan',
      clientUserId: 'georgi',
      clientLabel: 'Георги Петров',
      takenByUid: 'dev-staff-ivan',
      takenAtIso,
      path: `appointmentPhotos/${appointmentId}/${photoId}`,
      url: `https://example.test/${photoId}.jpg`,
      width: 1600,
      height: 1200,
      origin: 'shot',
      label: null,
      ...over,
    }),
  };
}

const snapshot = (docs: readonly ReturnType<typeof stored>[]) => ({ docs });

describe('FirebaseClientPhotosReader', () => {
  afterEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  describe('listForClient', () => {
    it('asks for the client’s newest photos, ordered so the limit keeps the newest', async () => {
      getDocsMock.mockResolvedValue(
        snapshot([
          stored('p3', 'a-05', '2026-09-28T07:55:00.000Z'),
          stored('p2', 'a-03', '2026-08-05T08:05:00.000Z'),
        ]),
      );
      const result = await createReader().listForClient('georgi', { limit: 6 });

      expect(whereMock).toHaveBeenCalledWith('clientUserId', '==', 'georgi');
      expect(orderByMock).toHaveBeenCalledWith('takenAtIso', 'desc');
      expect(limitMock).toHaveBeenCalledWith(6);
      // `origin` never goes into the query: a legacy document has none.
      expect(whereMock).not.toHaveBeenCalledWith(
        'origin',
        expect.anything(),
        expect.anything(),
      );
      expect(result.isSuccess() && result.value.map((p) => p.photoId)).toEqual([
        'p3',
        'p2',
      ]);
    });

    it('sets the shop’s own pictures and unreadable documents aside, keeps a legacy shot', async () => {
      getDocsMock.mockResolvedValue(
        snapshot([
          stored('cover', 'a-05', '2026-09-28T08:00:00.000Z', {
            origin: 'library',
            label: 'Корица: Фейд',
          }),
          stored('broken', 'a-04', '2026-09-02T08:00:00.000Z', { url: 7 }),
          stored('legacy', 'a-01', '2026-06-02T08:00:00.000Z', {
            origin: undefined,
          }),
        ]),
      );
      const result = await createReader().listForClient('georgi', { limit: 6 });
      expect(result.isSuccess() && result.value.map((p) => p.photoId)).toEqual([
        'legacy',
      ]);
    });

    it('reads nothing for no client or no room', async () => {
      const reader = createReader();
      const blank = await reader.listForClient(' ', { limit: 6 });
      const none = await reader.listForClient('georgi', { limit: 0 });
      expect(blank.isSuccess() && blank.value).toEqual([]);
      expect(none.isSuccess() && none.value).toEqual([]);
      expect(getDocsMock).not.toHaveBeenCalled();
    });

    it('answers a failed read with a failed Result', async () => {
      getDocsMock.mockRejectedValue(new Error('permission-denied'));
      const result = await createReader().listForClient('georgi', { limit: 6 });
      expect(result.isFailure() && result.error.message).toBe(
        "Failed to read the client's photos",
      );
    });
  });

  describe('countByAppointment', () => {
    it('counts each visit’s own photos, every asked id a key', async () => {
      getDocsMock.mockResolvedValue(
        snapshot([
          stored('p1', 'a-03', '2026-08-05T08:00:00.000Z'),
          stored('p2', 'a-03', '2026-08-05T08:05:00.000Z'),
          stored('cover', 'a-05', '2026-09-28T08:00:00.000Z', {
            origin: 'library',
          }),
        ]),
      );
      const result = await createReader().countByAppointment([
        'a-03',
        'a-05',
        'a-07',
      ]);
      expect(whereMock).toHaveBeenCalledWith('appointmentId', 'in', [
        'a-03',
        'a-05',
        'a-07',
      ]);
      expect(result.isSuccess() && [...result.value]).toEqual([
        ['a-03', 2],
        ['a-05', 0],
        ['a-07', 0],
      ]);
    });

    it('asks thirty ids at a time — Firestore’s cap on one `in`', async () => {
      getDocsMock.mockResolvedValue(snapshot([]));
      const ids = Array.from({ length: 65 }, (_, i) => `a-${i}`);
      const result = await createReader().countByAppointment(ids);
      expect(getDocsMock).toHaveBeenCalledTimes(3);
      const sizes = whereMock.mock.calls.map(
        (call) => (call[2] as readonly string[]).length,
      );
      expect(sizes).toEqual([30, 30, 5]);
      expect(result.isSuccess() && result.value.size).toBe(65);
    });

    it('reads nothing for no ids, and asks for an id once however often it is listed', async () => {
      getDocsMock.mockResolvedValue(snapshot([]));
      const reader = createReader();
      const none = await reader.countByAppointment([]);
      expect(none.isSuccess() && none.value.size).toBe(0);
      expect(getDocsMock).not.toHaveBeenCalled();
      await reader.countByAppointment(['a-1', 'a-1', 'a-2']);
      expect(whereMock).toHaveBeenCalledWith('appointmentId', 'in', [
        'a-1',
        'a-2',
      ]);
    });

    it('answers a failed read with a failed Result', async () => {
      getDocsMock.mockRejectedValue(new Error('unavailable'));
      const result = await createReader().countByAppointment(['a-1']);
      expect(result.isFailure() && result.error.message).toBe(
        'Failed to count visit photos',
      );
    });
  });
});
