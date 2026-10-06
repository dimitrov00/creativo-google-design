import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { UserId } from '@creativo/domain/accounts';
import {
  StreakDefinition,
  type StreakDefinitionProps,
  StreakDefinitionSchedule,
} from '@creativo/domain/engagement';
import { actorForCaller } from '@creativo/domain/governance';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import {
  type StreakDefinitionVersionRecord,
  streakDefinitionToDocument,
  streakDefinitionVersionFromDocument,
  streakDefinitionVersionToDocument,
  streakScheduleFromDocument,
  streakScheduleToDocument,
} from '@creativo/application/engagement';
import { auditEntryIdFor } from '../lib/booking/audit';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { FixedClock } from '../test-support/fixed-clock';
import {
  type PublishStreakDefinitionFailure,
  PublishStreakDefinitionStaleError,
  PublishStreakDefinitionStoreError,
} from '../use-cases/publish-streak-definition.errors';
import {
  type PublishStreakDefinitionInput,
  PublishStreakDefinitionUseCase,
  type StreakDefinitionCaller,
  type StreakDefinitionDecision,
  type StreakDefinitionSnapshot,
} from '../use-cases/publish-streak-definition.use-case';
import { FirestoreStreakDefinitionStore } from './firestore-streak-definition-store';

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

/**
 * WHAT IS WRITTEN WHERE, over the in-memory Firestore: the head, the
 * versions and the act's row, read and written in one transaction. What is
 * decided is the use case's spec; this one drives the real use case where
 * a real decision is the shortest way to a document, and the store alone
 * where the store is the subject.
 */

/** 09:00 in Sofia on the fixtures' day. */
const NOW = '2026-09-28T06:00:00.000Z';
const TOMORROW = '2026-09-29';
const NEXT_WEEK = '2026-10-05';
const NEXT_MONTH = '2026-10-28';
const CADENCE = 'cadence';
const HEAD = `streakDefinitions/${CADENCE}`;
const versionPath = (id: string): string => `${HEAD}/versions/${id}`;

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw result.error;
  return result.value;
}

const OWNER: StreakDefinitionCaller = {
  uid: 'dev-staff-ivan',
  actor: actorForCaller(must(UserId.create('dev-staff-ivan')), ['admin']),
  isAdmin: true,
};

function rule(patch: Partial<StreakDefinitionProps> = {}): StreakDefinition {
  return must(
    StreakDefinition.create({
      ...StreakDefinition.default().toProps(),
      ...patch,
    }),
  );
}

function record(
  definition: StreakDefinition,
  over: Partial<StreakDefinitionVersionRecord> = {},
): StreakDefinitionVersionRecord {
  return {
    definition,
    publishedAt: new Date('2025-03-01T07:00:00.000Z'),
    publishedBy: 'system',
    transition: 'grandfather',
    direction: 'neutral',
    changed: [],
    requestId: `seed-${CADENCE}-${String(definition.version).padStart(6, '0')}`,
    withdrawnAt: null,
    ...over,
  };
}

/** The shop as the seed leaves it: the recommended rule in force, its one version. */
function seeded(): Record<string, Record<string, unknown>> {
  const current = rule();
  return {
    [HEAD]: {
      ...streakScheduleToDocument(
        must(StreakDefinitionSchedule.create({ current, scheduled: null })),
        new Date('2025-03-01T07:00:00.000Z'),
      ),
    },
    [versionPath('000001')]: {
      ...streakDefinitionVersionToDocument(record(current)),
    },
  };
}

/** The same shop with version 2 (ten days of grace) waiting for next week. */
function waiting(): Record<string, Record<string, unknown>> {
  const current = rule();
  const scheduled = rule({
    version: 2,
    effectiveFrom: NEXT_WEEK,
    graceDays: 10,
  });
  return {
    ...seeded(),
    [HEAD]: {
      ...streakScheduleToDocument(
        must(
          StreakDefinitionSchedule.create({
            current,
            scheduled: { definition: scheduled, transition: 'grandfather' },
          }),
        ),
        new Date('2026-09-20T07:00:00.000Z'),
      ),
    },
    [versionPath('000002')]: {
      ...streakDefinitionVersionToDocument(
        record(scheduled, {
          publishedBy: 'dev-staff-ivan',
          direction: 'looser',
          changed: ['graceDays'],
          requestId: 'request-that-scheduled-2',
        }),
      ),
    },
  };
}

