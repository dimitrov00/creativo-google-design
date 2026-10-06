import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { loyaltyFixtures } from '@creativo/application/engagement/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreClientVouchersReader } from './client-vouchers-reader.adapter';

const GEORGI = 'dev-client-1';
const MARTIN = 'dev-client-2';

function readerFor(context: RulesTestContext): FirestoreClientVouchersReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreClientVouchersReader,
    ],
  });
  return TestBed.inject(FirestoreClientVouchersReader);
}

describe('FirestoreClientVouchersReader (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const as = (uid: string, role: string) =>
    readerFor(testEnv.authenticatedContext(uid, { roles: [role] }));

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-client-vouchers');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // The fixture's five: three of Георги's, Мартин's one, one on paper.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const [id, voucher] of Object.entries(loyaltyFixtures.vouchers)) {
        await setDoc(doc(modularFirestore(ctx), 'giftVouchers', id), voucher);
      }
    });
  });

  it('hands a barber what the client holds, whatever its state', async () => {
    const held = await as('staff-ivan', 'barber').listForHolder(GEORGI);

    if (held.isFailure()) throw held.error;
    expect(
      held.value
        .map((voucher) => [
          voucher.code,
          voucher.state.kind,
          voucher.balance.toMinorUnits(),
        ])
        .sort(),
    ).toEqual([
      ['GIFT50', 'active', 2500],
      ['SPENT20', 'active', 0],
      ['VOID30', 'void', 3000],
    ]);
  });

  it('never hands over another client’s voucher, nor a paper one', async () => {
    const held = await as('staff-ivan', 'receptionist').listForHolder(MARTIN);

    expect(held.isSuccess() && held.value.map((v) => v.code)).toEqual([
      'GIFT2025',
    ]);
  });

  it('is an empty list for a client who holds none', async () => {
    const held = await as('staff-ivan', 'barber').listForHolder('dev-client-3');

    expect(held.isSuccess() && held.value).toEqual([]);
  });

  it('lets a client read their own, and refuses them somebody else’s', async () => {
    const own = await as(GEORGI, 'client').listForHolder(GEORGI);
    const other = await as(GEORGI, 'client').listForHolder(MARTIN);

    expect(own.isSuccess() && own.value).toHaveLength(3);
    expect(other.isFailure()).toBe(true);
  });

  it('is refused to an anonymous visitor', async () => {
    const anonymous = readerFor(testEnv.unauthenticatedContext());

    expect((await anonymous.listForHolder(GEORGI)).isFailure()).toBe(true);
  });
});
