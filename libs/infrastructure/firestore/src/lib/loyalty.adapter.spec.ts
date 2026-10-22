import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  AchievementOp,
  FreezeOp,
  JournalEffect,
  JournalFeed,
  JournalVisibility,
  PauseOp,
  PauseScope,
  PauseTerm,
  RedemptionOp,
  RewardOp,
  RewardRef,
  StreakOp,
  TierOp,
} from '@core/components';
import type { JournalEntry } from '@core/entities';
import type { ClientJournalPorts, JournalPage } from '@core/ports';
import {
  CustomerId,
  type RepositoryError,
  RepositoryErrorCode,
  type Result,
} from '@core/primitives';
import {
  type LoyaltyClientJson,
  loyaltyAccountFixtures,
  loyaltyAccountJson,
  memoryClientJournalPorts,
  unwrapOk,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { clientJournalPorts, loyaltyAccountReadPorts } =
  await import('./loyalty.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

const GEORGI = loyaltyAccountFixtures.georgi.customerId;
const MARTIN = loyaltyAccountFixtures.martin.customerId;
const NOBODY = CustomerId.of('cus_nobody');

type Body = Readonly<Record<string, unknown>>;

/** One account holder's documents at their flat paths, exactly as the fixture files hold them. */
function documentsOf(holder: LoyaltyClientJson): Record<string, Body> {
  const account = `loyaltyAccounts/${holder.customerId}`;
  return {
    [account]: holder.account,
    ...Object.fromEntries(
      Object.entries(holder.badgeProgress).map(([id, body]) => [
        `${account}/badgeProgress/${id}`,
        body,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(holder.seasonProgress).map(([id, body]) => [
        `${account}/seasonProgress/${id}`,
        body,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(holder.clientJournal).map(([id, body]) => [
        `clientJournal/${id}`,
        body,
      ]),
    ),
  };
}

/** Георги's newest point row — what the rows written above it start from. */
const LAST_POINT_ROW: Body = (() => {
  const journal: LoyaltyClientJson['clientJournal'] =
    loyaltyAccountJson.georgi.clientJournal;
  const row = journal[`${GEORGI}_000035`];
  if (row === undefined) throw new Error('fixture: no row 35');
  return Object.fromEntries(
    Object.entries(row as Body).filter(([key]) => key !== 'pointsDelta'),
  );
})();

/** One more row on Георги's journal, as the engine would write it: the newest row with another effect. */
function above(
  seq: number,
  effect: Body,
  overrides: Body = {},
): [string, Body] {
  return [
    `clientJournal/${GEORGI}_${String(seq).padStart(6, '0')}`,
    {
      ...LAST_POINT_ROW,
      seq,
      correlationId: `event-${seq}`,
      idempotencyKey: `event-${seq}`,
      labelParams: [],
      appointmentId: null,
      ...effect,
      ...overrides,
    },
  ];
}

/**
 * Георги's 35 point rows, and above them one row of every other effect the
 * feed holds, two the feed never holds, and one the client never sees:
 *
 * 36 a level earned · 37 a tier reached · 38 a reward given ·
 * 39 points exchanged · 40 the rhythm (never in the feed) ·
 * 41 a pause, staff-only · 42 a protection (never in the feed).
 */
const ABOVE: Record<string, Body> = Object.fromEntries([
  above(
    36,
    {
      journalEffect: JournalEffect.Achievement,
      achievementRuleId: 'rule-series-rhythm-5',
      achievementRuleVersion: 1,
      achievementAwardKey: 'rule-series-rhythm-5:dev-client-1:once',
      achievementOp: AchievementOp.Granted,
    },
    { labelCode: 'achievement.earned' },
  ),
  above(
    37,
    {
      journalEffect: JournalEffect.Tier,
      tierOp: TierOp.Changed,
      tierFrom: 'silver',
      tierTo: 'gold',
      tierUntil: null,
    },
    { labelCode: 'tier.changed' },
  ),
  above(
    38,
    {
      journalEffect: JournalEffect.Reward,
      rewardOp: RewardOp.Granted,
      rewardRef: RewardRef.CouponGrant,
      rewardCouponGrantId: 'grant-free-haircut',
    },
    { labelCode: 'reward.granted' },
  ),
  above(
    39,
    {
      journalEffect: JournalEffect.Redemption,
      redemptionOp: RedemptionOp.Redeemed,
      redemptionId: 'redemption-1',
      redeemedRewardId: 'reward-haircut',
      redemptionCost: 250,
      grantRef: RewardRef.CouponGrant,
      grantCouponGrantId: 'grant-free-haircut',
    },
    { labelCode: 'redemption.changed' },
  ),
  above(
    40,
    {
      journalEffect: JournalEffect.Streak,
      streakId: 'cadence',
      streakOp: StreakOp.Extended,
      streakFrom: 24,
      streakTo: 25,
      streakDueBy: '2026-11-09',
    },
    { labelCode: 'streak.changed' },
  ),
  above(
    41,
    {
      journalEffect: JournalEffect.Pause,
      pauseOp: PauseOp.Applied,
      pauseId: 'pause-1',
      pauseTerm: PauseTerm.Permanent,
      pauseUntil: null,
      pauseScope: PauseScope.AllBookings,
      priorPauseTerm: null,
      priorPauseUntil: null,
      priorPauseScope: null,
    },
    { labelCode: 'pause.changed', journalVisibility: JournalVisibility.Staff },
  ),
  above(
    42,
    {
      journalEffect: JournalEffect.Freeze,
      streakId: 'cadence',
      freezeOp: FreezeOp.Earned,
      freezeCount: 1,
      freezesBankedAfter: 2,
    },
    { labelCode: 'freeze.changed' },
  ),
]);

const seeded = () =>
  new FakeFirestore({
    ...documentsOf(loyaltyAccountJson.georgi),
    ...documentsOf(loyaltyAccountJson.martin),
    ...ABOVE,
  });

/** Every stored row of the seeded journal, as entities — what the in-memory double reads. */
function seededEntries(): readonly JournalEntry[] {
  return [
    ...loyaltyAccountFixtures.georgi.clientJournal,
    ...loyaltyAccountFixtures.martin.clientJournal,
    ...Object.entries(ABOVE).map(
      ([path, body]) =>
        ({ id: path.split('/')[1], ...body }) as unknown as JournalEntry,
    ),
  ];
}

const seqs = (page: JournalPage) => page.entries.map((entry) => entry.seq);

/** Every page of a pill, walked through `nextBeforeSeq` until there is none. */
async function walk(
  ports: ClientJournalPorts,
  customerId: CustomerId,
  feed: JournalFeed,
  limit: number,
): Promise<{ pages: number[][]; cursors: (number | null)[] }> {
  const pages: number[][] = [];
  const cursors: (number | null)[] = [];
  let before: number | null = null;
  do {
    const page: Result<JournalPage, RepositoryError> =
      await ports.pageClientJournal(
        customerId,
        JournalFeed.effectsOf(feed),
        before,
        limit,
      );
    const value = unwrapOk(page);
    pages.push(seqs(value));
    cursors.push(value.nextBeforeSeq);
    before = value.nextBeforeSeq;
  } while (before !== null && pages.length < 50);
  return { pages, cursors };
}

const refusal = () =>
  Object.assign(new Error('Missing permissions'), {
    code: 'permission-denied',
  });

describe('loyaltyAccountReadPorts — a client record’s loyalty', () => {
  it('reads the account a barber sees: the stored body, its id the client record', async () => {
    const fake = seeded();

    const account = unwrapOk(
      await loyaltyAccountReadPorts(asDb(fake)).loadLoyaltyAccount(GEORGI),
    );

    expect(account).toEqual(loyaltyAccountFixtures.georgi.account);
    expect(account?.balance).toBe(358);
    expect(account?.tierId).toBe('gold');
    expect(fake.reads).toEqual([
      { kind: 'document', path: `loyaltyAccounts/${GEORGI}`, constraints: [] },
    ]);
  });

  it('reads every started family and every season track, in Firestore’s id order', async () => {
    const ports = loyaltyAccountReadPorts(asDb(seeded()));

    const progress = unwrapOk(await ports.listBadgeProgress(GEORGI));
    const seasons = unwrapOk(await ports.listSeasonProgress(GEORGI));

    expect(progress).toEqual(loyaltyAccountFixtures.georgi.badgeProgress);
    expect(seasons).toEqual(loyaltyAccountFixtures.georgi.seasonProgress);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('answers null and empty lists for a client record with no account', async () => {
    const ports = loyaltyAccountReadPorts(asDb(seeded()));

    expect(unwrapOk(await ports.loadLoyaltyAccount(NOBODY))).toBeNull();
    expect(unwrapOk(await ports.listBadgeProgress(NOBODY))).toEqual([]);
    expect(unwrapOk(await ports.listSeasonProgress(NOBODY))).toEqual([]);
  });

  it('a stored body is answered as stored — a malformed account and progress document included (F3-1 b)', async () => {
    const fake = seeded()
      .set(`loyaltyAccounts/${GEORGI}`, {
        ...loyaltyAccountJson.georgi.account,
        balance: '358',
      })
      .set(`loyaltyAccounts/${GEORGI}/badgeProgress/series-broken`, {
        value: 'many',
        earned: [],
      });
    const ports = loyaltyAccountReadPorts(asDb(fake));

    const account = unwrapOk(await ports.loadLoyaltyAccount(GEORGI));
    const progress = unwrapOk(await ports.listBadgeProgress(GEORGI));

    expect(account).toEqual({
      ...loyaltyAccountFixtures.georgi.account,
      balance: '358',
    });
    expect(progress).toHaveLength(
      loyaltyAccountFixtures.georgi.badgeProgress.length + 1,
    );
    expect(progress).toContainEqual({
      id: 'series-broken',
      value: 'many',
      earned: [],
    });
  });

  it('turns a refused read into a failed Result naming the path and the store’s reason', async () => {
    const fake = seeded().failWith(refusal());
    const ports = loyaltyAccountReadPorts(asDb(fake));

    const account = await ports.loadLoyaltyAccount(GEORGI);
    const seasons = await ports.listSeasonProgress(GEORGI);

    expect(account).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: `loyaltyAccounts/${GEORGI}`,
        reason: 'permission-denied',
      },
    });
    expect(seasons).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: `loyaltyAccounts/${GEORGI}/seasonProgress`,
        reason: 'permission-denied',
      },
    });
  });
});

describe('clientJournalPorts — the query', () => {
  it('names the client record, the visibility the rule demands, the pill’s effects, the order and one row more than asked', async () => {
    const fake = seeded();

    await clientJournalPorts(asDb(fake)).pageClientJournal(
      GEORGI,
      JournalFeed.effectsOf(JournalFeed.All),
      null,
      20,
    );

    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'clientJournal',
        constraints: [
          `customerId == "${GEORGI}"`,
          'journalVisibility == "CLIENT"',
          'journalEffect in ["POINTS","ACHIEVEMENT","TIER","REWARD","REDEMPTION"]',
          'orderBy seq desc',
          'limit 21',
        ],
      },
    ]);
  });

  it.each<[JournalFeed, string]>([
    [JournalFeed.Points, 'journalEffect == "POINTS"'],
    [JournalFeed.Rewards, 'journalEffect in ["REWARD","REDEMPTION"]'],
    [JournalFeed.Status, 'journalEffect == "TIER"'],
  ])('asks «%s» for its own effects: %s', async (feed, constraint) => {
    const fake = seeded();

    await clientJournalPorts(asDb(fake)).pageClientJournal(
      GEORGI,
      JournalFeed.effectsOf(feed),
      null,
      5,
    );

    expect(fake.reads[0]?.constraints[2]).toBe(constraint);
  });

  it('starts after the cursor on a later page', async () => {
    const fake = seeded();

    await clientJournalPorts(asDb(fake)).pageClientJournal(
      GEORGI,
      JournalFeed.effectsOf(JournalFeed.Points),
      31,
      5,
    );

    expect(fake.reads[0]?.constraints).toEqual([
      `customerId == "${GEORGI}"`,
      'journalVisibility == "CLIENT"',
      'journalEffect == "POINTS"',
      'orderBy seq desc',
      'startAfter 31',
      'limit 6',
    ]);
  });

  it.each([0, -2, Number.NaN, 3.7])(
    'asks for a whole page of at least one row, whatever was asked (%s)',
    async (limit) => {
      const fake = seeded();

      const page = unwrapOk(
        await clientJournalPorts(asDb(fake)).pageClientJournal(
          GEORGI,
          JournalFeed.effectsOf(JournalFeed.Points),
          null,
          limit,
        ),
      );

      expect(fake.reads[0]?.constraints.at(-1)).toBe(
        limit === 3.7 ? 'limit 4' : 'limit 2',
      );
      expect(page.entries).toHaveLength(limit === 3.7 ? 3 : 1);
    },
  );

  it('reads nothing for no effects: an empty page (the SDK refuses an empty `in`)', async () => {
    const fake = seeded();

    const page = await clientJournalPorts(asDb(fake)).pageClientJournal(
      GEORGI,
      [],
      null,
      20,
    );

    expect(unwrapOk(page)).toEqual({ entries: [], nextBeforeSeq: null });
    expect(fake.reads).toEqual([]);
  });
});

