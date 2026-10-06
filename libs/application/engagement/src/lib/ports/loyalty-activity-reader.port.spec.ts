import { describe, expect, it } from 'vitest';
import type { ActivityKind } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';
import {
  type ClientJournalFixture,
  InMemoryLoyaltyActivityReader,
  loyaltyFixtures,
} from '../../testing';
import {
  type LoyaltyActivityPage,
  LOYALTY_ACTIVITY_READER,
} from './loyalty-activity-reader.port';
import {
  type ClientJournalEntryDocument,
  type JournalEffectDocument,
  clientJournalEntryId,
} from './loyalty-document';

const GEORGI = 'dev-client-1';
const MARTIN = 'dev-client-2';

const seqs = (page: LoyaltyActivityPage) => page.entries.map((row) => row.seq);
const kinds = (page: LoyaltyActivityPage) =>
  page.entries.map((row) => row.effect.kind);

/** Георги's newest row: the mould every row below is cast from. */
const NEWEST = (() => {
  const row = loyaltyFixtures.georgi.clientJournal['dev-client-1_000035'];
  if (row === undefined) throw new Error('fixture: no last row');
  return row;
})();

/** A journal row after the fixture's 35, as the engine would have written it. */
function row(
  seq: number,
  effect: JournalEffectDocument,
  code: ClientJournalEntryDocument['publicLabel']['code'],
  more: Partial<ClientJournalEntryDocument> = {},
): [string, ClientJournalEntryDocument] {
  return [
    clientJournalEntryId(GEORGI, seq),
    {
      ...NEWEST,
      seq,
      effect,
      correlationId: `event-${seq}`,
      idempotencyKey: `event-${seq}#0`,
      publicLabel: { code, params: {} },
      ...more,
    },
  ];
}

/**
 * Георги's 35 point rows, then one redemption told in three entries (the
 * points it cost, the redemption, the reward it granted), a tier change,
 * a medal, and four rows the feed never shows.
 */
const RICH: ClientJournalFixture = {
  ...loyaltyFixtures.georgi.clientJournal,
  ...Object.fromEntries([
    row(36, { kind: 'points', delta: -120 }, 'points.redeemed', {
      correlationId: 'redemption-1',
      balanceAfter: 238,
    }),
    row(
      37,
      {
        kind: 'redemption',
        op: 'redeemed',
        redemptionId: 'redemption-1',
        rewardId: 'reward-beard-trim',
        cost: 120,
        grant: { kind: 'couponGrant', id: 'grant-1' },
      },
      'redemption.changed',
      { correlationId: 'redemption-1', balanceAfter: 238 },
    ),
    row(
      38,
      {
        kind: 'reward',
        op: 'granted',
        ref: { kind: 'couponGrant', id: 'grant-1' },
      },
      'reward.granted',
      { correlationId: 'redemption-1', balanceAfter: 238 },
    ),
    row(
      39,
      {
        kind: 'tier',
        op: 'changed',
        from: 'gold',
        to: 'platinum',
        until: null,
      },
      'tier.changed',
      { balanceAfter: 238 },
    ),
    row(
      40,
      {
        kind: 'achievement',
        rule: { ruleId: 'rule-series-rhythm-5', version: 1 },
        awardKey: 'rule-series-rhythm-5:dev-client-1:once',
        op: 'granted',
      },
      'achievement.earned',
      { balanceAfter: 238 },
    ),
    // Never in the feed: the rhythm's own rows, and what only staff see.
    row(
      41,
      {
        kind: 'streak',
        streakId: 'cadence',
        op: 'extended',
        from: 24,
        to: 25,
        dueBy: '2026-12-21',
      },
      'streak.changed',
      { balanceAfter: 238 },
    ),
    row(
      42,
      {
        kind: 'freeze',
        streakId: 'cadence',
        op: 'earned',
        count: 1,
        bankedAfter: 2,
      },
      'freeze.changed',
      { balanceAfter: 238 },
    ),
    row(43, { kind: 'points', delta: 50 }, 'points.goodwill', {
      visibility: 'staff',
      balanceAfter: 288,
    }),
    row(
      44,
      {
        kind: 'visitOutcome',
        appointmentId: 'appt-hist-c1-01',
        seatId: 'appt-hist-c1-01-s1',
        from: 'no_show',
        to: 'worked',
        revision: 2,
      },
      'visit.outcomeCorrected',
      { balanceAfter: 288 },
    ),
  ]),
};

const rich = () => new InMemoryLoyaltyActivityReader({ [GEORGI]: RICH });

async function pageOf(
  reader: InMemoryLoyaltyActivityReader,
  kind: ActivityKind,
  limit: number,
  after: number | null = null,
  userId = GEORGI,
): Promise<LoyaltyActivityPage> {
  const page = await reader.page(userId, { kind, limit, after });
  if (page.isFailure()) throw page.error;
  return page.value;
}