/**
 * The head as an emulator seeded before revision 3 still holds it: flat,
 * no version in force. The reader refuses it; the seed replaces it.
 */
const FLAT_HEAD: Record<string, unknown> = {
  name: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
  cadence: { kind: 'rollingDays', days: 42 },
  graceDays: 7,
  riskLeadDays: 7,
  freezes: { maxBanked: 2, earnEvery: 5, autoApply: true },
  excused: ['shopClosure', 'barberAbsence', 'staffCancelled'],
  repair: { windowDays: 14, perYear: 1 },
  version: 1,
  effectiveFrom: '2025-03-01T07:00:00.000Z',
};

/**
 * The in-memory Firestore, with the one thing of the Admin SDK's
 * transaction it lacks and this store writes by: `create`, which refuses a
 * path that is taken. Every call on the transaction is logged in order.
 */
function firestore(seed: Record<string, Record<string, unknown>> = {}) {
  const fake = createProjectionFirestore(seed);
  const log: string[] = [];
  const db = {
    ...fake.db,
    runTransaction: <T>(run: (tx: unknown) => Promise<T>): Promise<T> =>
      fake.db.runTransaction((tx) =>
        run({
          get(target: Parameters<typeof tx.get>[0]) {
            log.push(
              target.kind === 'doc'
                ? `get ${target.path}`
                : `query ${target.state.path}`,
            );
            return tx.get(target);
          },
          create(ref: { path: string }, data: Record<string, unknown>) {
            log.push(`create ${ref.path}`);
            if (fake.docs.has(ref.path)) {
              throw Object.assign(new Error(`6 ALREADY_EXISTS: ${ref.path}`), {
                code: 6,
              });
            }
            tx.set(ref as Parameters<typeof tx.set>[0], data);
          },
          set(
            ref: Parameters<typeof tx.set>[0],
            data: Record<string, unknown>,
          ) {
            log.push(`set ${ref.path}`);
            tx.set(ref, data);
          },
          update(
            ref: Parameters<typeof tx.update>[0],
            patch: Record<string, unknown>,
          ) {
            log.push(`update ${ref.path}`);
            tx.update(ref, patch);
          },
        }),
      ),
  };
  return {
    docs: fake.docs,
    log,
    store: new FirestoreStreakDefinitionStore(db as unknown as Firestore),
    /** The paths of the audit rows written. */
    rows: (): string[] =>
      [...fake.docs.keys()].filter((path) => path.startsWith('auditLog/')),
  };
}

function useCaseOver(
  store: FirestoreStreakDefinitionStore,
  now = NOW,
): PublishStreakDefinitionUseCase {
  return new PublishStreakDefinitionUseCase(store, new FixedClock(now));
}

let intents = 0;
const nextIntent = (): string =>
  `request-${String((intents += 1)).padStart(12, '0')}`;

function publishOf(
  patch: Partial<StreakDefinitionProps>,
  effectiveFrom: string,
  over: Partial<PublishStreakDefinitionInput> = {},
): PublishStreakDefinitionInput {
  return {
    caller: OWNER,
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    draft: {
      ...streakDefinitionToDocument(
        rule({ ...patch, version: 2, effectiveFrom: TOMORROW }),
      ),
    },
    effectiveFrom,
    transition: 'grandfather',
    previewHash: null,
    ...over,
  };
}

/** The snapshot a decision was handed, and a refusal so that nothing is written. */
async function snapshotOf(
  store: FirestoreStreakDefinitionStore,
  streakId = CADENCE,
): Promise<StreakDefinitionSnapshot> {
  let seen: StreakDefinitionSnapshot | null = null;
  await store.commit(
    { act: 'publish', streakId, requestId: nextIntent() },
    (snapshot) => {
      seen = snapshot;
      return fail(new PublishStreakDefinitionStaleError(0, 0));
    },
  );
  if (seen === null) throw new Error('the decision was never asked');
  return seen;
}

