import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FIREBASE_FIRESTORE,
  FIREBASE_FUNCTIONS,
} from '@creativo/infrastructure/firebase-app';
import {
  LOYALTY_CATALOG_COLLECTIONS,
  StreakDefinition,
} from '@creativo/application/engagement';
import {
  InMemoryStreakDefinitionRepository,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import { RepositoryError } from '@creativo/application/shared';
import { FakeFirestore } from '../testing/fake-firestore';

const { callableMock } = vi.hoisted(() => ({ callableMock: vi.fn() }));

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);
vi.mock('firebase/functions', async () => ({
  ...(await vi.importActual<typeof import('firebase/functions')>(
    'firebase/functions',
  )),
  httpsCallable: () => callableMock,
}));

import {
  FirestoreLoyaltyCatalogReader,
  LoyaltyCatalogSession,
} from './loyalty-catalog-reader.adapter';
import { FirestoreStreakDefinitionRepository } from './streak-definition-repository.adapter';

const HEAD = 'streakDefinitions/cadence';

/** Noon in Sofia on the fixtures' day, and on the days after it. */
const NOON = new Date(`${loyaltyFixtures.today}T09:00:00.000Z`);
const at = (iso: string) => new Date(iso);

/** The catalogue fixture, as its six collections. */
function seeded(): FakeFirestore {
  const db = new FakeFirestore();
  const collections = new Map<string, Readonly<Record<string, object>>>(
    Object.entries(loyaltyFixtures.catalog),
  );
  for (const name of LOYALTY_CATALOG_COLLECTIONS) {
    for (const [id, data] of Object.entries(collections.get(name) ?? {})) {
      db.set(`${name}/${id}`, data);
    }
  }
  return db;
}

/** The rule's documents after one publish that waits for 5.10: grace from 7 days to 10. */
async function withAVersionThatWaits(
  db: FakeFirestore,
): Promise<FakeFirestore> {
  const revised = StreakDefinition.default().revise(
    { graceDays: 10 },
    '2026-10-05',
  );
  if (revised.isFailure()) throw new Error('bad fixture rule');
  const reference = InMemoryStreakDefinitionRepository.seeded();
  const written = await reference.publish({
    requestId: 'req-wider-grace',
    baseVersion: 1,
    definition: revised.value,
    transition: 'grandfather',
    previewHash: null,
  });
  if (written.isFailure()) throw written.error;
  const documents = reference.documentsOf('cadence');
  if (documents === null) throw new Error('the reference holds no rule');
  db.set(HEAD, documents.head);
  for (const [id, version] of Object.entries(documents.versions)) {
    db.set(`${HEAD}/versions/${id}`, version);
  }
  return db;
}

function setUp(db: FakeFirestore = seeded()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      { provide: FIREBASE_FUNCTIONS, useValue: {} },
    ],
  });
  // Each adapter in an injector of its own under the root, as
  // `provideLazyPort` creates them: what they share, they share through
  // the root.
  const root = TestBed.inject(EnvironmentInjector);
  const reader = createEnvironmentInjector(
    [FirestoreLoyaltyCatalogReader],
    root,
  ).get(FirestoreLoyaltyCatalogReader);
  const repository = createEnvironmentInjector(
    [FirestoreStreakDefinitionRepository],
    root,
  ).get(FirestoreStreakDefinitionRepository);
  return { db, reader, repository };
}

const collectionsRead = (db: FakeFirestore) =>
  db.reads.map((read) => read.path);

