import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Position } from '@creativo/domain/programs';

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
  orderBy: vi.fn((field: string) => ({ field })),
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
const { FirestorePositionRepository } =
  await import('./position-repository.adapter');

function createRepo(db: Firestore = {} as Firestore) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestorePositionRepository,
    ],
  });
  return TestBed.inject(FirestorePositionRepository);
}

function buildPosition(overrides?: { status?: 'open' | 'closed' }): Position {
  const result = Position.reconstitute({
    id: 'position-1',
    title: { en: 'Barber', bg: 'Бръснар' },
    summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
    locationIds: ['location-1'],
    status: overrides?.status ?? 'open',
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('bad fixture position');
  return result.value;
}

describe('FirestorePositionRepository', () => {
  beforeEach(() => {
    store.clear();
    lastOnSnapshotArgs = null;
  });

  it('round-trips save → findById', async () => {
    const repo = createRepo();
    const position = buildPosition();

    const saveResult = await repo.save(position);
    expect(saveResult.isSuccess()).toBe(true);

    const found = await repo.findById(position.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(position.id)).toBe(true);
      expect(found.value?.status).toBe('open');
    }
  });

  it('findById returns null when the document does not exist', async () => {
    const repo = createRepo();
    const position = buildPosition();
    const found = await repo.findById(position.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value).toBeNull();
    }
  });

  it('observeOpen emits every position from the live snapshot', async () => {
    const repo = createRepo();
    const emitted: unknown[] = [];
    const subscription = repo.observeOpen().subscribe((r) => {
      emitted.push(r);
    });

    expect(lastOnSnapshotArgs).not.toBeNull();

    lastOnSnapshotArgs?.onNext({
      docs: [
        {
          id: 'position-open',
          data: () => ({
            title: { en: 'Barber', bg: 'Бръснар' },
            summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
            locationIds: ['location-1'],
            status: 'open',
            applyUrl: null,
            sortOrder: 0,
          }),
        },
      ],
    });

    expect(emitted).toHaveLength(1);
    const result = emitted[0] as { isSuccess: () => boolean; value: unknown[] };
    expect(result.isSuccess()).toBe(true);
    expect(result.value).toHaveLength(1);

    subscription.unsubscribe();
  });

  it('observeAll queries without a status filter, unlike observeOpen', async () => {
    const repo = createRepo();
    const subscription = repo.observeAll().subscribe();

    expect(lastOnSnapshotArgs).not.toBeNull();
    expect(lastOnSnapshotArgs?.query.constraints).toHaveLength(1);
    expect(lastOnSnapshotArgs?.query.constraints[0]).toMatchObject({
      field: 'sortOrder',
    });

    subscription.unsubscribe();
  });
});