describe('clientJournalPorts — «Всички»', () => {
  it('hands over the newest rows first, one per journal entry, whatever they moved', async () => {
    const page = unwrapOk(
      await clientJournalPorts(asDb(seeded())).pageClientJournal(
        GEORGI,
        JournalFeed.effectsOf(JournalFeed.All),
        null,
        6,
      ),
    );

    expect(seqs(page)).toEqual([39, 38, 37, 36, 35, 34]);
    expect(page.entries.map((entry) => entry.journalEffect)).toEqual([
      JournalEffect.Redemption,
      JournalEffect.Reward,
      JournalEffect.Tier,
      JournalEffect.Achievement,
      JournalEffect.Points,
      JournalEffect.Points,
    ]);
    expect(page.nextBeforeSeq).toBe(34);
  });

  it('never reads the rhythm’s rows, a protection or a staff row', async () => {
    const { pages } = await walk(
      clientJournalPorts(asDb(seeded())),
      GEORGI,
      JournalFeed.All,
      50,
    );

    const read = pages.flat();
    expect(read).toHaveLength(39);
    expect(read).not.toContain(40);
    expect(read).not.toContain(41);
    expect(read).not.toContain(42);
  });

  it('a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b)', async () => {
    const page = unwrapOk(
      await clientJournalPorts(asDb(seeded())).pageClientJournal(
        GEORGI,
        JournalFeed.effectsOf(JournalFeed.Points),
        null,
        1,
      ),
    );

    expect(page.entries[0]).toEqual(
      loyaltyAccountFixtures.georgi.clientJournal.at(-1),
    );
    expect(page.entries[0]).toMatchObject({
      id: `${GEORGI}_000035`,
      seq: 35,
      localDate: '2026-09-28',
      correlationId: 'appt:appt-dev-1:seat:seat-1',
      appointmentId: 'appt-dev-1',
      journalEffect: JournalEffect.Points,
      pointsDelta: 17,
      balanceAfter: 358,
      labelCode: 'points.rule',
      reverses: null,
    });
  });

  it('never hands one client record another’s rows', async () => {
    const { pages } = await walk(
      clientJournalPorts(asDb(seeded())),
      MARTIN,
      JournalFeed.All,
      50,
    );

    expect(pages.flat()).toEqual(
      Array.from({ length: 18 }, (_, index) => 18 - index),
    );
  });
});

