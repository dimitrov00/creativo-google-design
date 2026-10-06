import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { UserId } from '@creativo/domain/accounts';
import { AppointmentId } from '@creativo/domain/scheduling';
import {
  type ClientStatsDirectory,
  type ClientStatsPage,
  type ClientStatsRecord,
  clientMoneyToDocument,
  clientStatsToDocument,
} from '@creativo/application/booking';
import { InMemoryClientStatsDirectory } from '@creativo/application/booking/testing';
import { RepositoryError } from '@creativo/application/shared';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

import { FirestoreClientStatsDirectory } from './client-stats-directory.adapter';

const LAST = Date.parse('2026-09-28T07:00:00.000Z');
const DAY_MS = 86_400_000;

function userId(raw: string): UserId {
  const id = UserId.create(raw);
  if (id.isFailure()) throw new Error('bad fixture id');
  return id.value;
}

function appointmentId(raw: string): AppointmentId {
  const id = AppointmentId.create(raw);
  if (id.isFailure()) throw new Error('bad fixture id');
  return id.value;
}

/** A client's statistics with `visits` worked visits, a month apart, the last on 28.09.2026. */
function stats(client: string, visits: number): ClientStatsRecord {
  const facts = Array.from({ length: visits }, (_, index) => ({
    appointmentId: appointmentId(`appt-${client}-${index + 1}`),
    atMs: LAST - (visits - 1 - index) * 30 * DAY_MS,
  }));
  return {
    userId: userId(client),
    lifetime: {
      visitsCompleted: visits,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    },
    last365: { visitsCompleted: facts, noShows: [], lateCancels: [] },
    firstVisitAtMs: facts[0]?.atMs ?? null,
    lastVisit: null,
    nextVisit: null,
    avgCadenceDays: visits >= 3 ? 30 : null,
    preferredBarberId: null,
    usualServiceIds: [],
    pauseSuggestion: null,
    version: 1,
    updatedAtMs: LAST,
  };
}

// Handed over out of order: the directory's order is its own.
const CLIENTS = [
  stats('dev-client-3', 1),
  stats('dev-client-1', 12),
  stats('dev-client-5', 0),
  stats('dev-client-2', 9),
  stats('dev-client-4', 3),
];

/** `clientStats/*` as the functions write it, the spend in its own sub-document. */
function seeded(
  records: readonly ClientStatsRecord[] = CLIENTS,
): FakeFirestore {
  const db = new FakeFirestore();
  for (const record of records) {
    const path = `clientStats/${record.userId.value}`;
    db.set(path, clientStatsToDocument(record, record));
    db.set(
      `${path}/restricted/money`,
      clientMoneyToDocument(
        {
          userId: record.userId,
          lifetimeSpendMinor: 12_000,
          currencyCode: 'EUR',
        },
        record,
      ),
    );
  }
  return db;
}

function setUp(db: FakeFirestore = seeded()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestoreClientStatsDirectory,
    ],
  });
  return { db, directory: TestBed.inject(FirestoreClientStatsDirectory) };
}

const ids = (page: ClientStatsPage) =>
  page.records.map((record) => record.userId.value);

/** Every page until nobody is left, as the preview walks them. */
async function walk(
  directory: ClientStatsDirectory,
  limit: number,
): Promise<readonly ClientStatsPage[]> {
  const pages: ClientStatsPage[] = [];
  let after: string | null = null;
  do {
    const page = await directory.page(limit, after);
    if (page.isFailure()) throw page.error;
    pages.push(page.value);
    after = page.value.next;
  } while (after !== null && pages.length < 50);
  return pages;
}

