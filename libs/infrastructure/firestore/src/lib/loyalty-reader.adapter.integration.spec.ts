import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  type LoyaltyAccountFixture,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreLoyaltyReader } from './loyalty-reader.adapter';

const GEORGI = 'dev-client-1';

function readerFor(context: RulesTestContext): FirestoreLoyaltyReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreLoyaltyReader,
    ],
  });
  return TestBed.inject(FirestoreLoyaltyReader);
}

describe('FirestoreLoyaltyReader (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  /** Writes a client's documents exactly as the fixture holds them — the server's shape. */
  async function seed(userId: string, fixture: LoyaltyAccountFixture) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      await setDoc(doc(db, 'loyaltyAccounts', userId), fixture.account);
      for (const [id, progress] of Object.entries(fixture.badgeProgress)) {
        await setDoc(
          doc(db, 'loyaltyAccounts', userId, 'badgeProgress', id),
          progress,
        );
      }
      for (const [id, track] of Object.entries(fixture.seasonProgress)) {
        await setDoc(
          doc(db, 'loyaltyAccounts', userId, 'seasonProgress', id),
          track,
        );
      }
      for (const [id, entry] of Object.entries(fixture.clientJournal)) {
        await setDoc(doc(db, 'clientJournal', id), entry);
      }
    });
  }

  async function write(path: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), path), data);
    });
  }

  const barber = () =>
    readerFor(
      testEnv.authenticatedContext('staff-ivan', { roles: ['barber'] }),
    );

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-loyalty-reader');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed(GEORGI, loyaltyFixtures.georgi);
  });

  it('reads the account a barber sees', async () => {
    const result = await barber().getAccount(GEORGI);
    if (result.isFailure()) throw result.error;
    expect(result.value?.balance).toBe(358);
    expect(result.value?.tier.current).toBe('gold');
    expect(result.value?.updatedAt).toBeInstanceOf(Date);
  });

  it('reads every started family and every season track', async () => {
    const reader = barber();
    const progress = await reader.listBadgeProgress(GEORGI);
    const seasons = await reader.listSeasonProgress(GEORGI);
    expect(
      progress.isSuccess() && progress.value.map((p) => p.seriesId).sort(),
    ).toEqual(Object.keys(loyaltyFixtures.georgi.badgeProgress).sort());
    expect(
      seasons.isSuccess() && seasons.value.map((s) => s.seasonId).sort(),
    ).toEqual(Object.keys(loyaltyFixtures.georgi.seasonProgress).sort());
  });

  it('reads the newest point rows only — no staff row, no row without points', async () => {
    const last = loyaltyFixtures.georgi.clientJournal[`${GEORGI}_000035`];
    if (last === undefined) throw new Error('fixture: no last row');
    await write(`clientJournal/${GEORGI}_000036`, {
      ...last,
      seq: 36,
      visibility: 'staff',
    });
    await write(`clientJournal/${GEORGI}_000037`, {
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
    });
    const tail = await barber().listLedgerTail(GEORGI, 3);
    if (tail.isFailure()) throw tail.error;
    expect(tail.value.map((row) => row.seq)).toEqual([35, 34, 33]);
    expect(tail.value[0]?.at).toBeInstanceOf(Date);
  });

  it('answers null and empty lists for a client with no account', async () => {
    const reader = barber();
    const account = await reader.getAccount('dev-client-9');
    const progress = await reader.listBadgeProgress('dev-client-9');
    const ledger = await reader.listLedgerTail('dev-client-9', 5);
    expect(account.isSuccess() && account.value).toBeNull();
    expect(progress.isSuccess() && progress.value).toEqual([]);
    expect(ledger.isSuccess() && ledger.value).toEqual([]);
  });

  it('fails a malformed account rather than showing its figures', async () => {
    await write(`loyaltyAccounts/${GEORGI}`, {
      ...loyaltyFixtures.georgi.account,
      balance: '358',
    });
    const result = await barber().getAccount(GEORGI);
    expect(result.isFailure() && result.error.message).toBe(
      `Malformed loyaltyAccounts/${GEORGI}.balance`,
    );
  });

  it('leaves out the one progress document that does not parse', async () => {
    await write(`loyaltyAccounts/${GEORGI}/badgeProgress/series-broken`, {
      value: 'many',
      earned: [],
    });
    const progress = await barber().listBadgeProgress(GEORGI);
    expect(progress.isSuccess() && progress.value).toHaveLength(
      Object.keys(loyaltyFixtures.georgi.badgeProgress).length,
    );
  });

  it('is refused for the client themselves and for a content manager (§4.5)', async () => {
    const own = readerFor(
      testEnv.authenticatedContext(GEORGI, { roles: ['client'] }),
    );
    const copy = readerFor(
      testEnv.authenticatedContext('copy-1', { roles: ['content_manager'] }),
    );
    expect((await own.getAccount(GEORGI)).isFailure()).toBe(true);
    expect((await own.listLedgerTail(GEORGI, 5)).isFailure()).toBe(true);
    expect((await copy.listBadgeProgress(GEORGI)).isFailure()).toBe(true);
  });
});