describe('clientJournalPorts — the pills', () => {
  it('«Точки» is the point rows alone', async () => {
    const page = unwrapOk(
      await clientJournalPorts(asDb(seeded())).pageClientJournal(
        GEORGI,
        JournalFeed.effectsOf(JournalFeed.Points),
        null,
        3,
      ),
    );

    expect(seqs(page)).toEqual([35, 34, 33]);
    expect(page.nextBeforeSeq).toBe(33);
  });

  it('«Награди» is what was given and what was exchanged', async () => {
    const page = unwrapOk(
      await clientJournalPorts(asDb(seeded())).pageClientJournal(
        GEORGI,
        JournalFeed.effectsOf(JournalFeed.Rewards),
        null,
        20,
      ),
    );

    expect(seqs(page)).toEqual([39, 38]);
    expect(page.nextBeforeSeq).toBeNull();
  });

  it('«Статус» is the tier’s rows', async () => {
    const page = unwrapOk(
      await clientJournalPorts(asDb(seeded())).pageClientJournal(
        GEORGI,
        JournalFeed.effectsOf(JournalFeed.Status),
        null,
        20,
      ),
    );

    expect(seqs(page)).toEqual([37]);
  });

  it('is an empty page, never an error, under a pill that holds nothing', async () => {
    const page = await clientJournalPorts(asDb(seeded())).pageClientJournal(
      MARTIN,
      JournalFeed.effectsOf(JournalFeed.Rewards),
      null,
      20,
    );

    expect(unwrapOk(page)).toEqual({ entries: [], nextBeforeSeq: null });
  });
});

