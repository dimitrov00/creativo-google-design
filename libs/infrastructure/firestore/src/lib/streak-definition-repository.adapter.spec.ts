import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Subscription } from 'rxjs';
import {
  FIREBASE_FIRESTORE,
  FIREBASE_FUNCTIONS,
} from '@creativo/infrastructure/firebase-app';
import type { Result } from '@creativo/domain/kernel';
import {
  type PublishStreakDefinition,
  STREAK_PUBLISH_REFUSALS,
  StreakDefinition,
  type StreakDefinitionHeadDocument,
  type StreakDefinitionSchedule,
  StreakPublishFailedError,
  StreakPublishRefusedError,
  streakDefinitionToDocument,
} from '@creativo/application/engagement';
import {
  InMemoryStreakDefinitionRepository,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import { RepositoryError } from '@creativo/application/shared';
import { FakeFirestore } from '../testing/fake-firestore';

const { callableMock, httpsCallableMock } = vi.hoisted(() => {
  const callable = vi.fn();
  return {
    callableMock: callable,
    httpsCallableMock: vi.fn<
      (functions: unknown, name: string) => typeof callable
    >(() => callable),
  };
});

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);
vi.mock('firebase/functions', async () => ({
  ...(await vi.importActual<typeof import('firebase/functions')>(
    'firebase/functions',
  )),
  httpsCallable: httpsCallableMock,
}));

import { LoyaltyCatalogSession } from './loyalty-catalog-reader.adapter';
import { FirestoreStreakDefinitionRepository } from './streak-definition-repository.adapter';

const HEAD = 'streakDefinitions/cadence';
const TODAY = loyaltyFixtures.today;

/** The catalogue fixture's head: the seeded rule in force, nothing waiting. */
function seededHead(): StreakDefinitionHeadDocument {
  const head = loyaltyFixtures.catalog.streakDefinitions['cadence'];
  if (head === undefined) throw new Error('the fixture holds no rule');
  return head;
}

/** The seeded rule with grace widened to ten days, to take effect a week on: version 2, which waits. */
function widerGrace(): StreakDefinition {
  const revised = StreakDefinition.default().revise(
    { graceDays: 10 },
    '2026-10-05',
  );
  if (revised.isFailure()) throw new Error('bad fixture rule');
  return revised.value;
}

/**
 * The rule's documents as the server leaves them: the seeded head and its
 * first version, then one publish that waits. Written by the port's
 * reference, so the adapter is read against the documents the callable
 * writes, not against a shape this spec made up.
 */
async function published(): Promise<ReadonlyMap<string, object>> {
  const reference = InMemoryStreakDefinitionRepository.seeded({ today: TODAY });
  const written = await reference.publish({
    requestId: 'req-wider-grace',
    baseVersion: 1,
    definition: widerGrace(),
    transition: 'grandfather',
    previewHash: null,
  });
  if (written.isFailure()) throw written.error;
  const documents = reference.documentsOf('cadence');
  if (documents === null) throw new Error('the reference holds no rule');
  return new Map<string, object>([
    [HEAD, documents.head],
    ...Object.entries(documents.versions).map(
      ([id, version]): [string, object] => [`${HEAD}/versions/${id}`, version],
    ),
  ]);
}

/** The published rule's documents, one of them written over. */
async function publishedWith(
  path: string,
  change: (document: object) => object,
): Promise<FakeFirestore> {
  const db = new FakeFirestore(await published());
  return db.set(path, change(db.documentAt(path) ?? {}));
}

function setUp(db: FakeFirestore = new FakeFirestore()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      { provide: FIREBASE_FUNCTIONS, useValue: { app: 'functions' } },
      FirestoreStreakDefinitionRepository,
    ],
  });
  const session = TestBed.inject(LoyaltyCatalogSession);
  const invalidate = vi.spyOn(session, 'invalidate');
  return {
    db,
    invalidate,
    repository: TestBed.inject(FirestoreStreakDefinitionRepository),
  };
}

type Observed = Result<StreakDefinitionSchedule | null, RepositoryError>;

