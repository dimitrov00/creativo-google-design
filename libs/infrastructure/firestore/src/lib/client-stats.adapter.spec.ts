import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { CustomerId, RepositoryErrorCode, Result } from '@core/primitives';
import type { ClientStatsReadPorts } from '@core/ports';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { clientStatsReadPorts } = await import('./client-stats.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Enough of a stored projection to tell clients apart. */
const stats = (customerId: string, visits: number) => ({
  customerId,
  lifetimeVisitsCompleted: visits,
  version: 1,
  updatedAtUtcMs: 1,
});
const money = (customerId: string) => ({
  customerId,
  lifetimeSpendCents: 12_000,
  currency: 'EUR',
  version: 1,
  updatedAtUtcMs: 1,
});

// Seeded out of order: the directory's order is the document ids'.
const CLIENTS = ['cus_3', 'cus_1', 'cus_5', 'cus_2', 'cus_4'];

/** `clientStats/*` as the projection writes it, the spend in its own sub-document. */
function seeded(ids: readonly string[] = CLIENTS): FakeFirestore {
  const fake = new FakeFirestore();
  for (const [index, id] of ids.entries()) {
    fake.set(`clientStats/${id}`, stats(id, index));
    fake.set(`clientStats/${id}/restricted/money`, money(id));
  }
  return fake;
}

type Page = Extract<
  Awaited<ReturnType<ClientStatsReadPorts['pageClientStats']>>,
  { readonly ok: true }
>['value'];

const idsOf = (page: Page) => page.records.map((record) => record.id);

/** Every page until nobody is left, as the rhythm preview walks them. */
async function walk(
  ports: ClientStatsReadPorts,
  max: number,
): Promise<readonly Page[]> {
  const pages: Page[] = [];
  let after: CustomerId | null = null;
  do {
    const page = await ports.pageClientStats(after, max);
    if (!page.ok) throw new Error('page refused');
    pages.push(page.value);
    after = page.value.nextAfterCustomerId;
  } while (after !== null && pages.length < 50);
  return pages;
}

describe('clientStatsReadPorts.loadClientStats and loadClientMoney — one client record, once', () => {
  it('reads clientStats/{customerId} as its entity', async () => {
    const fake = seeded();

    const found = await clientStatsReadPorts(asDb(fake)).loadClientStats(
      CustomerId.of('cus_2'),
    );

    expect(found).toEqual(Result.ok({ id: 'cus_2', ...stats('cus_2', 3) }));
    expect(fake.reads).toEqual([
      { kind: 'document', path: 'clientStats/cus_2', constraints: [] },
    ]);
  });

  it('answers null for a client with no projection yet', async () => {
    const found = await clientStatsReadPorts(
      asDb(new FakeFirestore()),
    ).loadClientStats(CustomerId.of('cus_new'));

    expect(found).toEqual(Result.ok(null));
  });

  it('reads the spend from the restricted sub-document', async () => {
    const fake = seeded();

    const found = await clientStatsReadPorts(asDb(fake)).loadClientMoney(
      CustomerId.of('cus_2'),
    );

    expect(found).toEqual(Result.ok({ id: 'money', ...money('cus_2') }));
    expect(fake.reads[0]?.path).toBe('clientStats/cus_2/restricted/money');
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = seeded().failWith({ code: 'permission-denied' });

    const found = await clientStatsReadPorts(asDb(fake)).loadClientMoney(
      CustomerId.of('cus_2'),
    );

    expect(found).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'clientStats/cus_2/restricted/money',
        reason: 'permission-denied',
      }),
    );
  });
});

