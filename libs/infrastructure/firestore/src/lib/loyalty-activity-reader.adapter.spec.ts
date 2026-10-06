import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import type { Result } from '@creativo/domain/kernel';
import {
  type ActivityEntry,
  type ActivityKind,
  type ClientJournalEntryDocument,
  type JournalEffectDocument,
  type LoyaltyActivityPage,
  clientJournalEntryId,
} from '@creativo/application/engagement';
import {
  InMemoryLoyaltyActivityReader,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import { RepositoryError } from '@creativo/application/shared';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

import { FirestoreLoyaltyActivityReader } from './loyalty-activity-reader.adapter';

const GEORGI = 'dev-client-1';
const MARTIN = 'dev-client-2';

type Journal = Readonly<Record<string, ClientJournalEntryDocument>>;

const newestOf = (journal: Journal): ClientJournalEntryDocument => {
  const newest = Object.values(journal).sort((a, b) => b.seq - a.seq)[0];
  if (newest === undefined) throw new Error('an empty journal');
  return newest;
};

/** One more row on a journal, written as the engine would have: the newest row with another effect. */
function row(
  journal: Journal,
  seq: number,
  effect: JournalEffectDocument,
  code: ClientJournalEntryDocument['publicLabel']['code'],
  overrides: Partial<ClientJournalEntryDocument> = {},
): Journal {
  const like = newestOf(journal);
  return {
    ...journal,
    [clientJournalEntryId(like.userId, seq)]: {
      ...like,
      seq,
      effect,
      correlationId: `event-${seq}`,
      publicLabel: { code, params: {} },
      ...overrides,
    },
  };
}

/**
 * Георги's 35 point rows, and above them one row of every other effect
 * the feed holds, two the feed never holds, and one the client never
 * sees:
 *
 * 36 a level earned · 37 a tier reached · 38 a reward given ·
 * 39 points exchanged · 40 the rhythm (never in the feed) ·
 * 41 a pause, staff-only · 42 a protection (never in the feed).
 */
function georgisJournal(): Journal {
  let journal: Journal = loyaltyFixtures.georgi.clientJournal;
  journal = row(
    journal,
    36,
    {
      kind: 'achievement',
      rule: { ruleId: 'rule-series-rhythm-5', version: 1 },
      awardKey: 'rule-series-rhythm-5:dev-client-1:once',
      op: 'granted',
    },
    'achievement.earned',
  );
  journal = row(
    journal,
    37,
    { kind: 'tier', op: 'changed', from: 'silver', to: 'gold', until: null },
    'tier.changed',
  );
  journal = row(
    journal,
    38,
    {
      kind: 'reward',
      op: 'granted',
      ref: { kind: 'couponGrant', id: 'grant-free-haircut' },
    },
    'reward.granted',
  );
  journal = row(
    journal,
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
  );
  journal = row(
    journal,
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
  );
  journal = row(
    journal,
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
    { visibility: 'staff' },
  );
  journal = row(
    journal,
    42,
    {
      kind: 'freeze',
      streakId: 'cadence',
      op: 'earned',
      count: 1,
      bankedAfter: 2,
    },
    'freeze.changed',
  );
  return journal;
}

function documentsOf(...journals: Journal[]): Record<string, Journal[string]> {
  return Object.fromEntries(
    journals.flatMap((journal) =>
      Object.entries(journal).map(([id, entry]) => [
        `clientJournal/${id}`,
        entry,
      ]),
    ),
  );
}

function seeded(): FakeFirestore {
  return new FakeFirestore(
    documentsOf(georgisJournal(), loyaltyFixtures.martin.clientJournal),
  );
}

function setUp(db: FakeFirestore = seeded()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestoreLoyaltyActivityReader,
    ],
  });
  return { db, reader: TestBed.inject(FirestoreLoyaltyActivityReader) };
}

const seqs = (entries: readonly ActivityEntry[]) => entries.map((e) => e.seq);

/** Every page of a pill, walked through `next` until there is none. */
async function walk(
  reader: FirestoreLoyaltyActivityReader | InMemoryLoyaltyActivityReader,
  userId: string,
  kind: ActivityKind,
  limit: number,
): Promise<{ pages: number[][]; cursors: (number | null)[] }> {
  const pages: number[][] = [];
  const cursors: (number | null)[] = [];
  let after: number | null = null;
  do {
    const page: Result<LoyaltyActivityPage, RepositoryError> =
      await reader.page(userId, { kind, limit, after });
    if (page.isFailure()) throw page.error;
    pages.push(seqs(page.value.entries));
    cursors.push(page.value.next);
    after = page.value.next;
  } while (after !== null && pages.length < 50);
  return { pages, cursors };
}