/**
 * The port's reference (`@creativo/application/engagement/testing`), held
 * to the port's promises, the ones the Firestore adapter's query keeps
 * too: client-visible rows of the pill's effects, newest first, a page at
 * a time, a row per journal entry.
 */
describe('LoyaltyActivityReader — the in-memory reference', () => {
  it('names its token', () => {
    expect(LOYALTY_ACTIVITY_READER.toString()).toContain(
      'LoyaltyActivityReader',
    );
  });

  describe('over the fixtures, which hold point rows', () => {
    it('reads the newest rows first, as many as asked', async () => {
      const reader = InMemoryLoyaltyActivityReader.seeded();
      const page = await pageOf(reader, 'all', 5);
      expect(seqs(page)).toEqual([35, 34, 33, 32, 31]);
      expect(page.next).toBe(31);
      expect(new Set(kinds(page))).toEqual(new Set(['points']));
    });

    it('carries on each row the event it belongs to and the balance after it', async () => {
      const page = await pageOf(
        InMemoryLoyaltyActivityReader.seeded(),
        'all',
        1,
      );
      const [newest] = page.entries;
      expect(newest).toMatchObject({
        id: 'dev-client-1_000035',
        seq: 35,
        correlationId: NEWEST.correlationId,
        effect: {
          kind: 'points',
          balanceAfter: loyaltyFixtures.georgi.account.balance,
        },
        label: { code: NEWEST.publicLabel.code },
        reverses: null,
      });
      expect(newest?.at.toISOString()).toBe(NEWEST.at);
    });

    it('answers the same under «Точки», and nothing under the other two pills', async () => {
      const reader = InMemoryLoyaltyActivityReader.seeded();
      expect(seqs(await pageOf(reader, 'points', 3))).toEqual([35, 34, 33]);
      expect(await pageOf(reader, 'rewards', 3)).toEqual({
        entries: [],
        next: null,
      });
      expect(await pageOf(reader, 'status', 3)).toEqual({
        entries: [],
        next: null,
      });
    });

    it('keeps one client’s rows from another’s', async () => {
      const reader = InMemoryLoyaltyActivityReader.seeded();
      const page = await pageOf(reader, 'all', 100, null, MARTIN);
      expect(page.entries).toHaveLength(
        Object.keys(loyaltyFixtures.martin.clientJournal).length,
      );
      expect(page.entries.every((row) => row.id.startsWith(MARTIN))).toBe(true);
      expect(page.next).toBeNull();
    });
  });

  describe('paging', () => {
    it('walks the whole feed in pages, strictly older than the cursor, until nothing is left', async () => {
      const reader = InMemoryLoyaltyActivityReader.seeded();
      const walked: number[] = [];
      let after: number | null = null;
      let pages = 0;
      do {
        const page: LoyaltyActivityPage = await pageOf(
          reader,
          'all',
          10,
          after,
        );
        expect(page.entries.length).toBeLessThanOrEqual(10);
        walked.push(...seqs(page));
        after = page.next;
        pages += 1;
      } while (after !== null);
      expect(pages).toBe(4);
      expect(walked).toEqual(Array.from({ length: 35 }, (_, i) => 35 - i));
      expect(reader.calls.map((call) => call.after)).toEqual([null, 26, 16, 6]);
    });

    it('gives no cursor when a page ends exactly on the oldest row', async () => {
      const reader = InMemoryLoyaltyActivityReader.seeded();
      const page = await pageOf(reader, 'all', 5, 6);
      expect(seqs(page)).toEqual([5, 4, 3, 2, 1]);
      expect(page.next).toBeNull();
      expect((await pageOf(reader, 'all', 35)).next).toBeNull();
    });

    it('reads nothing past the oldest row', async () => {
      const page = await pageOf(
        InMemoryLoyaltyActivityReader.seeded(),
        'all',
        5,
        1,
      );
      expect(page).toEqual({ entries: [], next: null });
    });

    it('reads a page of one for a limit that is none', async () => {
      const page = await pageOf(
        InMemoryLoyaltyActivityReader.seeded(),
        'all',
        0,
      );
      expect(seqs(page)).toEqual([35]);
      expect(page.next).toBe(35);
    });
  });

  describe('over a journal that holds every kind', () => {
    it('reads the feed’s five effects under «Всички», and none of the rest', async () => {
      const page = await pageOf(rich(), 'all', 6);
      expect(page.entries.map((row) => [row.seq, row.effect.kind])).toEqual([
        [40, 'achievement'],
        [39, 'tier'],
        [38, 'reward'],
        [37, 'redemption'],
        [36, 'points'],
        [35, 'points'],
      ]);
      expect(page.next).toBe(35);
    });

    it('cuts each effect to what a row prints', async () => {
      const page = await pageOf(rich(), 'all', 5);
      expect(page.entries.map((row) => row.effect)).toEqual([
        { kind: 'achievement', op: 'granted' },
        { kind: 'tier', from: 'gold', to: 'platinum' },
        { kind: 'reward', op: 'granted' },
        { kind: 'redemption', op: 'redeemed', cost: 120 },
        { kind: 'points', delta: -120, balanceAfter: 238 },
      ]);
    });

    it('hands over a row per entry: the three of one redemption share its event', async () => {
      const page = await pageOf(rich(), 'all', 3, 39);
      expect(page.entries.map((row) => [row.seq, row.correlationId])).toEqual([
        [38, 'redemption-1'],
        [37, 'redemption-1'],
        [36, 'redemption-1'],
      ]);
    });

    it('may end a page inside an event: the cursor is a row’s, never an event’s', async () => {
      const first = await pageOf(rich(), 'all', 4);
      expect(seqs(first)).toEqual([40, 39, 38, 37]);
      expect(first.next).toBe(37);
      const second = await pageOf(rich(), 'all', 4, first.next);
      expect(second.entries[0]).toMatchObject({
        seq: 36,
        correlationId: 'redemption-1',
      });
    });

    it('reads each pill’s own effects', async () => {
      const reader = rich();
      const rewards = await pageOf(reader, 'rewards', 10);
      expect(rewards.entries.map((row) => [row.seq, row.effect.kind])).toEqual([
        [38, 'reward'],
        [37, 'redemption'],
      ]);
      expect(rewards.next).toBeNull();
      const status = await pageOf(reader, 'status', 10);
      expect(status.entries.map((row) => [row.seq, row.effect.kind])).toEqual([
        [39, 'tier'],
      ]);
      const points = await pageOf(reader, 'points', 2);
      expect(seqs(points)).toEqual([36, 35]);
      expect(points.next).toBe(35);
    });

    it('pages a pill by the journal’s own sequence, gaps and all', async () => {
      const reader = rich();
      const first = await pageOf(reader, 'rewards', 1);
      expect(seqs(first)).toEqual([38]);
      expect(first.next).toBe(38);
      const second = await pageOf(reader, 'rewards', 1, first.next);
      expect(seqs(second)).toEqual([37]);
      expect(second.next).toBeNull();
    });

    it('never shows a row only the staff may see', async () => {
      const all = await pageOf(rich(), 'all', 100);
      expect(seqs(all)).not.toContain(43);
      expect(seqs(all).slice(0, 2)).toEqual([40, 39]);
      expect(all.entries).toHaveLength(40);
    });
  });

  it('answers an empty page for a client with no journal', async () => {
    const page = await pageOf(
      InMemoryLoyaltyActivityReader.seeded(),
      'all',
      20,
      null,
      'dev-client-9',
    );
    expect(page).toEqual({ entries: [], next: null });
  });

  it('seeds a journal under any uid, and replaces one', async () => {
    const reader = InMemoryLoyaltyActivityReader.seeded()
      .put('client-under-test', loyaltyFixtures.martin.clientJournal)
      .put(GEORGI, RICH);
    const moved = await pageOf(reader, 'all', 1, null, 'client-under-test');
    // The rows keep their own ids: the journal follows its key.
    expect(moved.entries[0]?.id).toBe(
      Object.keys(loyaltyFixtures.martin.clientJournal).at(-1),
    );
    expect(moved.entries[0]?.id.startsWith(MARTIN)).toBe(true);
    expect(seqs(await pageOf(reader, 'all', 1))).toEqual([40]);
  });

  it('fails a page that holds a malformed row, as the adapter would', async () => {
    const reader = new InMemoryLoyaltyActivityReader({
      [GEORGI]: {
        ...loyaltyFixtures.georgi.clientJournal,
        ...Object.fromEntries([
          row(36, { kind: 'points', delta: 1.5 }, 'points.goodwill'),
        ]),
      },
    });
    const page = await reader.page(GEORGI, {
      kind: 'all',
      limit: 5,
      after: null,
    });
    expect(page.isFailure() && page.error.message).toBe(
      'Malformed clientJournal/dev-client-1_000036.effect.delta',
    );
    // A page the row is not on reads.
    expect(seqs(await pageOf(reader, 'all', 5, 36))).toEqual([
      35, 34, 33, 32, 31,
    ]);
  });

  it('fails while told to, and records every page asked for', async () => {
    const reader = InMemoryLoyaltyActivityReader.seeded().failWith();
    const failed = await reader.page(GEORGI, {
      kind: 'all',
      limit: 20,
      after: null,
    });
    expect(failed.isFailure() && failed.error).toBeInstanceOf(RepositoryError);
    reader.recover();
    await pageOf(reader, 'rewards', 10, 12, MARTIN);
    expect(reader.calls).toEqual([
      { userId: GEORGI, kind: 'all', limit: 20, after: null },
      { userId: MARTIN, kind: 'rewards', limit: 10, after: 12 },
    ]);
  });
});