describe('clientStatsReadPorts.pageClientStats — every client, by document id', () => {
  it('reads the collection in the order of its document ids, one document more than asked', async () => {
    const fake = seeded();

    await clientStatsReadPorts(asDb(fake)).pageClientStats(null, 200);

    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'clientStats',
        constraints: ['orderBy __name__ asc', 'limit 201'],
      },
    ]);
  });

  it('starts after the cursor on a later page', async () => {
    const fake = seeded();

    await clientStatsReadPorts(asDb(fake)).pageClientStats(
      CustomerId.of('cus_2'),
      2,
    );

    expect(fake.reads[0]?.constraints).toEqual([
      'orderBy __name__ asc',
      'startAfter "cus_2"',
      'limit 3',
    ]);
  });

  it('hands over a page of the shop’s clients, and where the next one starts', async () => {
    const page = await clientStatsReadPorts(asDb(seeded())).pageClientStats(
      null,
      2,
    );

    expect(page).toEqual(
      Result.ok({
        records: [
          { id: 'cus_1', ...stats('cus_1', 1) },
          { id: 'cus_2', ...stats('cus_2', 3) },
        ],
        nextAfterCustomerId: 'cus_2',
      }),
    );
  });

  it('walks everybody through its cursors: each client once, in order', async () => {
    const pages = await walk(clientStatsReadPorts(asDb(seeded())), 2);

    expect(pages.map(idsOf)).toEqual([
      ['cus_1', 'cus_2'],
      ['cus_3', 'cus_4'],
      ['cus_5'],
    ]);
    expect(pages.map((page) => page.nextAfterCustomerId)).toEqual([
      'cus_2',
      'cus_4',
      null,
    ]);
  });

  it('gives no cursor when the clients end exactly where the page does', async () => {
    const fake = seeded();

    const pages = await walk(clientStatsReadPorts(asDb(fake)), 5);

    expect(pages.map(idsOf)).toEqual([
      ['cus_1', 'cus_2', 'cus_3', 'cus_4', 'cus_5'],
    ]);
    expect(pages[0]?.nextAfterCustomerId).toBeNull();
    expect(fake.reads).toHaveLength(1);
  });

  it.each([1, 2, 3, 5, 200])(
    'hands every client over exactly once, in id order, in pages of %s',
    async (max) => {
      const pages = await walk(clientStatsReadPorts(asDb(seeded())), max);

      expect(pages.flatMap(idsOf)).toEqual([
        'cus_1',
        'cus_2',
        'cus_3',
        'cus_4',
        'cus_5',
      ]);
      expect(pages.every((page) => page.records.length <= max)).toBe(true);
      expect(pages.at(-1)?.nextAfterCustomerId).toBeNull();
    },
  );

  it('never reads the spend: `restricted/money` is no client of the shop', async () => {
    const fake = seeded();

    const pages = await walk(clientStatsReadPorts(asDb(fake)), 200);

    expect(pages.flatMap(idsOf)).toHaveLength(5);
    expect(fake.reads.every((read) => read.path === 'clientStats')).toBe(true);
  });

  it('is an empty page, never an error, for a shop with no clients yet', async () => {
    const page = await clientStatsReadPorts(
      asDb(new FakeFirestore()),
    ).pageClientStats(null, 200);

    expect(page).toEqual(Result.ok({ records: [], nextAfterCustomerId: null }));
  });

  it.each([0, -5, Number.NaN, 2.9])(
    'asks for a whole page of at least one client, whatever was asked (%s)',
    async (max) => {
      const fake = seeded();

      const page = await clientStatsReadPorts(asDb(fake)).pageClientStats(
        null,
        max,
      );

      expect(fake.reads[0]?.constraints.at(-1)).toBe(
        max === 2.9 ? 'limit 3' : 'limit 2',
      );
      expect(page.ok && page.value.records).toHaveLength(max === 2.9 ? 2 : 1);
    },
  );

  it('turns a refused read into a failed Result', async () => {
    const fake = seeded().failWith({ code: 'permission-denied' });

    const page = await clientStatsReadPorts(asDb(fake)).pageClientStats(
      null,
      200,
    );

    expect(page).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'clientStats',
        reason: 'permission-denied',
      }),
    );
  });
});
