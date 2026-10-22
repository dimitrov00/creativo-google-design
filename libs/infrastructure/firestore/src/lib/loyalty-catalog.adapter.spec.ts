import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import { loyaltyCatalogMemo } from '@creativo/infrastructure/firebase-app';
import {
  HeadRole,
  StreakPublishCall,
  StreakRule,
  StreakTransition,
} from '@core/components';
import type { StreakDefinition, StreakDefinitionVersion } from '@core/entities';
import type { LoyaltyCatalog } from '@core/ports';
import {
  EngagementErrorCode,
  type LocalDate,
  PublishRequestId,
  RepositoryErrorCode,
  StreakDefinitionVersionId,
} from '@core/primitives';
import { LoyaltyCatalogSystem } from '@core/systems';
import {
  FIXTURE_TODAY,
  localDate,
  loyaltyCatalogFixture,
  loyaltyCatalogJson,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
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

const { loyaltyCatalogReadPorts } = await import('./loyalty-catalog.adapter');
const { streakPublishGatewayPorts } =
  await import('./streak-publish-gateway.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;
const FUNCTIONS = {} as Functions;

/** The six collections in the order the adapter reads them. */
const COLLECTIONS = [
  'badgeCategories',
  'badgeSeries',
  'seasons',
  'tierDefinitions',
  'rewardsCatalog',
  'streakDefinitions',
] as const;

const HEAD = 'streakDefinitions/cadence';
const WAITS_FROM = localDate('2026-10-05');
const EVE = localDate('2026-10-04');

/** The rule with grace widened to ten days from 5.10: version 2, which waits. */
const WIDER_GRACE: StreakRule = {
  ...StreakRule.DEFAULT,
  version: 2,
  effectiveFromLocalDate: WAITS_FROM,
  graceDays: 10,
};

/** The catalogue fixture, as its six collections, every body exactly as the file holds it. */
function seeded(skip: ReadonlySet<string> = new Set()): FakeFirestore {
  const db = new FakeFirestore();
  for (const [name, documents] of Object.entries(loyaltyCatalogJson)) {
    for (const [id, body] of Object.entries(documents)) {
      if (!skip.has(id)) db.set(`${name}/${id}`, body);
    }
  }
  return db;
}

/** An entity's stored body: every field but its id. */
function bodyOf<E extends { readonly id: string }>(entity: E): Omit<E, 'id'> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  ) as Omit<E, 'id'>;
}

/** The head after one publish that waits for 5.10, with both versions beneath it. */
function withAVersionThatWaits(db: FakeFirestore): FakeFirestore {
  const head: StreakDefinition = streakDefinitionFixture({
    rules: [
      {
        ...StreakRule.DEFAULT,
        headRole: HeadRole.Current,
        streakTransition: null,
      },
      {
        ...WIDER_GRACE,
        headRole: HeadRole.Scheduled,
        streakTransition: StreakTransition.Grandfather,
      },
    ],
    updatedAtUtcMs: utcMs('2026-09-28T09:00:00.000+03:00'),
  });
  const first: StreakDefinitionVersion = streakDefinitionVersionFixture();
  return db
    .set(HEAD, bodyOf(head))
    .set(`${HEAD}/versions/${first.id}`, bodyOf(first))
    .set(`${HEAD}/versions/${StreakDefinitionVersionId.forVersion(2)}`, {
      ...bodyOf(first),
      ...WIDER_GRACE,
    });
}

/** A `today` closure the spec moves by hand — `app.config.ts`'s is the clock read in the shop's zone. */
function aDay(start: LocalDate = FIXTURE_TODAY) {
  let day = start;
  return {
    today: () => day,
    turnTo: (next: LocalDate) => {
      day = next;
    },
  };
}

function setUp(db: FakeFirestore = seeded(), start?: LocalDate) {
  const memo = loyaltyCatalogMemo();
  const clock = aDay(start);
  return {
    db,
    memo,
    clock,
    ports: loyaltyCatalogReadPorts(asDb(db), memo, clock.today),
    gateway: streakPublishGatewayPorts(FUNCTIONS, memo),
  };
}

const read = async (ports: ReturnType<typeof setUp>['ports']) =>
  unwrapOk(await ports.loadLoyaltyCatalog());

const inForce = (catalog: LoyaltyCatalog, day: LocalDate) =>
  LoyaltyCatalogSystem.streakInForce(
    catalog,
    StreakRule.DEFAULT_DEFINITION_ID,
    day,
  );

