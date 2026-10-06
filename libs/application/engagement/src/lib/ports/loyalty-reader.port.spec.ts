import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@creativo/application/shared';
import { InMemoryLoyaltyReader, loyaltyFixtures } from '../../testing';
import { LOYALTY_READER } from './loyalty-reader.port';

/**
 * The port's reference reader (`@creativo/application/engagement/testing`)
 * — what every spec of a loyalty reader's caller runs against — held to
 * the port's promises: an absent account is `null`, a started family is
 * listed, the ledger tail is the newest point rows first, and a failure is
 * a failed `Result`, never a throw.
 */
describe('LoyaltyReader — the in-memory reference', () => {
  it('names its token', () => {
    expect(LOYALTY_READER.toString()).toContain('LoyaltyReader');
  });

  it('reads the seeded clients through the mappers', async () => {
    const reader = InMemoryLoyaltyReader.seeded();
    const georgi = await reader.getAccount('dev-client-1');
    const martin = await reader.getAccount('dev-client-2');
    expect(georgi.isSuccess() && georgi.value?.balance).toBe(358);
    expect(martin.isSuccess() && martin.value?.tier.current).toBe('silver');
  });

  it('answers null for a client without an account, and empty lists', async () => {
    const reader = new InMemoryLoyaltyReader();
    const account = await reader.getAccount('dev-client-9');
    const progress = await reader.listBadgeProgress('dev-client-9');
    const seasons = await reader.listSeasonProgress('dev-client-9');
    const ledger = await reader.listLedgerTail('dev-client-9', 5);
    expect(account.isSuccess() && account.value).toBeNull();
    expect(progress.isSuccess() && progress.value).toEqual([]);
    expect(seasons.isSuccess() && seasons.value).toEqual([]);
    expect(ledger.isSuccess() && ledger.value).toEqual([]);
  });

  it('seeds a fixture under any uid, the account following its key', async () => {
    const reader = new InMemoryLoyaltyReader().put(
      'client-under-test',
      loyaltyFixtures.martin,
    );
    const account = await reader.getAccount('client-under-test');
    expect(account.isSuccess() && account.value?.userId).toBe(
      'client-under-test',
    );
  });

  it('lists every started family and every season track', async () => {
    const reader = InMemoryLoyaltyReader.seeded();
    const progress = await reader.listBadgeProgress('dev-client-1');
    const seasons = await reader.listSeasonProgress('dev-client-1');
    expect(
      progress.isSuccess() && progress.value.map((p) => p.seriesId),
    ).toEqual(Object.keys(loyaltyFixtures.georgi.badgeProgress));
    expect(seasons.isSuccess() && seasons.value.map((s) => s.seasonId)).toEqual(
      Object.keys(loyaltyFixtures.georgi.seasonProgress),
    );
  });

  it('hands back the newest point rows first, as many as asked', async () => {
    const reader = InMemoryLoyaltyReader.seeded();
    const tail = await reader.listLedgerTail('dev-client-1', 5);
    expect(tail.isSuccess() && tail.value.map((row) => row.seq)).toEqual([
      35, 34, 33, 32, 31,
    ]);
    const none = await reader.listLedgerTail('dev-client-1', 0);
    expect(none.isSuccess() && none.value).toEqual([]);
  });

  it('leaves out a row that is not a client-visible point row', async () => {
    const rows = loyaltyFixtures.georgi.clientJournal;
    const last = rows['dev-client-1_000035'];
    if (last === undefined) throw new Error('fixture: no last row');
    const reader = new InMemoryLoyaltyReader().put('dev-client-1', {
      ...loyaltyFixtures.georgi,
      clientJournal: {
        ...rows,
        'dev-client-1_000036': { ...last, seq: 36, visibility: 'staff' },
        'dev-client-1_000037': {
          ...last,
          seq: 37,
          effect: {
            kind: 'streak',
            streakId: 'cadence',
            op: 'extended',
            from: 23,
            to: 24,
            dueBy: '2026-11-09',
          },
        },
      },
    });
    const tail = await reader.listLedgerTail('dev-client-1', 1);
    expect(tail.isSuccess() && tail.value.map((row) => row.seq)).toEqual([35]);
  });

  it('fails every read while told to, and records every call', async () => {
    const reader = InMemoryLoyaltyReader.seeded().failWith();
    const account = await reader.getAccount('dev-client-1');
    const ledger = await reader.listLedgerTail('dev-client-1', 5);
    expect(account.isFailure() && account.error).toBeInstanceOf(
      RepositoryError,
    );
    expect(ledger.isFailure()).toBe(true);
    reader.recover();
    expect((await reader.getAccount('dev-client-1')).isSuccess()).toBe(true);
    expect(reader.calls).toEqual([
      { method: 'getAccount', userId: 'dev-client-1' },
      { method: 'listLedgerTail', userId: 'dev-client-1' },
      { method: 'getAccount', userId: 'dev-client-1' },
    ]);
  });

  it('fails a read whose document is malformed, as the adapter would', async () => {
    const reader = new InMemoryLoyaltyReader().put('dev-client-1', {
      ...loyaltyFixtures.georgi,
      account: { ...loyaltyFixtures.georgi.account, balance: 1.5 },
    });
    const account = await reader.getAccount('dev-client-1');
    expect(account.isFailure() && account.error.message).toBe(
      'Malformed loyaltyAccounts/dev-client-1.balance',
    );
  });
});