describe('FirestoreClientStatsDirectory', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('reads the collection in the order of its document ids, one document more than asked', async () => {
    const { directory, db } = setUp();

    await directory.page(200, null);

    expect(db.reads).toEqual([
      {
        kind: 'query',
        path: 'clientStats',
        constraints: ['orderBy __name__ asc', 'limit 201'],
      },
    ]);
  });

  it('starts after the cursor on a later page', async () => {
    const { directory, db } = setUp();

    await directory.page(2, 'dev-client-2');

    expect(db.reads[0]?.constraints).toEqual([
      'orderBy __name__ asc',
      'startAfter "dev-client-2"',
      'limit 3',
    ]);
  });

  it('hands over a page of the shop’s clients, parsed, and where the next one starts', async () => {
    const { directory } = setUp();

    const page = await directory.page(2, null);

    if (page.isFailure()) throw page.error;
    expect(ids(page.value)).toEqual(['dev-client-1', 'dev-client-2']);
    expect(page.value.next).toBe('dev-client-2');
    expect(page.value.records[0]).toEqual(stats('dev-client-1', 12));
  });

  it('walks everybody through its cursors: each client once, in order', async () => {
    const { directory } = setUp();

    const pages = await walk(directory, 2);

    expect(pages.map(ids)).toEqual([
      ['dev-client-1', 'dev-client-2'],
      ['dev-client-3', 'dev-client-4'],
      ['dev-client-5'],
    ]);
    expect(pages.map((page) => page.next)).toEqual([
      'dev-client-2',
      'dev-client-4',
      null,
    ]);
  });

  it('gives no cursor when the clients end exactly where the page does', async () => {
    const { directory, db } = setUp();

    const pages = await walk(directory, 5);

    expect(pages.map(ids)).toEqual([
      [
        'dev-client-1',
        'dev-client-2',
        'dev-client-3',
        'dev-client-4',
        'dev-client-5',
      ],
    ]);
    expect(pages[0]?.next).toBeNull();
    expect(db.reads).toHaveLength(1);
  });

  it.each([1, 2, 3, 5, 200])(
    'answers as the port’s reference does, page for page (pages of %s)',
    async (limit) => {
      const { directory } = setUp();
      const reference = new InMemoryClientStatsDirectory(CLIENTS);

      expect(await walk(directory, limit)).toEqual(
        await walk(reference, limit),
      );
    },
  );

  it('never reads the spend: `restricted/money` is no client of the shop', async () => {
    const { directory, db } = setUp();

    const pages = await walk(directory, 200);

    expect(pages.flatMap(ids)).toHaveLength(5);
    expect(db.reads.every((read) => read.path === 'clientStats')).toBe(true);
  });

  it('leaves out a document that does not parse, and neither ends the walk there nor stalls on it', async () => {
    const db = seeded();
    // The counters are gone: numbers nobody can vouch for.
    db.set('clientStats/dev-client-2', { userId: 'dev-client-2', version: 1 });
    const { directory } = setUp(db);

    const first = await directory.page(2, null);
    if (first.isFailure()) throw first.error;
    // Two documents were read, one is a record; the cursor is the last READ.
    expect(ids(first.value)).toEqual(['dev-client-1']);
    expect(first.value.next).toBe('dev-client-2');

    const pages = await walk(directory, 2);
    expect(pages.flatMap(ids)).toEqual([
      'dev-client-1',
      'dev-client-3',
      'dev-client-4',
      'dev-client-5',
    ]);
  });

  it('is an empty page, never an error, for a shop with no clients yet', async () => {
    const { directory } = setUp(new FakeFirestore());

    const page = await directory.page(200, null);

    expect(page.isSuccess() && page.value).toEqual({ records: [], next: null });
  });

  it.each([0, -5, Number.NaN, 2.9])(
    'asks for a whole page of at least one client, whatever was asked (%s)',
    async (limit) => {
      const { directory, db } = setUp();

      const page = await directory.page(limit, null);

      expect(db.reads[0]?.constraints.at(-1)).toBe(
        limit === 2.9 ? 'limit 3' : 'limit 2',
      );
      expect(page.isSuccess() && page.value.records).toHaveLength(
        limit === 2.9 ? 2 : 1,
      );
    },
  );

  it('reads a blank cursor as none', async () => {
    const { directory } = setUp();

    const page = await directory.page(1, '  ');

    expect(page.isSuccess() && ids(page.value)).toEqual(['dev-client-1']);
  });

  it('turns a refused read into a failed Result', async () => {
    const { directory, db } = setUp();
    const refusal = Object.assign(new Error('Missing permissions'), {
      code: 'permission-denied',
    });
    db.failWith(refusal);

    const page = await directory.page(200, null);

    expect(page.isFailure() && page.error).toBeInstanceOf(RepositoryError);
    expect(page.isFailure() && page.error.cause).toBe(refusal);
  });
});