describe('FirestoreStreakDefinitionStore — what a decision is made on', () => {
  it('reads no head as no rule, and no version as none written', async () => {
    const { store } = firestore();
    expect(await snapshotOf(store)).toEqual({
      schedule: null,
      highestVersion: 0,
    });
  });

  it('reads the head as a model, through the wire’s own reader', async () => {
    const { store } = firestore(waiting());
    const { schedule, highestVersion } = await snapshotOf(store);

    expect(schedule?.current.equals(rule())).toBe(true);
    expect(schedule?.scheduled?.definition.graceDays).toBe(10);
    expect(schedule?.scheduled?.transition).toBe('grandfather');
    expect(highestVersion).toBe(2);
  });

  it('counts a called-off version: its number is off the head and still taken', async () => {
    const { store } = firestore({
      ...seeded(),
      [versionPath('000002')]: {
        ...streakDefinitionVersionToDocument(
          record(rule({ version: 2, effectiveFrom: NEXT_WEEK }), {
            withdrawnAt: new Date('2026-09-21T07:00:00.000Z'),
          }),
        ),
      },
    });
    const { schedule, highestVersion } = await snapshotOf(store);
    expect(schedule?.current.version).toBe(1);
    expect(schedule?.scheduled).toBeNull();
    expect(highestVersion).toBe(2);
  });

  it('reads the number off the document id, and skips an id that is no version', async () => {
    const { store } = firestore({
      ...seeded(),
      [versionPath('000012')]: { version: 12 },
      [versionPath('draft')]: { version: 99 },
      [versionPath('7')]: { version: 7 },
      // Another rule's history is not this one's.
      'streakDefinitions/weekly/versions/000040': { version: 40 },
    });
    expect((await snapshotOf(store)).highestVersion).toBe(12);
  });

  it.each<[string, Record<string, unknown>]>([
    [
      'a rule in force that does not read',
      {
        ...new Map(Object.entries(seeded())).get(HEAD),
        current: { version: 1 },
      },
    ],
    ['the flat head of before revision 3', FLAT_HEAD],
  ])(
    'fails on %s: nothing is decided over a rule nobody could read, nothing is written',
    async (_, head) => {
      const { store, docs } = firestore({ [HEAD]: head });
      const before = new Map(docs);
      const decide = vi.fn();

      const outcome = await store.commit(
        { act: 'publish', streakId: CADENCE, requestId: nextIntent() },
        decide,
      );

      expect(outcome.isFailure() && outcome.error).toBeInstanceOf(
        PublishStreakDefinitionStoreError,
      );
      expect(decide).not.toHaveBeenCalled();
      expect(docs).toEqual(before);
    },
  );
});