describe('loyaltyCatalogReadPorts — the read', () => {
  beforeEach(() => callableMock.mockReset());

  it('reads the six collections once, under the system’s part names, every document as stored', async () => {
    const { ports, db } = setUp();

    const catalog = await read(ports);

    expect(db.reads.map((one) => one.path)).toEqual([...COLLECTIONS]);
    expect(catalog).toEqual(loyaltyCatalogFixture());
  });

  it('hands LoyaltyCatalogSystem.validate a catalogue it takes unmapped, in today’s display order (F3-10)', async () => {
    const { ports } = setUp();

    const valid = unwrapOk(LoyaltyCatalogSystem.validate(await read(ports)));

    expect(valid.categories).toHaveLength(6);
    expect(valid.families).toHaveLength(42);
    expect(valid.seasons).toHaveLength(3);
    expect(valid.tiers.map((tier) => tier.id)).toEqual([
      'bronze',
      'silver',
      'gold',
      'platinum',
    ]);
  });

  it('hands over the rhythm’s rule as its head: in force, resolved by date by the system', async () => {
    const { ports } = setUp(withAVersionThatWaits(seeded()));

    const catalog = await read(ports);

    expect(catalog.streaks.map((head) => head.id)).toEqual(['cadence']);
    expect(catalog.streaks[0]?.rules.map((rule) => rule.headRole)).toEqual([
      HeadRole.Current,
      HeadRole.Scheduled,
    ]);
    expect(inForce(catalog, EVE)?.graceDays).toBe(7);
    expect(inForce(catalog, WAITS_FROM)?.graceDays).toBe(10);
  });

  it('never takes a rule’s versions for rules: they are a subcollection, and the admin page’s', async () => {
    const { ports, db } = setUp(withAVersionThatWaits(seeded()));

    const catalog = await read(ports);

    expect(catalog.streaks).toHaveLength(1);
    expect(db.reads.map((one) => one.path)).not.toContain(`${HEAD}/versions`);
  });

  it('reads an unpublished catalogue as an empty one', async () => {
    const { ports } = setUp(new FakeFirestore());

    expect(await read(ports)).toEqual({
      categories: [],
      series: [],
      seasons: [],
      tiers: [],
      rewards: [],
      streaks: [],
    });
  });

  it('a stored body is answered as stored — a head whose rule is no rule included (F3-1 b)', async () => {
    const head = loyaltyCatalogJson.streakDefinitions['cadence'];
    const broken = {
      ...head,
      rules: [{ ...head?.rules[0], graceDays: 10_000 }],
    };
    const { ports } = setUp(seeded().set(HEAD, broken));

    const catalog = await read(ports);

    expect(catalog.streaks).toEqual([{ id: 'cadence', ...broken }]);
  });

  it('answers a catalogue that does not hold together as stored: refusing it is the system’s, over the answer', async () => {
    const { ports } = setUp(seeded(new Set(['series-2026-autumn-beard'])));

    const catalog = await read(ports);
    const refused = unwrapErr(LoyaltyCatalogSystem.validate(catalog));

    expect(catalog.series).toHaveLength(41);
    expect(refused.map((fault) => fault.errorCode)).toContain(
      EngagementErrorCode.LoyaltyCatalogDanglingSeason,
    );
  });

  it('turns a refused read into a failed Result naming the collection and the store’s reason', async () => {
    const { ports, db } = setUp();
    db.failWith(
      Object.assign(new Error('Missing permissions'), {
        code: 'permission-denied',
      }),
    );

    expect(await ports.loadLoyaltyCatalog()).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'badgeCategories',
        reason: 'permission-denied',
      },
    });
  });
});

