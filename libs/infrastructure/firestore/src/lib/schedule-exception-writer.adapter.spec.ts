import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LocalTimeRange } from '@creativo/domain/scheduling';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { FirestoreScheduleExceptionWriter } from './schedule-exception-writer.adapter';

// Hoisted mocks, the invitation adapter spec's pattern: `doc()` is mocked
// too, since the real one refuses the plain `{}` standing in for Firestore.
const { getDocMock, setDocMock, batches } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  setDocMock: vi.fn(),
  batches: [] as {
    sets: [{ path: string }, Record<string, unknown>][];
    committed: boolean;
  }[],
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({
    id: segments[segments.length - 1],
    path: segments.join('/'),
  })),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: vi.fn(),
  writeBatch: () => {
    const batch = {
      sets: [] as [{ path: string }, Record<string, unknown>][],
      committed: false,
    };
    batches.push(batch);
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        batch.sets.push([ref, data]);
      },
      commit: () => {
        batch.committed = true;
        return Promise.resolve();
      },
    };
  },
}));

const ZONE = 'Europe/Sofia';

function range(from: string, to: string): LocalTimeRange {
  const result = LocalTimeRange.create(from, to);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/**
 * A stored day, as the collection holds it. The key must be a real day:
 * the parser is fail-closed, and a document it cannot read counts as none.
 */
function stored(effect: Record<string, unknown> | null) {
  return effect === null
    ? { exists: () => false, data: () => undefined }
    : {
        exists: () => true,
        data: () => ({
          barberId: 'ivan',
          dayKey: '2026-09-09',
          zone: ZONE,
          locationId: 'center',
          effect,
        }),
      };
}

describe('FirestoreScheduleExceptionWriter', () => {
  let writer: FirestoreScheduleExceptionWriter;

  beforeEach(() => {
    getDocMock.mockReset();
    setDocMock.mockReset();
    batches.length = 0;
    TestBed.configureTestingModule({
      providers: [
        FirestoreScheduleExceptionWriter,
        { provide: FIREBASE_FIRESTORE, useValue: {} },
      ],
    });
    writer = TestBed.inject(FirestoreScheduleExceptionWriter);
  });

  describe('putSeries', () => {
    it('merges the range into every day, reading in parallel and writing in ONE batch', async () => {
      getDocMock.mockImplementation((ref: { id: string }) =>
        Promise.resolve(
          ref.id === 'ivan__2026-09-10'
            ? stored({
                kind: 'blocked',
                ranges: [{ from: '09:00', to: '10:00' }],
              })
            : ref.id === 'ivan__2026-09-11'
              ? stored({ kind: 'closed' })
              : stored(null),
        ),
      );

      const result = await writer.putSeries(
        'ivan',
        'center',
        ['2026-09-09', '2026-09-10', '2026-09-11'],
        ZONE,
        [range('12:00', '13:00')],
      );

      expect(result.isSuccess()).toBe(true);
      expect(getDocMock).toHaveBeenCalledTimes(3);
      expect(setDocMock).not.toHaveBeenCalled();
      expect(batches).toHaveLength(1);
      const [batch] = batches;
      expect(batch?.committed).toBe(true);
      // The day already off whole is left alone — a range adds nothing to it.
      expect(batch?.sets.map(([ref]) => ref.path)).toEqual([
        'scheduleExceptions/ivan__2026-09-09',
        'scheduleExceptions/ivan__2026-09-10',
      ]);
      expect(batch?.sets[1]?.[1]['effect']).toEqual({
        kind: 'blocked',
        ranges: [
          { from: '09:00', to: '10:00' },
          { from: '12:00', to: '13:00' },
        ],
      });
    });

    it('stands whole days down without reading them — a day off replaces the day', async () => {
      const result = await writer.putSeries(
        'ivan',
        'center',
        ['2026-09-09', '2026-09-16'],
        ZONE,
        [],
      );

      expect(result.isSuccess()).toBe(true);
      expect(getDocMock).not.toHaveBeenCalled();
      expect(batches[0]?.sets.map(([, data]) => data['effect'])).toEqual([
        { kind: 'closed' },
        { kind: 'closed' },
      ]);
    });

    it("splits a long series at Firestore's 500 writes a batch", async () => {
      const days = Array.from({ length: 501 }, (_, index) =>
        new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      );

      const result = await writer.putSeries('ivan', 'center', days, ZONE, []);

      expect(result.isSuccess()).toBe(true);
      expect(batches.map((batch) => batch.sets.length)).toEqual([500, 1]);
      expect(batches.every((batch) => batch.committed)).toBe(true);
    });

    it('refuses a day that is not one, before anything is read or written', async () => {
      const result = await writer.putSeries(
        'ivan',
        'center',
        ['2026-09-09', '2026-02-30'],
        ZONE,
        [range('12:00', '13:00')],
      );

      expect(result.isFailure()).toBe(true);
      expect(getDocMock).not.toHaveBeenCalled();
      expect(batches).toHaveLength(0);
    });
  });

  describe('putRange', () => {
    it('still merges one range into the day it reads', async () => {
      getDocMock.mockResolvedValue(
        stored({ kind: 'blocked', ranges: [{ from: '12:30', to: '14:00' }] }),
      );

      const result = await writer.putRange(
        'ivan',
        'center',
        '2026-09-09',
        ZONE,
        range('12:00', '13:00'),
      );

      expect(result.isSuccess()).toBe(true);
      const [, data] = setDocMock.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      // Overlapping spans coalesce into one.
      expect(data['effect']).toEqual({
        kind: 'blocked',
        ranges: [{ from: '12:00', to: '14:00' }],
      });
    });

    it('leaves a whole day off alone', async () => {
      getDocMock.mockResolvedValue(stored({ kind: 'closed' }));

      const result = await writer.putRange(
        'ivan',
        'center',
        '2026-09-09',
        ZONE,
        range('12:00', '13:00'),
      );

      expect(result.isSuccess()).toBe(true);
      expect(setDocMock).not.toHaveBeenCalled();
    });
  });
});
