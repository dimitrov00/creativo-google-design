import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import {
  AchievementOp,
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
import type { JournalPage } from '@core/ports';
import { CustomerId, RepositoryErrorCode } from '@core/primitives';
import {
  type LoyaltyClientJson,
  loyaltyAccountFixtures,
  loyaltyAccountJson,
  unwrapOk,
} from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { clientJournalPorts, loyaltyAccountReadPorts } from './loyalty.adapter';

const GEORGI = loyaltyAccountFixtures.georgi.customerId;
const MARTIN = loyaltyAccountFixtures.martin.customerId;

type Body = Readonly<Record<string, unknown>>;

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

/** One more row on Георги's journal, as the engine would write it. */
function above(
  seq: number,
  effect: Body,
  overrides: Body = {},
): [string, Body] {
  return [
    `${GEORGI}_${String(seq).padStart(6, '0')}`,
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
 * Above Георги's 35 point rows: one row of every other effect the feed
 * holds (36 a level, 37 a tier, 38 a reward, 39 an exchange), one the feed
 * never holds (40, the rhythm) and one the client never sees (41, a pause).
 */
const ABOVE: Record<string, Body> = Object.fromEntries([
  above(36, {
    journalEffect: JournalEffect.Achievement,
    achievementRuleId: 'rule-series-rhythm-5',
    achievementRuleVersion: 1,
    achievementAwardKey: 'rule-series-rhythm-5:dev-client-1:once',
    achievementOp: AchievementOp.Granted,
  }),
  above(37, {
    journalEffect: JournalEffect.Tier,
    tierOp: TierOp.Changed,
    tierFrom: 'silver',
    tierTo: 'gold',
    tierUntil: null,
  }),
  above(38, {
    journalEffect: JournalEffect.Reward,
    rewardOp: RewardOp.Granted,
    rewardRef: RewardRef.CouponGrant,
    rewardCouponGrantId: 'grant-free-haircut',
  }),
  above(39, {
    journalEffect: JournalEffect.Redemption,
    redemptionOp: RedemptionOp.Redeemed,
    redemptionId: 'redemption-1',
    redeemedRewardId: 'reward-haircut',
    redemptionCost: 250,
    grantRef: RewardRef.CouponGrant,
    grantCouponGrantId: 'grant-free-haircut',
  }),
  above(40, {
    journalEffect: JournalEffect.Streak,
    streakId: 'cadence',
    streakOp: StreakOp.Extended,
    streakFrom: 24,
    streakTo: 25,
    streakDueBy: '2026-11-09',
  }),
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
    { journalVisibility: JournalVisibility.Staff },
  ),
]);

/**
 * A client record's loyalty against the emulator and the real rules: the
 * account, its progress and its journal, every body written exactly as the
 * fixture files hold it — the flat entity minus its id, keyed by the
 * client record (D29) — and read back as stored.
 */
describe('loyalty adapters (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  async function write(path: string, body: Body) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), path), body);
    });
  }

  /** Writes one account holder's documents exactly as the fixture holds them. */
  async function seed(holder: LoyaltyClientJson) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      const account = `loyaltyAccounts/${holder.customerId}`;
      await setDoc(doc(db, account), holder.account);
      for (const [id, body] of Object.entries(holder.badgeProgress)) {
        await setDoc(doc(db, `${account}/badgeProgress/${id}`), body);
      }
      for (const [id, body] of Object.entries(holder.seasonProgress)) {
        await setDoc(doc(db, `${account}/seasonProgress/${id}`), body);
      }
      for (const [id, body] of Object.entries(holder.clientJournal)) {
        await setDoc(doc(db, 'clientJournal', id), body);
      }
    });
  }

  const as = (context: RulesTestContext) => modularFirestore(context);
  const barber = () =>
    as(testEnv.authenticatedContext('staff-ivan', { roles: ['barber'] }));
  const theClient = () =>
    as(
      testEnv.authenticatedContext(loyaltyAccountFixtures.georgi.uid, {
        roles: ['client'],
      }),
    );

  async function walk(feed: JournalFeed, limit: number, customerId = GEORGI) {
    const ports = clientJournalPorts(barber());
    const pages: number[][] = [];
    const cursors: (number | null)[] = [];
    let before: number | null = null;
    do {
      const page: JournalPage = unwrapOk(
        await ports.pageClientJournal(
          customerId,
          JournalFeed.effectsOf(feed),
          before,
          limit,
        ),
      );
      pages.push(page.entries.map((entry) => entry.seq));
      cursors.push(page.nextBeforeSeq);
      before = page.nextBeforeSeq;
    } while (before !== null && pages.length < 50);
    return { pages, cursors };
  }

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-loyalty');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed(loyaltyAccountJson.georgi);
    await seed(loyaltyAccountJson.martin);
    for (const [id, body] of Object.entries(ABOVE)) {
      await write(`clientJournal/${id}`, body);
    }
  });

  describe('loyaltyAccountReadPorts', () => {
    it('reads the account a barber sees, as stored', async () => {
      const account = unwrapOk(
        await loyaltyAccountReadPorts(barber()).loadLoyaltyAccount(GEORGI),
      );

      expect(account).toEqual(loyaltyAccountFixtures.georgi.account);
      expect(account?.balance).toBe(358);
      expect(account?.tierId).toBe('gold');
    });

    it('reads every started family and every season track', async () => {
      const ports = loyaltyAccountReadPorts(barber());

      expect(unwrapOk(await ports.listBadgeProgress(GEORGI))).toEqual(
        loyaltyAccountFixtures.georgi.badgeProgress,
      );
      expect(unwrapOk(await ports.listSeasonProgress(GEORGI))).toEqual(
        loyaltyAccountFixtures.georgi.seasonProgress,
      );
    });

    it('answers null and empty lists for a client record with no account', async () => {
      const ports = loyaltyAccountReadPorts(barber());
      const nobody = CustomerId.of('cus_nobody');

      expect(unwrapOk(await ports.loadLoyaltyAccount(nobody))).toBeNull();
      expect(unwrapOk(await ports.listBadgeProgress(nobody))).toEqual([]);
      expect(unwrapOk(await ports.listSeasonProgress(nobody))).toEqual([]);
    });

    it('answers a malformed account and progress document as stored (F3-1 b)', async () => {
      await write(`loyaltyAccounts/${GEORGI}`, {
        ...loyaltyAccountJson.georgi.account,
        balance: '358',
      });
      await write(`loyaltyAccounts/${GEORGI}/badgeProgress/series-broken`, {
        value: 'many',
        earned: [],
      });
      const ports = loyaltyAccountReadPorts(barber());

      expect(unwrapOk(await ports.loadLoyaltyAccount(GEORGI))?.balance).toBe(
        '358',
      );
      expect(unwrapOk(await ports.listBadgeProgress(GEORGI))).toHaveLength(
        loyaltyAccountFixtures.georgi.badgeProgress.length + 1,
      );
    });

    it('is refused for the client themselves and for a content manager (§4.5)', async () => {
      const own = loyaltyAccountReadPorts(theClient());
      const copy = loyaltyAccountReadPorts(
        as(
          testEnv.authenticatedContext('copy-1', {
            roles: ['content_manager'],
          }),
        ),
      );

      expect(await own.loadLoyaltyAccount(GEORGI)).toMatchObject({
        ok: false,
        error: { errorCode: RepositoryErrorCode.ReadFailed },
      });
      expect((await copy.listBadgeProgress(GEORGI)).ok).toBe(false);
    });
  });

  describe('clientJournalPorts', () => {
    it('hands over «Всички» newest first, whatever the rows moved, and never the rhythm’s or a staff row', async () => {
      const page = unwrapOk(
        await clientJournalPorts(barber()).pageClientJournal(
          GEORGI,
          JournalFeed.effectsOf(JournalFeed.All),
          null,
          5,
        ),
      );

      expect(page.entries.map((entry) => entry.seq)).toEqual([
        39, 38, 37, 36, 35,
      ]);
      expect(page.entries.map((entry) => entry.journalEffect)).toEqual([
        JournalEffect.Redemption,
        JournalEffect.Reward,
        JournalEffect.Tier,
        JournalEffect.Achievement,
        JournalEffect.Points,
      ]);
      expect(page.nextBeforeSeq).toBe(35);
      expect(page.entries[4]).toEqual(
        loyaltyAccountFixtures.georgi.clientJournal.at(-1),
      );
    });

    it('walks the whole feed through its cursors: every row once, in order', async () => {
      const { pages, cursors } = await walk(JournalFeed.All, 10);

      expect(pages.map((page) => page.length)).toEqual([10, 10, 10, 9]);
      expect(cursors).toEqual([30, 20, 10, null]);
      expect(pages.flat()).toEqual(
        Array.from({ length: 39 }, (_, index) => 39 - index),
      );
    });

    it('gives no cursor when the rows end exactly where the page does', async () => {
      const { pages, cursors } = await walk(JournalFeed.Points, 7);

      expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 7]);
      expect(cursors).toEqual([29, 22, 15, 8, null]);
    });

    it.each<[JournalFeed, number[]]>([
      [JournalFeed.Rewards, [39, 38]],
      [JournalFeed.Status, [37]],
    ])('reads «%s» as its own effects alone', async (feed, expected) => {
      const { pages } = await walk(feed, 20);

      expect(pages).toEqual([expected]);
    });

    it('never hands one client record another’s rows', async () => {
      const { pages } = await walk(JournalFeed.All, 50, MARTIN);

      expect(pages.flat()).toEqual(
        Array.from({ length: 18 }, (_, index) => 18 - index),
      );
    });

    it('is refused to the client, and to an anonymous visitor', async () => {
      const effects = JournalFeed.effectsOf(JournalFeed.All);
      const client = clientJournalPorts(theClient());
      const anonymous = clientJournalPorts(
        as(testEnv.unauthenticatedContext()),
      );

      expect(
        (await client.pageClientJournal(GEORGI, effects, null, 20)).ok,
      ).toBe(false);
      expect(
        (await anonymous.pageClientJournal(GEORGI, effects, null, 20)).ok,
      ).toBe(false);
    });
  });
});