describe('loyaltyCatalogReadPorts — the memo: for the session, and the shop’s day', () => {
  beforeEach(() => callableMock.mockReset());

  it('keeps a good answer: the second card reads nothing', async () => {
    const { ports, db } = setUp();

    const first = await read(ports);
    const second = await read(ports);

    expect(db.reads).toHaveLength(6);
    expect(second).toBe(first);
  });

  it('shares one read between callers asking at once', async () => {
    const { ports, db } = setUp();

    const [first, second] = await Promise.all([
      ports.loadLoyaltyCatalog(),
      ports.loadLoyaltyCatalog(),
    ]);

    expect(db.reads).toHaveLength(6);
    expect(unwrapOk(second)).toBe(unwrapOk(first));
  });

  it('never keeps a failed read: the next call reads again', async () => {
    const { ports, db } = setUp();
    db.failWith();
    expect((await ports.loadLoyaltyCatalog()).ok).toBe(false);

    db.recover();
    const healed = await ports.loadLoyaltyCatalog();

    expect(healed.ok).toBe(true);
    expect(db.reads).toHaveLength(12);
  });

  it('holds while `today` answers the same shop day — the evening included', async () => {
    const { ports, db, clock } = setUp();
    const morning = await read(ports);

    clock.turnTo(FIXTURE_TODAY);
    const evening = await read(ports);

    expect(db.reads).toHaveLength(6);
    expect(evening).toBe(morning);
  });

  it('reads again once the shop’s day has turned: a tab left open past midnight', async () => {
    const { ports, db, clock } = setUp();
    const before = await read(ports);

    clock.turnTo(localDate('2026-09-29'));
    const after = await read(ports);

    expect(db.reads).toHaveLength(12);
    expect(after).not.toBe(before);
  });

  it('answers the day’s copy, and either copy resolves the rule by the day asked', async () => {
    const { ports, db, clock } = setUp(withAVersionThatWaits(seeded()), EVE);
    const eve = await read(ports);
    expect(inForce(eve, EVE)?.graceDays).toBe(7);

    clock.turnTo(WAITS_FROM);
    const day = await read(ports);

    expect(db.reads).toHaveLength(12);
    expect(day).not.toBe(eve);
    for (const copy of [eve, day]) {
      expect(inForce(copy, WAITS_FROM)?.version).toBe(2);
      expect(inForce(copy, WAITS_FROM)?.graceDays).toBe(10);
    }
  });
});

describe('loyaltyCatalogReadPorts — invalidate', () => {
  beforeEach(() => callableMock.mockReset());

  it('drops the session’s copy: the next call reads the collections again', async () => {
    const { ports, db, memo } = setUp();
    const before = await read(ports);

    memo.invalidate();
    const after = await read(ports);

    expect(db.reads).toHaveLength(12);
    expect(after).not.toBe(before);
  });

  it('keeps a read that was in flight for nobody, and still answers whoever waited on it', async () => {
    const { ports, db, memo } = setUp();

    const inFlight = ports.loadLoyaltyCatalog();
    memo.invalidate();
    const next = ports.loadLoyaltyCatalog();

    expect((await inFlight).ok).toBe(true);
    expect((await next).ok).toBe(true);
    expect(db.reads).toHaveLength(12);
    // The read made after the invalidation is the one that is kept.
    const kept = await read(ports);
    expect(kept).toBe(unwrapOk(await next));
    expect(db.reads).toHaveLength(12);
  });
});

describe('loyaltyCatalogReadPorts — after a publish in this session (one memo)', () => {
  beforeEach(() => callableMock.mockReset());

  it('the next card reads the rule that was just written', async () => {
    const { ports, gateway, db } = setUp();
    const before = await read(ports);
    expect(before.streaks[0]?.rules).toHaveLength(1);

    // The server writes the head and answers; the gateway hears it.
    withAVersionThatWaits(db);
    callableMock.mockResolvedValueOnce({
      data: {
        kind: 'published',
        version: 2,
        effectiveFrom: '2026-10-05',
        direction: 'looser',
      },
    });
    const written = await gateway.publishStreakRule({
      requestId: PublishRequestId.of('req-wider-grace'),
      streakId: StreakRule.DEFAULT_DEFINITION_ID,
      baseVersion: 1,
      rule: WIDER_GRACE,
      streakTransition: StreakTransition.Grandfather,
      previewHash: null,
    });
    expect(written.ok).toBe(true);

    const after = await read(ports);

    expect(inForce(after, WAITS_FROM)?.graceDays).toBe(10);
    expect(db.reads).toHaveLength(12);
  });

  it('a withdrawal that was refused leaves the copy where it is', async () => {
    const { ports, gateway, db } = setUp();
    await read(ports);
    callableMock.mockResolvedValueOnce({
      data: { kind: 'refused', code: 'stale', fields: [] },
    });

    await gateway.withdrawStreakRule(
      StreakPublishCall.withdraw(
        PublishRequestId.of('req-undo'),
        StreakRule.DEFAULT_DEFINITION_ID,
        2,
      ),
    );
    await read(ports);

    expect(db.reads).toHaveLength(6);
  });
});