describe('FirestoreStreakDefinitionStore — a publish, written', () => {
  it('writes the version, the head and ONE row', async () => {
    const { store, docs, rows } = firestore(seeded());
    const input = publishOf({ graceDays: 10 }, NEXT_WEEK);

    must(await useCaseOver(store).execute(input));

    expect(docs.get(versionPath('000002'))).toEqual({
      ...streakDefinitionToDocument(
        rule({ version: 2, effectiveFrom: NEXT_WEEK, graceDays: 10 }),
      ),
      publishedAt: NOW,
      publishedBy: 'dev-staff-ivan',
      transition: 'grandfather',
      direction: 'looser',
      changed: ['graceDays'],
      requestId: input.requestId,
      withdrawnAt: null,
    });
    expect(docs.get(HEAD)).toEqual({
      name: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
      current: streakDefinitionToDocument(rule()),
      scheduled: {
        ...streakDefinitionToDocument(
          rule({ version: 2, effectiveFrom: NEXT_WEEK, graceDays: 10 }),
        ),
        transition: 'grandfather',
      },
      updatedAt: NOW,
    });
    expect(rows()).toHaveLength(1);
    // The first version is nobody's to rewrite.
    expect(docs.get(versionPath('000001'))).toEqual(
      seeded()[versionPath('000001')],
    );
    expect(docs.size).toBe(4);
  });

  it('writes the row the audit log derives for the intent: ids and codes only', async () => {
    const { store, docs, rows } = firestore(seeded());
    const input = publishOf({ graceDays: 10, riskLeadDays: 3 }, NEXT_WEEK);
    must(await useCaseOver(store).execute(input));

    const id = auditEntryIdFor({
      action: 'loyalty.streak_definition_published',
      resourceId: 'streakDefinitions/cadence',
      targetUserId: null,
      changeKey: input.requestId,
    });
    expect(rows()).toEqual([`auditLog/${id}`]);
    expect(docs.get(`auditLog/${id}`)).toEqual({
      actor: { kind: 'admin', adminUserId: 'dev-staff-ivan' },
      action: 'loyalty.streak_definition_published',
      at: expect.stringMatching(/^2026-09-28T06:00:00\.000(Z|\+00:00)$/),
      // The rule is the shop's: the row is about no one client.
      targetUserId: null,
      resourceId: 'streakDefinitions/cadence',
      context: {
        from: '1',
        to: '2',
        effectiveFrom: NEXT_WEEK,
        transition: 'grandfather',
        direction: 'looser',
        changed: 'graceDays,riskLeadDays',
      },
    });
  });

  it('records the vendor as staff: the log tells the owner’s act from the vendor’s', async () => {
    const { store, docs, rows } = firestore(seeded());
    const vendor: StreakDefinitionCaller = {
      uid: 'vendor-1',
      actor: actorForCaller(must(UserId.create('vendor-1')), ['sysadmin']),
      isAdmin: true,
    };
    must(
      await useCaseOver(store).execute(
        publishOf({ graceDays: 10 }, TOMORROW, { caller: vendor }),
      ),
    );
    expect(docs.get(rows()[0] ?? '')?.['actor']).toEqual({
      kind: 'staff',
      userId: 'vendor-1',
      roles: ['sysadmin'],
    });
    expect(docs.get(versionPath('000002'))?.['publishedBy']).toBe('vendor-1');
  });

  it('writes what reads back as EQUAL models', async () => {
    const { store, docs } = firestore(seeded());
    must(
      await useCaseOver(store).execute(
        publishOf(
          {
            qualifier: {
              kind: 'services',
              serviceIds: ['svc-fade', 'svc-beard'],
            },
            interval: {
              kind: 'personal',
              tolerancePct: 25,
              minDays: 28,
              maxDays: 56,
              fallbackDays: 42,
            },
            excuses: ['closedDays', 'shopClosure'],
          },
          NEXT_WEEK,
        ),
      ),
    );

    const head = must(streakScheduleFromDocument(CADENCE, docs.get(HEAD)));
    const version = must(
      streakDefinitionVersionFromDocument(
        CADENCE,
        '000002',
        docs.get(versionPath('000002')),
        { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
      ),
    );
    expect(head.scheduled?.definition.equals(version.definition)).toBe(true);
    expect(version.definition.qualifier.toProps()).toEqual({
      kind: 'services',
      serviceIds: ['svc-fade', 'svc-beard'],
    });
    expect(version.definition.excuses).toEqual(['shopClosure', 'closedDays']);
    expect(version.changed).toEqual(['qualifier', 'interval', 'excuses']);
    expect(version.publishedAt).toEqual(new Date(NOW));
  });

  it('opens a shop’s first rule: head, version 1 and its row, on nothing', async () => {
    const { store, docs, rows } = firestore();
    must(
      await useCaseOver(store).execute(
        publishOf({}, NEXT_MONTH, { baseVersion: 0 }),
      ),
    );

    expect([...docs.keys()].sort()).toEqual(
      [HEAD, versionPath('000001'), ...rows()].sort(),
    );
    const head = must(streakScheduleFromDocument(CADENCE, docs.get(HEAD)));
    expect(head.current.effectiveFrom).toBe(NEXT_MONTH);
    expect(head.scheduled).toBeNull();
  });

  it('stamps what waited as called off, and touches nothing else of it', async () => {
    const { store, docs } = firestore(waiting());
    const before = docs.get(versionPath('000002'));

    must(
      await useCaseOver(store).execute(
        publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 }),
      ),
    );

    expect(docs.get(versionPath('000002'))).toEqual({
      ...before,
      withdrawnAt: NOW,
    });
    expect(docs.get(versionPath('000003'))).toMatchObject({
      version: 3,
      graceDays: 14,
      withdrawnAt: null,
    });
    const head = must(streakScheduleFromDocument(CADENCE, docs.get(HEAD)));
    expect(head.scheduled?.definition.version).toBe(3);
  });

  it('has nothing to stamp when what waited has no document of its own', async () => {
    const headOnly = Object.fromEntries(
      Object.entries(waiting()).filter(
        ([path]) => path !== versionPath('000002'),
      ),
    );
    const { store, docs } = firestore(headOnly);

    must(
      await useCaseOver(store).execute(
        publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 }),
      ),
    );

    expect(docs.has(versionPath('000002'))).toBe(false);
    expect(docs.get(versionPath('000003'))).toMatchObject({ version: 3 });
  });

  it('never gives a called-off version’s number away', async () => {
    const { store, docs } = firestore(waiting());
    const useCase = useCaseOver(store);
    must(
      await useCase.withdraw({
        caller: OWNER,
        requestId: nextIntent(),
        streakId: CADENCE,
        version: 2,
      }),
    );
    const calledOff = docs.get(versionPath('000002'));

    // The head is back on version 1: the next draft is made on 1 and
    // proposes 2, which is taken.
    const next = must(
      await useCase.execute(publishOf({ graceDays: 14 }, NEXT_WEEK)),
    );

    expect(next).toMatchObject({ kind: 'published', version: 3 });
    expect(docs.get(versionPath('000002'))).toEqual(calledOff);
    expect(docs.get(versionPath('000003'))).toMatchObject({ graceDays: 14 });
  });
});