describe('clientJournalPorts — paging', () => {
  it('walks the whole feed through its cursors: every row once, in order', async () => {
    const { pages, cursors } = await walk(
      clientJournalPorts(asDb(seeded())),
      GEORGI,
      JournalFeed.All,
      10,
    );

    expect(pages.map((page) => page.length)).toEqual([10, 10, 10, 9]);
    expect(cursors).toEqual([30, 20, 10, null]);
    expect(pages.flat()).toEqual(
      Array.from({ length: 39 }, (_, index) => 39 - index),
    );
  });

  it('gives no cursor when the rows end exactly where the page does', async () => {
    const fake = seeded();

    const { pages, cursors } = await walk(
      clientJournalPorts(asDb(fake)),
      GEORGI,
      JournalFeed.Points,
      7,
    );

    // 35 rows in pages of 7: five pages, and no sixth read to find it empty.
    expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 7]);
    expect(cursors).toEqual([29, 22, 15, 8, null]);
    expect(fake.reads).toHaveLength(5);
  });

  it.each<JournalFeed>([
    JournalFeed.All,
    JournalFeed.Points,
    JournalFeed.Rewards,
    JournalFeed.Status,
  ])(
    'answers «%s» as the port’s in-memory double does, page for page',
    async (feed) => {
      const adapter = clientJournalPorts(asDb(seeded()));
      const reference = memoryClientJournalPorts(seededEntries());

      for (const limit of [1, 4, 39, 100]) {
        expect(await walk(adapter, GEORGI, feed, limit)).toEqual(
          await walk(reference, GEORGI, feed, limit),
        );
      }
    },
  );
});

describe('clientJournalPorts — what it will not do', () => {
  it('turns a refused read into a failed Result naming the collection and the store’s reason', async () => {
    const fake = seeded().failWith(refusal());

    const page = await clientJournalPorts(asDb(fake)).pageClientJournal(
      GEORGI,
      JournalFeed.effectsOf(JournalFeed.All),
      null,
      20,
    );

    expect(page).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'clientJournal',
        reason: 'permission-denied',
      },
    });
  });
});
