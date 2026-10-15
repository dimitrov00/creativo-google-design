import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { CustomerId } from '@core/primitives';
import type { ClientStatsReadPorts } from '@core/ports';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { clientStatsReadPorts } from './client-stats.adapter';

/** Enough of a stored projection to tell clients apart. */
const stats = (customerId: string, visits: number) => ({
  customerId,
  lifetimeVisitsCompleted: visits,
  last365VisitsCompleted: [],
  version: 1,
  updatedAtUtcMs: 1,
});

const CLIENTS = ['cus_3', 'cus_1', 'cus_5', 'cus_2', 'cus_4'];

describe('clientStatsReadPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const portsFor = (context: RulesTestContext) =>
    clientStatsReadPorts(modularFirestore(context));
  const as = (roles: readonly string[]) =>
    portsFor(testEnv.authenticatedContext('someone', { roles: [...roles] }));

  /** Every page until nobody is left. */
  async function walk(ports: ClientStatsReadPorts, max: number) {
    const ids: string[][] = [];
    const cursors: (string | null)[] = [];
    let after: CustomerId | null = null;
    do {
      const page = await ports.pageClientStats(after, max);
      if (!page.ok) throw new Error(page.error.errorCode);
      ids.push(page.value.records.map((record) => record.id));
      cursors.push(page.value.nextAfterCustomerId);
      after = page.value.nextAfterCustomerId;
    } while (after !== null && ids.length < 20);
    return { ids, cursors };
  }

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-client-stats');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      for (const [index, id] of CLIENTS.entries()) {
        await setDoc(doc(db, 'clientStats', id), stats(id, index));
        await setDoc(doc(db, 'clientStats', id, 'restricted', 'money'), {
          customerId: id,
          lifetimeSpendCents: 12_000,
          currency: 'EUR',
          version: 1,
          updatedAtUtcMs: 1,
        });
      }
    });
  });

  it('walks everybody in the order of their ids, a cursor only while somebody is left', async () => {
    const { ids, cursors } = await walk(as(['barber']), 2);

    expect(ids).toEqual([['cus_1', 'cus_2'], ['cus_3', 'cus_4'], ['cus_5']]);
    expect(cursors).toEqual(['cus_2', 'cus_4', null]);
  });

  it('hands over the stored projection, the body beside its id', async () => {
    const page = await as(['barber']).pageClientStats(null, 1);

    expect(page.ok && page.value.records).toEqual([
      { id: 'cus_1', ...stats('cus_1', 1) },
    ]);
  });

  it('reads one client record’s projection, and its spend for the shop’s admin only', async () => {
    const barber = await as(['barber']).loadClientStats(CustomerId.of('cus_2'));
    const barberSpend = await as(['barber']).loadClientMoney(
      CustomerId.of('cus_2'),
    );
    const adminSpend = await as(['admin']).loadClientMoney(
      CustomerId.of('cus_2'),
    );

    expect(barber.ok && barber.value?.lifetimeVisitsCompleted).toBe(3);
    expect(barberSpend.ok).toBe(false);
    expect(adminSpend.ok && adminSpend.value?.lifetimeSpendCents).toBe(12_000);
  });

  it.each(['barber', 'receptionist', 'sysadmin'])(
    'lets a %s walk the clients',
    async (role) => {
      const page = await as([role]).pageClientStats(null, 10);

      expect(page.ok && page.value.records).toHaveLength(5);
    },
  );

  it('is refused to a client, a content manager and an anonymous visitor', async () => {
    const client = await as(['client']).pageClientStats(null, 10);
    const copy = await as(['content_manager']).pageClientStats(null, 10);
    const nobody = await portsFor(
      testEnv.unauthenticatedContext(),
    ).pageClientStats(null, 10);

    expect([client.ok, copy.ok, nobody.ok]).toEqual([false, false, false]);
  });
});