describe('FirestoreLoyaltyActivityReader', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('the query', () => {
    it('names the client, the visibility the rule demands, the pill’s effects, the order and one row more than asked', async () => {
      const { reader, db } = setUp();

      await reader.page(GEORGI, { kind: 'all', limit: 20, after: null });

      expect(db.reads).toEqual([
        {
          kind: 'query',
          path: 'clientJournal',
          constraints: [
            'userId == "dev-client-1"',
            'visibility == "client"',
            'effect.kind in ["points","achievement","tier","reward","redemption"]',
            'orderBy seq desc',
            'limit 21',
          ],
        },
      ]);
    });

    it.each<[ActivityKind, string]>([
      ['points', 'effect.kind == "points"'],
      ['rewards', 'effect.kind in ["reward","redemption"]'],
      ['status', 'effect.kind == "tier"'],
    ])('asks «%s» for its own effects: %s', async (kind, constraint) => {
      const { reader, db } = setUp();

      await reader.page(GEORGI, { kind, limit: 5, after: null });

      expect(db.reads[0]?.constraints[2]).toBe(constraint);
    });

    it('starts after the cursor on a later page', async () => {
      const { reader, db } = setUp();

      await reader.page(GEORGI, { kind: 'points', limit: 5, after: 31 });

      expect(db.reads[0]?.constraints).toEqual([
        'userId == "dev-client-1"',
        'visibility == "client"',
        'effect.kind == "points"',
        'orderBy seq desc',
        'startAfter 31',
        'limit 6',
      ]);
    });

    it.each([0, -2, Number.NaN, 3.7])(
      'asks for a whole page of at least one row, whatever was asked (%s)',
      async (limit) => {
        const { reader, db } = setUp();

        const page = await reader.page(GEORGI, {
          kind: 'points',
          limit,
          after: null,
        });

        expect(db.reads[0]?.constraints.at(-1)).toBe(
          limit === 3.7 ? 'limit 4' : 'limit 2',
        );
        expect(page.isSuccess() && page.value.entries).toHaveLength(
          limit === 3.7 ? 3 : 1,
        );
      },
    );
  });

  describe('«Всички»', () => {
    it('hands over the newest rows first, one per journal entry, whatever they moved', async () => {
      const { reader } = setUp();

      const page = await reader.page(GEORGI, {
        kind: 'all',
        limit: 6,
        after: null,
      });

      if (page.isFailure()) throw page.error;
      expect(seqs(page.value.entries)).toEqual([39, 38, 37, 36, 35, 34]);
      expect(page.value.entries.map((entry) => entry.effect)).toEqual([
        { kind: 'redemption', op: 'redeemed', cost: 250 },
        { kind: 'reward', op: 'granted' },
        { kind: 'tier', from: 'silver', to: 'gold' },
        { kind: 'achievement', op: 'granted' },
        { kind: 'points', delta: 17, balanceAfter: 358 },
        expect.objectContaining({ kind: 'points' }),
      ]);
      expect(page.value.next).toBe(34);
    });

    it('never reads the rhythm’s rows, a protection or a staff row', async () => {
      const { reader } = setUp();

      const { pages } = await walk(reader, GEORGI, 'all', 50);

      const read = pages.flat();
      expect(read).toHaveLength(39);
      expect(read).not.toContain(40);
      expect(read).not.toContain(41);
      expect(read).not.toContain(42);
    });

    it('carries what ties the rows of one event together, and the balance after a point row', async () => {
      const { reader } = setUp();

      const page = await reader.page(GEORGI, {
        kind: 'points',
        limit: 1,
        after: null,
      });

      if (page.isFailure()) throw page.error;
      expect(page.value.entries[0]).toMatchObject({
        id: 'dev-client-1_000035',
        seq: 35,
        at: new Date('2026-09-28T07:45:00.000Z'),
        correlationId: 'appt:appt-dev-1:seat:seat-1',
        effect: { kind: 'points', delta: 17, balanceAfter: 358 },
        label: { code: 'points.rule' },
        reverses: null,
      });
    });

    it('never hands one client another’s rows', async () => {
      const { reader } = setUp();

      const { pages } = await walk(reader, MARTIN, 'all', 50);

      expect(pages.flat()).toEqual(
        Array.from({ length: 18 }, (_, index) => 18 - index),
      );
    });
  });

  describe('the pills', () => {
    it('«Точки» is the point rows alone', async () => {
      const { reader } = setUp();

      const page = await reader.page(GEORGI, {
        kind: 'points',
        limit: 3,
        after: null,
      });

      expect(page.isSuccess() && seqs(page.value.entries)).toEqual([
        35, 34, 33,
      ]);
      expect(page.isSuccess() && page.value.next).toBe(33);
    });

    it('«Награди» is what was given and what was exchanged', async () => {
      const { reader } = setUp();

      const page = await reader.page(GEORGI, {
        kind: 'rewards',
        limit: 20,
        after: null,
      });

      expect(page.isSuccess() && seqs(page.value.entries)).toEqual([39, 38]);
      expect(page.isSuccess() && page.value.next).toBeNull();
    });

    it('«Статус» is the tier’s rows', async () => {
      const { reader } = setUp();

      const page = await reader.page(GEORGI, {
        kind: 'status',
        limit: 20,
        after: null,
      });

      expect(page.isSuccess() && seqs(page.value.entries)).toEqual([37]);
    });

    it('is an empty page, never an error, under a pill that holds nothing', async () => {
      const { reader } = setUp();

      const page = await reader.page(MARTIN, {
        kind: 'rewards',
        limit: 20,
        after: null,
      });

      expect(page.isSuccess() && page.value).toEqual({
        entries: [],
        next: null,
      });
    });
  });

  describe('paging', () => {
    it('walks the whole feed through its cursors: every row once, in order', async () => {
      const { reader } = setUp();

      const { pages, cursors } = await walk(reader, GEORGI, 'all', 10);

      expect(pages.map((page) => page.length)).toEqual([10, 10, 10, 9]);
      expect(cursors).toEqual([30, 20, 10, null]);
      expect(pages.flat()).toEqual(
        Array.from({ length: 39 }, (_, index) => 39 - index),
      );
    });

    it('gives no cursor when the rows end exactly where the page does', async () => {
      const { reader, db } = setUp();

      const { pages, cursors } = await walk(reader, GEORGI, 'points', 7);

      // 35 rows in pages of 7: five pages, and no sixth read to find it empty.
      expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 7]);
      expect(cursors).toEqual([29, 22, 15, 8, null]);
      expect(db.reads).toHaveLength(5);
    });

    it.each<ActivityKind>(['all', 'points', 'rewards', 'status'])(
      'answers «%s» as the port’s reference does, page for page',
      async (kind) => {
        const { reader } = setUp();
        const reference = new InMemoryLoyaltyActivityReader({
          [GEORGI]: georgisJournal(),
          [MARTIN]: loyaltyFixtures.martin.clientJournal,
        });

        for (const limit of [1, 4, 39, 100]) {
          expect(await walk(reader, GEORGI, kind, limit)).toEqual(
            await walk(reference, GEORGI, kind, limit),
          );
        }
      },
    );
  });

  describe('what it will not do', () => {
    it('leaves out a row that does not parse, and still moves past it', async () => {
      const db = seeded();
      const path = 'clientJournal/dev-client-1_000033';
      // What ties a row to its event is gone: the row is no row.
      const { reader } = setUp(
        db.set(path, { ...db.documentAt(path), correlationId: '' }),
      );

      const first = await reader.page(GEORGI, {
        kind: 'points',
        limit: 3,
        after: null,
      });
      if (first.isFailure()) throw first.error;
      // 35, 34 and the broken 33 were read: two rows, and a cursor past all three.
      expect(seqs(first.value.entries)).toEqual([35, 34]);
      expect(first.value.next).toBe(33);

      const second = await reader.page(GEORGI, {
        kind: 'points',
        limit: 3,
        after: first.value.next,
      });
      expect(second.isSuccess() && seqs(second.value.entries)).toEqual([
        32, 31, 30,
      ]);
    });

    it('refuses a pill nobody knows rather than read it as «Всички»', async () => {
      const { reader, db } = setUp();

      const page = await reader.page(GEORGI, {
        kind: 'rhythm' as ActivityKind,
        limit: 20,
        after: null,
      });

      expect(page.isFailure() && page.error).toBeInstanceOf(RepositoryError);
      expect(db.reads).toEqual([]);
    });

    it('reads nothing for no one', async () => {
      const { reader, db } = setUp();

      const page = await reader.page('  ', {
        kind: 'all',
        limit: 20,
        after: null,
      });

      expect(page.isSuccess() && page.value).toEqual({
        entries: [],
        next: null,
      });
      expect(db.reads).toEqual([]);
    });

    it('turns a refused read into a failed Result', async () => {
      const { reader, db } = setUp();
      const refusal = Object.assign(new Error('Missing permissions'), {
        code: 'permission-denied',
      });
      db.failWith(refusal);

      const page = await reader.page(GEORGI, {
        kind: 'all',
        limit: 20,
        after: null,
      });

      expect(page.isFailure() && page.error).toBeInstanceOf(RepositoryError);
      expect(page.isFailure() && page.error.cause).toBe(refusal);
    });
  });
});
