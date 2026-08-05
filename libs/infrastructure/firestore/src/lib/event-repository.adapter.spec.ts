import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { ShopEvent } from '@creativo/domain/programs';
import { CLOCK, ClockPort } from '@creativo/application/shared';

type FakeDocRef = { __type: 'doc'; path: string };
type FakeCollectionRef = { __type: 'collection'; path: string };
type FakeQuery = {
  __type: 'query';
  collectionRef: FakeCollectionRef;
  constraints: unknown[];
};

const store = new Map<string, Record<string, unknown>>();
let lastOnSnapshotArgs: {
  query: FakeQuery;
  onNext: (snapshot: {
    docs: { id: string; data: () => Record<string, unknown> }[];
  }) => void;
  onError: (error: unknown) => void;
} | null = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(
    (_db: unknown, ...segments: string[]): FakeCollectionRef => ({
      __type: 'collection',
      path: segments.join('/'),
    }),
  ),
  doc: vi.fn((_db: unknown, ...segments: string[]): FakeDocRef => ({
    __type: 'doc',
    path: segments.join('/'),
  })),
  getDoc: vi.fn(async (ref: FakeDocRef) => {
    const data = store.get(ref.path);
    return {
      exists: () => data !== undefined,
      data: () => data,
      id: ref.path.split('/').pop() as string,
    };
  }),
  setDoc: vi.fn(async (ref: FakeDocRef, data: Record<string, unknown>) => {
    store.set(ref.path, data);
  }),
  query: vi.fn(
    (
      collectionRef: FakeCollectionRef,
      ...constraints: unknown[]
    ): FakeQuery => ({
      __type: 'query',
      collectionRef,
      constraints,
    }),
  ),
  where: vi.fn((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  })),
  orderBy: vi.fn((field: string, direction?: string) => ({ field, direction })),
  limit: vi.fn((count: number) => ({ limit: count })),
  onSnapshot: vi.fn(
    (
      q: FakeQuery,
      onNext: (snapshot: {
        docs: { id: string; data: () => Record<string, unknown> }[];
      }) => void,
      onError: (error: unknown) => void,
    ) => {
      lastOnSnapshotArgs = { query: q, onNext, onError };
      return () => {
        lastOnSnapshotArgs = null;
      };
    },
  ),
}));

// Imported AFTER the mock so the adapter picks up the mocked module.
const { FirestoreEventRepository } = await import('./event-repository.adapter');

function fakeClock(iso: string): ClockPort {
  return {
    now: (zone: string): Result<ZonedDateTime, InvalidTimeZoneError> => {
      const result = ZonedDateTime.fromISO(iso, zone);
      return result.isFailure()
        ? fail(new InvalidTimeZoneError(zone))
        : ok(result.value);
    },
  };
}

function createRepo(db: Firestore = {} as Firestore) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      { provide: CLOCK, useValue: fakeClock('2026-01-01T00:00:00') },
      FirestoreEventRepository,
    ],
  });
  return TestBed.inject(FirestoreEventRepository);
}

function buildEvent(): ShopEvent {
  const result = ShopEvent.reconstitute({
    id: 'event-1',
    title: { en: 'Open Chair Day', bg: 'Ден на отворените столове' },
    description: {
      en: 'Walk-in trims, no booking needed',
      bg: 'Подстригвания без резервация',
    },
    startDateIso: '2026-09-12T10:00:00',
    timezone: 'Europe/Sofia',
    locationId: 'location-1',
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('bad fixture event');
  return result.value;
}

describe('FirestoreEventRepository', () => {
  beforeEach(() => {
    store.clear();
    lastOnSnapshotArgs = null;
  });

  it('round-trips save → findById, including the location and zone', async () => {
    const repo = createRepo();
    const event = buildEvent();

    const saveResult = await repo.save(event);
    expect(saveResult.isSuccess()).toBe(true);

    const found = await repo.findById(event.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(event.id)).toBe(true);
      expect(found.value?.locationId?.value).toBe('location-1');
      expect(found.value?.startDate.zoneName).toBe('Europe/Sofia');
    }
  });

  it('findById returns null when the document does not exist', async () => {
    const repo = createRepo();
    const event = buildEvent();
    const found = await repo.findById(event.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value).toBeNull();
    }
  });

  it('observeUpcoming queries startDateIso >= now, ascending', async () => {
    const repo = createRepo();
    const subscription = repo.observeUpcoming().subscribe();

    expect(lastOnSnapshotArgs).not.toBeNull();
    const [whereConstraint, orderByConstraint] = lastOnSnapshotArgs?.query
      .constraints as [
      { field: string; op: string; value: string },
      { field: string; direction?: string },
    ];
    expect(whereConstraint).toMatchObject({
      field: 'startDateIso',
      op: '>=',
    });
    expect(orderByConstraint).toMatchObject({
      field: 'startDateIso',
      direction: 'asc',
    });

    subscription.unsubscribe();
  });

  it('observePast queries startDateIso < now, descending', async () => {
    const repo = createRepo();
    const subscription = repo.observePast().subscribe();

    expect(lastOnSnapshotArgs).not.toBeNull();
    const [whereConstraint, orderByConstraint] = lastOnSnapshotArgs?.query
      .constraints as [
      { field: string; op: string; value: string },
      { field: string; direction?: string },
    ];
    expect(whereConstraint).toMatchObject({
      field: 'startDateIso',
      op: '<',
    });
    expect(orderByConstraint).toMatchObject({
      field: 'startDateIso',
      direction: 'desc',
    });

    subscription.unsubscribe();
  });
});