describe('FirestoreLoyaltyCatalogReader', () => {
  beforeEach(() => {
    callableMock.mockReset();
    TestBed.resetTestingModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
  });

  afterEach(() => vi.useRealTimers());

  describe('the read', () => {
    it('reads the six collections once into one validated catalogue', async () => {
      const { reader, db } = setUp();

      const result = await reader.getCatalog();

      if (result.isFailure()) throw result.error;
      expect(collectionsRead(db)).toEqual([...LOYALTY_CATALOG_COLLECTIONS]);
      expect(result.value.categories).toHaveLength(6);
      expect(result.value.families).toHaveLength(42);
      expect(result.value.tiers.map((tier) => tier.id)).toEqual([
        'bronze',
        'silver',
        'gold',
        'platinum',
      ]);
    });

    it('hands over the rhythm’s rule as its head: in force, resolved by date', async () => {
      const { reader } = setUp(await withAVersionThatWaits(seeded()));

      const result = await reader.getCatalog();

      if (result.isFailure()) throw result.error;
      const { value: catalog } = result;
      expect(catalog.streakSchedules.map((schedule) => schedule.id)).toEqual([
        'cadence',
      ]);
      expect(catalog.streakSchedules[0]?.scheduled?.definition.version).toBe(2);
      expect(catalog.streakInForce('cadence', '2026-10-04')?.graceDays).toBe(7);
      expect(catalog.streakInForce('cadence', '2026-10-05')?.graceDays).toBe(
        10,
      );
      expect(catalog.streakInForce('nobody', '2026-10-05')).toBeNull();
    });

    it('never takes a rule’s versions for rules: they are a subcollection, and the admin page’s', async () => {
      const { reader, db } = setUp(await withAVersionThatWaits(seeded()));

      const result = await reader.getCatalog();

      expect(result.isSuccess()).toBe(true);
      expect(collectionsRead(db)).not.toContain(`${HEAD}/versions`);
    });

    it('reads an unpublished catalogue as an empty one', async () => {
      const { reader } = setUp(new FakeFirestore());

      const result = await reader.getCatalog();

      expect(result.isSuccess() && result.value.families).toEqual([]);
      expect(result.isSuccess() && result.value.streakSchedules).toEqual([]);
    });

    it('fails a catalogue whose rule is no rule', async () => {
      const head = loyaltyFixtures.catalog.streakDefinitions['cadence'];
      const { reader } = setUp(
        seeded().set(HEAD, {
          ...head,
          current: { ...head?.current, graceDays: 10_000 },
        }),
      );

      const result = await reader.getCatalog();

      expect(result.isFailure() && result.error).toBeInstanceOf(
        RepositoryError,
      );
    });

    it('turns a refused read into a failed Result', async () => {
      const { reader, db } = setUp();
      db.failWith(new Error('permission-denied'));

      const result = await reader.getCatalog();

      expect(result.isFailure() && result.error.message).toBe(
        'Failed to read the loyalty catalogue',
      );
    });
  });

  describe('the memo: for the session, and the day', () => {
    it('keeps a good answer: the second card reads nothing', async () => {
      const { reader, db } = setUp();

      const first = await reader.getCatalog();
      const second = await reader.getCatalog();

      expect(db.reads).toHaveLength(6);
      expect(first.isSuccess() && second.isSuccess()).toBe(true);
      if (first.isSuccess() && second.isSuccess()) {
        expect(second.value).toBe(first.value);
      }
    });

    it('shares one read between callers asking at once', async () => {
      const { reader, db } = setUp();

      const [first, second] = await Promise.all([
        reader.getCatalog(),
        reader.getCatalog(),
      ]);

      expect(db.reads).toHaveLength(6);
      if (first.isSuccess() && second.isSuccess()) {
        expect(second.value).toBe(first.value);
      }
    });

    it('never keeps a failed read: the next call reads again', async () => {
      const { reader, db } = setUp();
      db.failWith();
      expect((await reader.getCatalog()).isFailure()).toBe(true);

      db.recover();
      const healed = await reader.getCatalog();

      expect(healed.isSuccess()).toBe(true);
      expect(db.reads).toHaveLength(12);
    });

    it('holds through the evening, up to the last minute of the shop’s day', async () => {
      const { reader, db } = setUp();
      await reader.getCatalog();

      // 23:59 in Sofia (UTC+3 in September).
      vi.setSystemTime(at(`${loyaltyFixtures.today}T20:59:00.000Z`));
      await reader.getCatalog();

      expect(db.reads).toHaveLength(6);
    });

    it('reads again once the shop’s day has turned: a tab left open past midnight', async () => {
      const { reader, db } = setUp();
      const before = await reader.getCatalog();

      // 00:01 in Sofia the next day: still the fixtures' day in UTC.
      vi.setSystemTime(at(`${loyaltyFixtures.today}T21:01:00.000Z`));
      const after = await reader.getCatalog();

      expect(db.reads).toHaveLength(12);
      if (before.isSuccess() && after.isSuccess()) {
        expect(after.value).not.toBe(before.value);
      }
    });

    it('answers the day’s copy, and either copy resolves the rule by the day asked', async () => {
      const { reader, db } = setUp(await withAVersionThatWaits(seeded()));
      vi.setSystemTime(at('2026-10-04T09:00:00.000Z'));
      const eve = await reader.getCatalog();
      if (eve.isFailure()) throw eve.error;
      expect(eve.value.streakInForce('cadence', '2026-10-04')?.graceDays).toBe(
        7,
      );

      vi.setSystemTime(at('2026-10-05T09:00:00.000Z'));
      const day = await reader.getCatalog();
      if (day.isFailure()) throw day.error;

      expect(db.reads).toHaveLength(12);
      expect(day.value).not.toBe(eve.value);
      for (const copy of [eve.value, day.value]) {
        expect(copy.streakInForce('cadence', '2026-10-05')?.version).toBe(2);
        expect(copy.streakInForce('cadence', '2026-10-05')?.graceDays).toBe(10);
      }
    });
  });

  describe('invalidate', () => {
    it('drops the session’s copy: the next call reads the collections again', async () => {
      const { reader, db } = setUp();
      const before = await reader.getCatalog();

      reader.invalidate();
      const after = await reader.getCatalog();

      expect(db.reads).toHaveLength(12);
      if (before.isSuccess() && after.isSuccess()) {
        expect(after.value).not.toBe(before.value);
      }
    });

    it('keeps a read that was in flight for nobody, and still answers whoever waited on it', async () => {
      const { reader, db } = setUp();

      const inFlight = reader.getCatalog();
      reader.invalidate();
      const next = reader.getCatalog();

      expect((await inFlight).isSuccess()).toBe(true);
      expect((await next).isSuccess()).toBe(true);
      expect(db.reads).toHaveLength(12);
      // The read made after the invalidation is the one that is kept.
      const kept = await reader.getCatalog();
      const second = await next;
      if (kept.isSuccess() && second.isSuccess()) {
        expect(kept.value).toBe(second.value);
      }
      expect(db.reads).toHaveLength(12);
    });

    it('is shared through the root: an adapter in another injector drops the same copy', async () => {
      const { reader, db } = setUp();
      await reader.getCatalog();

      TestBed.inject(LoyaltyCatalogSession).invalidate();
      await reader.getCatalog();

      expect(db.reads).toHaveLength(12);
    });
  });

  describe('after a publish in this session', () => {
    it('the next card reads the rule that was just written', async () => {
      const { reader, repository, db } = setUp();
      const before = await reader.getCatalog();
      expect(
        before.isSuccess() && before.value.streakSchedules[0]?.scheduled,
      ).toBeNull();

      // The server writes the head and answers; the repository hears it.
      await withAVersionThatWaits(db);
      callableMock.mockResolvedValueOnce({
        data: {
          kind: 'published',
          version: 2,
          effectiveFrom: '2026-10-05',
          direction: 'looser',
        },
      });
      const revised = StreakDefinition.default().revise(
        { graceDays: 10 },
        '2026-10-05',
      );
      if (revised.isFailure()) throw new Error('bad fixture rule');
      const written = await repository.publish({
        requestId: 'req-wider-grace',
        baseVersion: 1,
        definition: revised.value,
        transition: 'grandfather',
        previewHash: null,
      });
      expect(written.isSuccess()).toBe(true);

      const after = await reader.getCatalog();

      expect(
        after.isSuccess() &&
          after.value.streakSchedules[0]?.scheduled?.definition.graceDays,
      ).toBe(10);
    });

    it('a publish that was refused leaves the copy where it is', async () => {
      const { reader, repository, db } = setUp();
      await reader.getCatalog();
      callableMock.mockResolvedValueOnce({
        data: { kind: 'refused', code: 'stale', fields: [] },
      });

      await repository.withdraw('cadence', 2, 'req-undo');
      await reader.getCatalog();

      expect(db.reads).toHaveLength(6);
    });
  });
});