describe('FirestoreStreakDefinitionStore — a withdrawal, written', () => {
  it('clears the head, stamps the version and writes ONE row; adds no version', async () => {
    const { store, docs, rows } = firestore(waiting());
    const before = docs.get(versionPath('000002'));
    const requestId = nextIntent();

    must(
      await useCaseOver(store).withdraw({
        caller: OWNER,
        requestId,
        streakId: CADENCE,
        version: 2,
      }),
    );

    expect(docs.get(HEAD)).toEqual({
      name: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
      current: streakDefinitionToDocument(rule()),
      scheduled: null,
      updatedAt: NOW,
    });
    expect(docs.get(versionPath('000002'))).toEqual({
      ...before,
      withdrawnAt: NOW,
    });
    expect(docs.has(versionPath('000003'))).toBe(false);

    const id = auditEntryIdFor({
      action: 'loyalty.streak_definition_withdrawn',
      resourceId: 'streakDefinitions/cadence',
      targetUserId: null,
      changeKey: requestId,
    });
    expect(rows()).toEqual([`auditLog/${id}`]);
    expect(docs.get(`auditLog/${id}`)).toMatchObject({
      actor: { kind: 'admin', adminUserId: 'dev-staff-ivan' },
      action: 'loyalty.streak_definition_withdrawn',
      targetUserId: null,
      resourceId: 'streakDefinitions/cadence',
      context: {
        from: '2',
        to: '1',
        effectiveFrom: NEXT_WEEK,
        transition: 'grandfather',
      },
    });
  });
});

