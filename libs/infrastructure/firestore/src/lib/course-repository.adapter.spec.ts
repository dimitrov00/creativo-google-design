import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Course } from '@creativo/domain/programs';

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
const { FirestoreCourseRepository } =
  await import('./course-repository.adapter');

function createRepo(db: Firestore = {} as Firestore) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestoreCourseRepository,
    ],
  });
  return TestBed.inject(FirestoreCourseRepository);
}

function buildCourse(): Course {
  const result = Course.reconstitute({
    id: 'course-1',
    title: { en: 'Fundamentals of Fading', bg: 'Основи на фейда' },
    description: { en: 'Six-week evening course', bg: 'Шестседмичен курс' },
    enrollmentStatus: 'open',
    startsLabel: { en: 'Spring 2026', bg: 'Пролет 2026' },
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('bad fixture course');
  return result.value;
}

describe('FirestoreCourseRepository', () => {
  beforeEach(() => {
    store.clear();
    lastOnSnapshotArgs = null;
  });

  it('round-trips save → findById, including the startsLabel', async () => {
    const repo = createRepo();
    const course = buildCourse();

    const saveResult = await repo.save(course);
    expect(saveResult.isSuccess()).toBe(true);

    const found = await repo.findById(course.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(course.id)).toBe(true);
      expect(found.value?.startsLabel?.en).toBe('Spring 2026');
    }
  });

  it('findById returns null when the document does not exist', async () => {
    const repo = createRepo();
    const course = buildCourse();
    const found = await repo.findById(course.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value).toBeNull();
    }
  });

  it('observeOpenAndUpcoming emits every course from the live snapshot', async () => {
    const repo = createRepo();
    const emitted: unknown[] = [];
    const subscription = repo.observeOpenAndUpcoming().subscribe((r) => {
      emitted.push(r);
    });

    expect(lastOnSnapshotArgs).not.toBeNull();

    lastOnSnapshotArgs?.onNext({
      docs: [
        {
          id: 'course-open',
          data: () => ({
            title: { en: 'Fundamentals of Fading', bg: 'Основи на фейда' },
            description: {
              en: 'Six-week evening course',
              bg: 'Шестседмичен курс',
            },
            enrollmentStatus: 'upcoming',
            startsLabel: null,
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

  it('observeAll queries without an enrollmentStatus filter', async () => {
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
