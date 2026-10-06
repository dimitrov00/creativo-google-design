import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  type ActivityKind,
  type ClientJournalEntryDocument,
  type JournalEffectDocument,
  clientJournalEntryId,
} from '@creativo/application/engagement';
import { loyaltyFixtures } from '@creativo/application/engagement/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreLoyaltyActivityReader } from './loyalty-activity-reader.adapter';

const GEORGI = 'dev-client-1';
const MARTIN = 'dev-client-2';

function readerFor(context: RulesTestContext): FirestoreLoyaltyActivityReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreLoyaltyActivityReader,
    ],
  });
  return TestBed.inject(FirestoreLoyaltyActivityReader);
}

/**
 * «Движение» against the emulator and the real rules: Георги's 35 point
 * rows and Мартин's 18, and above Георги's one row of every other effect
 * the feed holds (36 a level, 37 a tier, 38 a reward, 39 an exchange),
 * one the feed never holds (40, the rhythm) and one the client never sees
 * (41, a pause).
 */
describe('FirestoreLoyaltyActivityReader (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  async function write(entries: Readonly<Record<string, object>>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const [id, entry] of Object.entries(entries)) {
        await setDoc(doc(modularFirestore(ctx), 'clientJournal', id), entry);
      }
    });
  }

  function above(
    seq: number,
    effect: JournalEffectDocument,
    code: ClientJournalEntryDocument['publicLabel']['code'],
    visibility: 'client' | 'staff' = 'client',
  ): Readonly<Record<string, ClientJournalEntryDocument>> {
    const like = loyaltyFixtures.georgi.clientJournal[`${GEORGI}_000035`];
    if (like === undefined) throw new Error('fixture: no last row');
    return {
      [clientJournalEntryId(GEORGI, seq)]: {
        ...like,
        seq,
        effect,
        visibility,
        correlationId: `event-${seq}`,
        publicLabel: { code, params: {} },
      },
    };
  }

  const barber = () =>
    readerFor(
      testEnv.authenticatedContext('staff-ivan', { roles: ['barber'] }),
    );

  async function walk(kind: ActivityKind, limit: number, userId = GEORGI) {
    const reader = barber();
    const pages: number[][] = [];
    const cursors: (number | null)[] = [];
    let after: number | null = null;
    do {
      const page = await reader.page(userId, { kind, limit, after });
      if (page.isFailure()) throw page.error;
      pages.push(page.value.entries.map((entry) => entry.seq));
      cursors.push(page.value.next);
      after = page.value.next;
    } while (after !== null && pages.length < 50);
    return { pages, cursors };
  }

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-loyalty-activity');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await write(loyaltyFixtures.georgi.clientJournal);
    await write(loyaltyFixtures.martin.clientJournal);
    await write(
      above(
        36,
        {
          kind: 'achievement',
          rule: { ruleId: 'rule-series-rhythm-5', version: 1 },
          awardKey: 'rule-series-rhythm-5:dev-client-1:once',
          op: 'granted',
        },
        'achievement.earned',
      ),
    );
    await write(
      above(
        37,
        {
          kind: 'tier',
          op: 'changed',
          from: 'silver',
          to: 'gold',
          until: null,
        },
        'tier.changed',
      ),
    );
    await write(
      above(
        38,
        {
          kind: 'reward',
          op: 'granted',
          ref: { kind: 'couponGrant', id: 'grant-free-haircut' },
        },
        'reward.granted',
      ),
    );
    await write(
      above(
        39,
        {
          kind: 'redemption',
          op: 'redeemed',
          redemptionId: 'redemption-1',
          rewardId: 'reward-haircut',
          cost: 250,
          grant: { kind: 'couponGrant', id: 'grant-free-haircut' },
        },
        'redemption.changed',
      ),
    );
    await write(
      above(
        40,
        {
          kind: 'streak',
          streakId: 'cadence',
          op: 'extended',
          from: 24,
          to: 25,
          dueBy: '2026-11-09',
        },
        'streak.changed',
      ),
    );
    await write(
      above(
        41,
        {
          kind: 'pause',
          op: 'applied',
          pauseId: 'pause-1',
          term: { kind: 'permanent' },
          scope: 'allBookings',
          prior: null,
        },
        'pause.changed',
        'staff',
      ),
    );
  });

  it('hands over «Всички» newest first, whatever the rows moved, and never the rhythm’s or a staff row', async () => {
    const page = await barber().page(GEORGI, {
      kind: 'all',
      limit: 5,
      after: null,
    });

    if (page.isFailure()) throw page.error;
    expect(page.value.entries.map((entry) => entry.seq)).toEqual([
      39, 38, 37, 36, 35,
    ]);
    expect(page.value.entries.map((entry) => entry.effect)).toEqual([
      { kind: 'redemption', op: 'redeemed', cost: 250 },
      { kind: 'reward', op: 'granted' },
      { kind: 'tier', from: 'silver', to: 'gold' },
      { kind: 'achievement', op: 'granted' },
      { kind: 'points', delta: 17, balanceAfter: 358 },
    ]);
    expect(page.value.next).toBe(35);
    expect(page.value.entries[4]?.at).toBeInstanceOf(Date);
  });

  it('walks the whole feed through its cursors: every row once, in order', async () => {
    const { pages, cursors } = await walk('all', 10);

    expect(pages.map((page) => page.length)).toEqual([10, 10, 10, 9]);
    expect(cursors).toEqual([30, 20, 10, null]);
    expect(pages.flat()).toEqual(
      Array.from({ length: 39 }, (_, index) => 39 - index),
    );
  });

  it('gives no cursor when the rows end exactly where the page does', async () => {
    const { pages, cursors } = await walk('points', 7);

    expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 7]);
    expect(cursors).toEqual([29, 22, 15, 8, null]);
  });

  it.each<[ActivityKind, number[]]>([
    ['rewards', [39, 38]],
    ['status', [37]],
  ])('reads «%s» as its own effects alone', async (kind, expected) => {
    const { pages } = await walk(kind, 20);

    expect(pages).toEqual([expected]);
  });

  it('never hands one client another’s rows', async () => {
    const { pages } = await walk('all', 50, MARTIN);

    expect(pages.flat()).toEqual(
      Array.from({ length: 18 }, (_, index) => 18 - index),
    );
  });

  it('is refused to the client, and to an anonymous visitor', async () => {
    const client = readerFor(
      testEnv.authenticatedContext(GEORGI, { roles: ['client'] }),
    );
    const anonymous = readerFor(testEnv.unauthenticatedContext());
    const query = { kind: 'all', limit: 20, after: null } as const;

    expect((await client.page(GEORGI, query)).isFailure()).toBe(true);
    expect((await anonymous.page(GEORGI, query)).isFailure()).toBe(true);
  });
});