describe('FirestoreStreakDefinitionStore — a retry writes nothing', () => {
  it('answers the retry of a publish as the first attempt was answered', async () => {
    const { store, docs } = firestore(seeded());
    const useCase = useCaseOver(store);
    const input = publishOf({ graceDays: 10 }, NEXT_WEEK);

    const first = must(await useCase.execute(input));
    const written = new Map(docs);
    // The head moved with the first attempt, and a day has passed.
    const again = must(
      await useCaseOver(store, '2026-09-29T06:00:00.000Z').execute(input),
    );

    expect(again).toEqual(first);
    expect(docs).toEqual(written);
  });

  it('finds its own write before it decides anything', async () => {
    const { store } = firestore(waiting());
    const decide = vi.fn();

    const outcome = must(
      await store.commit(
        {
          act: 'publish',
          streakId: CADENCE,
          requestId: 'request-that-scheduled-2',
        },
        decide,
      ),
    );

    expect(outcome).toEqual({
      kind: 'replayed',
      receipt: {
        kind: 'published',
        version: 2,
        effectiveFrom: NEXT_WEEK,
        direction: 'looser',
      },
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it('answers the retry of a withdrawal as it did, though nothing waits any more', async () => {
    const { store, docs } = firestore(waiting());
    const useCase = useCaseOver(store);
    const input = {
      caller: OWNER,
      requestId: nextIntent(),
      streakId: CADENCE,
      version: 2,
    };

    const first = must(await useCase.withdraw(input));
    const written = new Map(docs);
    const again = must(await useCase.withdraw(input));

    expect(again).toEqual(first);
    expect(again).toEqual({ kind: 'withdrawn', version: 2 });
    expect(docs).toEqual(written);
  });

  it('takes another intent for what it is: the same act asked anew is decided anew', async () => {
    const { store } = firestore(waiting());
    const useCase = useCaseOver(store);
    const asked = { caller: OWNER, streakId: CADENCE, version: 2 };

    must(await useCase.withdraw({ ...asked, requestId: nextIntent() }));
    const anew = await useCase.withdraw({ ...asked, requestId: nextIntent() });

    expect(anew.isFailure() && anew.error).toBeInstanceOf(
      PublishStreakDefinitionStaleError,
    );
  });

  it('keeps a publish and a withdrawal apart, even under one name', async () => {
    const { store } = firestore(seeded());
    const useCase = useCaseOver(store);
    const input = publishOf({ graceDays: 10 }, NEXT_WEEK);
    must(await useCase.execute(input));

    const withdrawn = must(
      await useCase.withdraw({
        caller: OWNER,
        requestId: input.requestId,
        streakId: CADENCE,
        version: 2,
      }),
    );
    expect(withdrawn).toEqual({ kind: 'withdrawn', version: 2 });
  });
});

describe('FirestoreStreakDefinitionStore — what it never does', () => {
  it('writes nothing when the decision is a refusal, and hands the refusal on', async () => {
    const { store, docs, log } = firestore(waiting());
    const before = new Map(docs);
    const refusal = new PublishStreakDefinitionStaleError(1, 2);

    const outcome = await store.commit(
      { act: 'publish', streakId: CADENCE, requestId: nextIntent() },
      () => fail(refusal),
    );

    expect(outcome.isFailure() && outcome.error).toBe(refusal);
    expect(docs).toEqual(before);
    expect(log.filter((call) => !/^(get|query) /.test(call))).toEqual([]);
  });

  it('reads before it writes, every time', async () => {
    const { store, log } = firestore(waiting());
    must(
      await useCaseOver(store).execute(
        publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 }),
      ),
    );

    const firstWrite = log.findIndex((call) => !/^(get|query) /.test(call));
    expect(firstWrite).toBeGreaterThan(0);
    expect(
      log.slice(firstWrite).filter((call) => /^(get|query) /.test(call)),
    ).toEqual([]);
    expect(log).toEqual([
      `get ${HEAD}`,
      `query ${HEAD}/versions`,
      `query ${HEAD}/versions`,
      `get ${versionPath('000002')}`,
      `create ${versionPath('000003')}`,
      `update ${versionPath('000002')}`,
      `set ${HEAD}`,
      expect.stringMatching(/^create auditLog\/[0-9a-f]{64}$/),
    ]);
  });

  it('never rewrites a version: a number that is taken fails the act', async () => {
    // A decision that publishes version 2, handed to a store whose
    // `versions/000002` is there already.
    const decision = await decisionOf({ graceDays: 10 }, NEXT_WEEK);
    expect(decision.version?.definition.version).toBe(2);
    const { store, docs } = firestore(waiting());
    const before = new Map(docs);

    const outcome = await store.commit(
      { act: 'publish', streakId: CADENCE, requestId: nextIntent() },
      () => ok(decision),
    );

    expect(outcome.isFailure() && outcome.error).toBeInstanceOf(
      PublishStreakDefinitionStoreError,
    );
    expect(docs).toEqual(before);
  });

  it('fails, never throws, when the transaction does', async () => {
    const down = new Error('deadline exceeded');
    const store = new FirestoreStreakDefinitionStore({
      runTransaction: async () => {
        throw down;
      },
    } as unknown as Firestore);

    const outcome = await store.commit(
      { act: 'publish', streakId: CADENCE, requestId: nextIntent() },
      vi.fn(),
    );

    expect(
      outcome.isFailure() &&
        outcome.error instanceof PublishStreakDefinitionStoreError &&
        outcome.error.storeFailure,
    ).toBe(down);
  });
});

/**
 * A real decision, made by the use case over the recommended rule with
 * nothing else ever written: what a store is handed.
 */
async function decisionOf(
  patch: Partial<StreakDefinitionProps>,
  effectiveFrom: string,
): Promise<StreakDefinitionDecision> {
  const made: StreakDefinitionDecision[] = [];
  const capture = {
    commit: async (
      _intent: unknown,
      decide: (
        snapshot: StreakDefinitionSnapshot,
      ) => Result<StreakDefinitionDecision, PublishStreakDefinitionFailure>,
    ) => {
      const decision = must(
        decide({
          schedule: must(
            StreakDefinitionSchedule.create({
              current: rule(),
              scheduled: null,
            }),
          ),
          highestVersion: 1,
        }),
      );
      made.push(decision);
      return ok({ kind: 'written' as const, decision });
    },
  };
  must(
    await new PublishStreakDefinitionUseCase(
      capture,
      new FixedClock(NOW),
    ).execute(publishOf(patch, effectiveFrom)),
  );
  const [decision] = made;
  if (decision === undefined) throw new Error('no decision was made');
  return decision;
}