function watch(
  repository: FirestoreStreakDefinitionRepository,
  id = 'cadence',
) {
  const heard: Observed[] = [];
  const subscription: Subscription = repository
    .observe(id)
    .subscribe((result) => heard.push(result));
  return { heard, subscription };
}

function request(
  overrides: Partial<PublishStreakDefinition> = {},
): PublishStreakDefinition {
  return {
    requestId: 'req-1',
    baseVersion: 1,
    definition: widerGrace(),
    transition: 'grandfather',
    previewHash: null,
    ...overrides,
  };
}

describe('FirestoreStreakDefinitionRepository', () => {
  beforeEach(() => {
    callableMock.mockReset();
    httpsCallableMock.mockClear();
    TestBed.resetTestingModule();
  });

  describe('observe: the head, watched', () => {
    it('hands over the head as a schedule: the rule in force, and nothing waiting', () => {
      const { repository, db } = setUp(
        new FakeFirestore({ [HEAD]: seededHead() }),
      );
      const { heard } = watch(repository);

      expect(db.reads).toEqual([
        { kind: 'listen', path: HEAD, constraints: [] },
      ]);
      expect(heard).toHaveLength(1);
      const [first] = heard;
      if (first === undefined || first.isFailure() || first.value === null) {
        throw new Error('expected a schedule');
      }
      expect(first.value.id).toBe('cadence');
      expect(first.value.scheduled).toBeNull();
      expect(first.value.current.equals(StreakDefinition.default())).toBe(true);
      expect(first.value.inForceOn(TODAY).graceDays).toBe(7);
    });

    it('resolves a version that waits by date, with no second read', async () => {
      const { repository } = setUp(new FakeFirestore(await published()));
      const { heard } = watch(repository);

      const [first] = heard;
      if (first === undefined || first.isFailure() || first.value === null) {
        throw new Error('expected a schedule');
      }
      expect(first.value.upcomingOn(TODAY)?.definition.version).toBe(2);
      expect(first.value.upcomingOn(TODAY)?.transition).toBe('grandfather');
      expect(first.value.inForceOn('2026-10-04').graceDays).toBe(7);
      expect(first.value.inForceOn('2026-10-05').graceDays).toBe(10);
    });

    it('answers null, not a failure, for a shop that has published no rule', () => {
      const { repository } = setUp();
      const { heard } = watch(repository);

      expect(heard).toHaveLength(1);
      expect(heard[0]?.isSuccess() && heard[0].value).toBeNull();
    });

    it('hears a publish made elsewhere as it lands', async () => {
      const documents = await published();
      const { repository, db } = setUp(
        new FakeFirestore({ [HEAD]: seededHead() }),
      );
      const { heard } = watch(repository);

      db.set(HEAD, documents.get(HEAD) ?? {});

      expect(heard).toHaveLength(2);
      const second = heard[1];
      expect(
        second?.isSuccess() && second.value?.scheduled?.definition.version,
      ).toBe(2);
    });

    it('says a head that is no rule once, and stays to hear the publish that mends it', () => {
      const good = seededHead();
      const { repository, db } = setUp(
        new FakeFirestore({
          [HEAD]: { ...good, current: { ...good.current, graceDays: 10_000 } },
        }),
      );
      const { heard } = watch(repository);

      expect(heard).toHaveLength(1);
      expect(heard[0]?.isFailure()).toBe(true);
      expect(db.listening).toBe(1);

      db.set(HEAD, good);

      expect(heard).toHaveLength(2);
      expect(heard[1]?.isSuccess()).toBe(true);
    });

    it('refuses the flat document of before revision 3 as a failed Result, and stays to hear the seed that replaces it', () => {
      const { repository, db } = setUp(
        new FakeFirestore({
          [HEAD]: {
            name: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
            version: 1,
            effectiveFrom: '2025-03-01T07:00:00.000Z',
            cadence: { kind: 'rollingDays', days: 42 },
            graceDays: 7,
            riskLeadDays: 7,
            freezes: { maxBanked: 2, earnEvery: 5, autoApply: true },
            excused: ['shopClosure', 'barberAbsence', 'staffCancelled'],
            repair: { windowDays: 14, perYear: 1 },
          },
        }),
      );
      const { heard } = watch(repository);

      expect(heard).toHaveLength(1);
      expect(heard[0]?.isFailure() && heard[0].error).toBeInstanceOf(
        RepositoryError,
      );
      expect(db.listening).toBe(1);

      db.set(HEAD, seededHead());

      expect(heard).toHaveLength(2);
      expect(heard[1]?.isSuccess() && heard[1].value?.current.version).toBe(1);
    });

    it('turns a refused listen into a failed Result, never a thrown stream', () => {
      const { repository, db } = setUp();
      db.failWith(
        Object.assign(new Error('no'), { code: 'permission-denied' }),
      );
      const { heard } = watch(repository);

      expect(heard).toHaveLength(1);
      const [first] = heard;
      expect(first?.isFailure() && first.error).toBeInstanceOf(RepositoryError);
    });

    it('watches nothing for a rule with no name', () => {
      const { repository, db } = setUp();
      const { heard } = watch(repository, '  ');

      expect(db.reads).toEqual([]);
      expect(heard[0]?.isSuccess() && heard[0].value).toBeNull();
    });

    it('lets go of its listener when nobody watches any more', () => {
      const { repository, db } = setUp();
      const { subscription } = watch(repository);
      expect(db.listening).toBe(1);

      subscription.unsubscribe();

      expect(db.listening).toBe(0);
    });
  });

  describe('listVersions: the history', () => {
    it('lists every publish newest first, each under the head’s name', async () => {
      const { repository, db } = setUp(new FakeFirestore(await published()));

      const result = await repository.listVersions('cadence', 20);

      if (result.isFailure()) throw result.error;
      expect(result.value.map((v) => v.definition.version)).toEqual([2, 1]);
      const [newest, first] = result.value;
      expect(newest?.definition.graceDays).toBe(10);
      expect(newest?.definition.effectiveFrom).toBe('2026-10-05');
      expect(newest?.definition.name.bg).toBe('Посещения в ритъм');
      expect(newest?.publishedBy).toBe('dev-staff-ivan');
      expect(newest?.requestId).toBe('req-wider-grace');
      expect(newest?.direction).toBe('looser');
      expect(newest?.changed).toEqual(['graceDays']);
      expect(newest?.withdrawnAt).toBeNull();
      expect(first?.publishedBy).toBe('system');
      expect(db.reads).toEqual([
        { kind: 'document', path: HEAD, constraints: [] },
        {
          kind: 'query',
          path: `${HEAD}/versions`,
          constraints: ['orderBy version desc', 'limit 20'],
        },
      ]);
    });

    it('keeps to the limit, from the newest', async () => {
      const { repository } = setUp(new FakeFirestore(await published()));

      const result = await repository.listVersions('cadence', 1);

      expect(
        result.isSuccess() && result.value.map((v) => v.definition.version),
      ).toEqual([2]);
    });

    it.each([0, -3, 2.9, Number.NaN])(
      'asks for a whole count of at least one, whatever was asked (%s)',
      async (asked) => {
        const { repository, db } = setUp(new FakeFirestore(await published()));

        const result = await repository.listVersions('cadence', asked);

        expect(result.isSuccess()).toBe(true);
        expect(db.reads[1]?.constraints[1]).toBe(
          asked === 2.9 ? 'limit 2' : 'limit 1',
        );
      },
    );

    it('shows a withdrawn version as withdrawn', async () => {
      const { repository } = setUp(
        await publishedWith(`${HEAD}/versions/000002`, (version) => ({
          ...version,
          withdrawnAt: '2026-09-29T08:00:00.000Z',
        })),
      );

      const result = await repository.listVersions('cadence', 20);

      if (result.isFailure()) throw result.error;
      expect(result.value[0]?.withdrawnAt?.toISOString()).toBe(
        '2026-09-29T08:00:00.000Z',
      );
    });

    it('is an empty history, and reads no version, for a rule nobody published', async () => {
      const { repository, db } = setUp();

      const result = await repository.listVersions('cadence', 20);

      expect(result.isSuccess() && result.value).toEqual([]);
      expect(db.reads.map((read) => read.kind)).toEqual(['document']);
    });

    it('reads nothing for a rule with no name', async () => {
      const { repository, db } = setUp(new FakeFirestore(await published()));

      const result = await repository.listVersions(' ', 20);

      expect(result.isSuccess() && result.value).toEqual([]);
      expect(db.reads).toEqual([]);
    });

    it('fails rather than list the publishes around one it cannot read', async () => {
      const { repository } = setUp(
        await publishedWith(`${HEAD}/versions/000001`, (version) => ({
          ...version,
          publishedBy: '',
        })),
      );

      const result = await repository.listVersions('cadence', 20);

      expect(result.isFailure() && result.error.message).toContain(
        'streakDefinitions/cadence/versions/000001',
      );
    });

    it('refuses a version whose document id is not its number', async () => {
      const db = new FakeFirestore(await published());
      const { repository } = setUp(
        db.set(
          `${HEAD}/versions/000009`,
          db.documentAt(`${HEAD}/versions/000002`) ?? {},
        ),
      );

      expect((await repository.listVersions('cadence', 20)).isFailure()).toBe(
        true,
      );
    });

    it('turns the rules’ refusal into a failed Result: the history is the admin pair’s', async () => {
      const { repository, db } = setUp(new FakeFirestore(await published()));
      const refusal = Object.assign(new Error('Missing permissions'), {
        code: 'permission-denied',
      });
      db.failWith(refusal);

      const result = await repository.listVersions('cadence', 20);

      expect(result.isFailure() && result.error).toBeInstanceOf(
        RepositoryError,
      );
      expect(result.isFailure() && result.error.cause).toBe(refusal);
    });
  });

  describe('publish: through the callable', () => {
    const answer = {
      kind: 'published',
      version: 2,
      effectiveFrom: '2026-10-05',
      direction: 'looser',
    };

    it('sends the rule as the callable’s request: the draft is the rule’s own document', async () => {
      callableMock.mockResolvedValueOnce({ data: answer });
      const { repository } = setUp();
      const definition = widerGrace();

      await repository.publish(
        request({ definition, previewHash: 'hash-1', baseVersion: 1 }),
      );

      expect(httpsCallableMock).toHaveBeenCalledWith(
        { app: 'functions' },
        'publishStreakDefinition',
      );
      expect(callableMock).toHaveBeenCalledTimes(1);
      expect(callableMock).toHaveBeenCalledWith({
        op: 'publish',
        requestId: 'req-1',
        streakId: 'cadence',
        baseVersion: 1,
        draft: streakDefinitionToDocument(definition),
        effectiveFrom: '2026-10-05',
        transition: 'grandfather',
        previewHash: 'hash-1',
      });
    });

    it('carries no id and no name in the draft: they are the head’s', async () => {
      callableMock.mockResolvedValueOnce({ data: answer });
      const { repository } = setUp();

      await repository.publish(request());

      const sent: unknown = callableMock.mock.calls[0]?.[0];
      expect(sent).toMatchObject({ draft: { version: 2, graceDays: 10 } });
      expect(sent).not.toHaveProperty('draft.id');
      expect(sent).not.toHaveProperty('draft.name');
    });

    it('answers with what the SERVER wrote: its number, its day, its verdict', async () => {
      // After a withdrawal the writer numbers past the proposal.
      callableMock.mockResolvedValueOnce({
        data: { ...answer, version: 3, direction: 'mixed' },
      });
      const { repository } = setUp();

      const result = await repository.publish(request());

      expect(result.isSuccess() && result.value).toEqual({
        version: 3,
        effectiveFrom: '2026-10-05',
        direction: 'mixed',
      });
    });

    it('drops the session’s copy of the catalogue once the rule is written', async () => {
      callableMock.mockResolvedValueOnce({ data: answer });
      const { repository, invalidate } = setUp();

      await repository.publish(request());

      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it.each(STREAK_PUBLISH_REFUSALS)(
      'hands over the server’s refusal «%s» in its own word, with the fields it names',
      async (code) => {
        callableMock.mockResolvedValueOnce({
          data: { kind: 'refused', code, fields: ['graceDays', 7, 'interval'] },
        });
        const { repository, invalidate } = setUp();

        const result = await repository.publish(request());

        if (result.isSuccess()) throw new Error('expected a refusal');
        expect(result.error).toBeInstanceOf(StreakPublishRefusedError);
        expect(result.error).toMatchObject({
          refusal: code,
          fields: ['graceDays', 'interval'],
        });
        expect(invalidate).not.toHaveBeenCalled();
      },
    );

    it('reads «tooEarly» by its word and its field; the day the server names is not the port’s to carry yet', async () => {
      callableMock.mockResolvedValueOnce({
        data: {
          kind: 'refused',
          code: 'tooEarly',
          fields: ['effectiveFrom'],
          earliest: '2026-10-29',
        },
      });
      const { repository } = setUp();

      const result = await repository.publish(request());

      if (result.isSuccess()) throw new Error('expected a refusal');
      expect(result.error).toBeInstanceOf(StreakPublishRefusedError);
      expect(result.error).toMatchObject({
        refusal: 'tooEarly',
        fields: ['effectiveFrom'],
      });
    });

    it('reads a refusal that names no field', async () => {
      callableMock.mockResolvedValueOnce({
        data: { kind: 'refused', code: 'stale' },
      });
      const { repository } = setUp();

      const result = await repository.publish(request());

      expect(result.isFailure() && result.error).toMatchObject({
        refusal: 'stale',
        fields: [],
      });
    });

    it.each([
      [
        'details.code',
        { details: { code: 'tooEarly', fields: ['effectiveFrom'] } },
      ],
      [
        'details.refusal',
        { details: { refusal: 'tooEarly', fields: ['effectiveFrom'] } },
      ],
    ])('reads a refusal that arrived thrown (%s)', async (_where, thrown) => {
      callableMock.mockRejectedValueOnce(
        Object.assign(new Error('failed-precondition'), {
          code: 'functions/failed-precondition',
          ...thrown,
        }),
      );
      const { repository } = setUp();

      const result = await repository.publish(request());

      expect(result.isFailure() && result.error).toBeInstanceOf(
        StreakPublishRefusedError,
      );
      expect(result.isFailure() && result.error).toMatchObject({
        refusal: 'tooEarly',
        fields: ['effectiveFrom'],
      });
    });

    it.each([
      // As the callable throws it when nobody is signed in.
      [
        'functions/unauthenticated',
        { code: 'loyalty.streak_publish.unauthenticated', params: {} },
      ],
      // As the platform throws it before the callable is reached.
      ['functions/permission-denied', undefined],
    ])(
      'reads the SDK’s own «%s» as the caller not being the admin pair',
      async (code, details) => {
        callableMock.mockRejectedValueOnce(
          Object.assign(new Error('no'), { code, details }),
        );
        const { repository } = setUp();

        const result = await repository.publish(request());

        expect(result.isFailure() && result.error).toMatchObject({
          refusal: 'notAdmin',
          fields: [],
        });
      },
    );

    it.each([
      [
        'offline',
        Object.assign(new Error('offline'), { code: 'functions/unavailable' }),
      ],
      [
        'a timeout',
        Object.assign(new Error('late'), {
          code: 'functions/deadline-exceeded',
        }),
      ],
      [
        'a write that fell over',
        Object.assign(new Error('boom'), {
          code: 'functions/internal',
          details: { code: 'loyalty.streak_publish.store_failed', params: {} },
        }),
      ],
      [
        'a request the server could not read',
        Object.assign(new Error('Invalid rhythm rule request: requestId'), {
          code: 'functions/invalid-argument',
          details: {
            code: 'loyalty.streak_publish.invalid_input',
            params: { field: 'requestId' },
          },
        }),
      ],
      ['something that is no error', 'nope'],
    ])(
      'tells %s apart from a refusal: the request got no answer',
      async (_what, thrown) => {
        callableMock.mockRejectedValueOnce(thrown);
        const { repository, invalidate } = setUp();

        const result = await repository.publish(request());

        if (result.isSuccess()) throw new Error('expected a failure');
        expect(result.error).toBeInstanceOf(StreakPublishFailedError);
        expect(result.error.cause).toBeInstanceOf(RepositoryError);
        expect((result.error.cause as RepositoryError).cause).toBe(thrown);
        expect(invalidate).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['nothing', null],
      ['a word', 'published'],
      ['a list', [answer]],
      ['a kind nobody knows', { kind: 'queued' }],
      ['a publish with no number', { ...answer, version: undefined }],
      ['a publish numbered zero', { ...answer, version: 0 }],
      ['a publish numbered in halves', { ...answer, version: 2.5 }],
      ['a day that is no day', { ...answer, effectiveFrom: '2026-02-30' }],
      [
        'an instant for a day',
        { ...answer, effectiveFrom: '2026-10-05T00:00:00.000Z' },
      ],
      ['a verdict nobody knows', { ...answer, direction: 'kinder' }],
      ['a refusal in a word nobody knows', { kind: 'refused', code: 'busy' }],
      ['a withdrawal, to a publish', { kind: 'withdrawn', version: 2 }],
    ])(
      'never reports a publish on %s: it is no answer at all',
      async (_what, data) => {
        callableMock.mockResolvedValueOnce({ data });
        const { repository, invalidate } = setUp();

        const result = await repository.publish(request());

        expect(result.isFailure() && result.error).toBeInstanceOf(
          StreakPublishFailedError,
        );
        expect(invalidate).not.toHaveBeenCalled();
      },
    );
  });

  describe('withdraw: through the same callable', () => {
    it('names the version it calls off', async () => {
      callableMock.mockResolvedValueOnce({
        data: { kind: 'withdrawn', version: 2 },
      });
      const { repository } = setUp();

      const result = await repository.withdraw('cadence', 2, 'req-undo');

      expect(httpsCallableMock).toHaveBeenCalledWith(
        { app: 'functions' },
        'publishStreakDefinition',
      );
      expect(callableMock).toHaveBeenCalledWith({
        op: 'withdraw',
        requestId: 'req-undo',
        streakId: 'cadence',
        version: 2,
      });
      expect(result.isSuccess() && result.value).toBeUndefined();
    });

    it('drops the session’s copy of the catalogue once the version is called off', async () => {
      callableMock.mockResolvedValueOnce({
        data: { kind: 'withdrawn', version: 2 },
      });
      const { repository, invalidate } = setUp();

      await repository.withdraw('cadence', 2, 'req-undo');

      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('hands over «stale» when the version no longer waits', async () => {
      callableMock.mockResolvedValueOnce({
        data: { kind: 'refused', code: 'stale', fields: [] },
      });
      const { repository, invalidate } = setUp();

      const result = await repository.withdraw('cadence', 2, 'req-undo');

      expect(result.isFailure() && result.error).toMatchObject({
        refusal: 'stale',
      });
      expect(invalidate).not.toHaveBeenCalled();
    });

    it.each([
      ['another version', { kind: 'withdrawn', version: 3 }],
      [
        'a publish',
        {
          kind: 'published',
          version: 2,
          effectiveFrom: '2026-10-05',
          direction: 'looser',
        },
      ],
      ['nothing', undefined],
    ])(
      'never reports a withdrawal on an answer for %s',
      async (_what, data) => {
        callableMock.mockResolvedValueOnce({ data });
        const { repository, invalidate } = setUp();

        const result = await repository.withdraw('cadence', 2, 'req-undo');

        expect(result.isFailure() && result.error).toBeInstanceOf(
          StreakPublishFailedError,
        );
        expect(invalidate).not.toHaveBeenCalled();
      },
    );

    it('tells a request that got no answer apart from a refusal', async () => {
      const thrown = Object.assign(new Error('offline'), {
        code: 'functions/unavailable',
      });
      callableMock.mockRejectedValueOnce(thrown);
      const { repository } = setUp();

      const result = await repository.withdraw('cadence', 2, 'req-undo');

      expect(result.isFailure() && result.error).toBeInstanceOf(
        StreakPublishFailedError,
      );
    });
  });
});
