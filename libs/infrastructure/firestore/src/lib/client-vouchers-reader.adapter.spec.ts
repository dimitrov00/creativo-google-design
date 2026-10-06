import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  InMemoryClientVouchersReader,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import { RepositoryError } from '@creativo/application/shared';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

import { FirestoreClientVouchersReader } from './client-vouchers-reader.adapter';

const GEORGI = 'dev-client-1';
const MARTIN = 'dev-client-2';

/** The fixture's five vouchers, as `giftVouchers/*`. */
function seeded(): FakeFirestore {
  return new FakeFirestore(
    Object.fromEntries(
      Object.entries(loyaltyFixtures.vouchers).map(([id, voucher]) => [
        `giftVouchers/${id}`,
        { ...voucher },
      ]),
    ),
  );
}

function setUp(db: FakeFirestore = seeded()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestoreClientVouchersReader,
    ],
  });
  return { db, reader: TestBed.inject(FirestoreClientVouchersReader) };
}

describe('FirestoreClientVouchersReader', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('asks for the holder’s vouchers by one equality, which needs no index', async () => {
    const { reader, db } = setUp();

    await reader.listForHolder(GEORGI);

    expect(db.reads).toEqual([
      {
        kind: 'query',
        path: 'giftVouchers',
        constraints: ['issuedToUserId == "dev-client-1"'],
      },
    ]);
  });

  it('hands over what the person holds, whatever its state: the spent and the voided too', async () => {
    const { reader } = setUp();

    const result = await reader.listForHolder(GEORGI);

    if (result.isFailure()) throw result.error;
    expect(
      result.value.map((voucher) => [
        voucher.id.value,
        voucher.code,
        voucher.state.kind,
        voucher.balance.toMinorUnits(),
      ]),
    ).toEqual([
      ['voucher-dev-georgi', 'GIFT50', 'active', 2500],
      ['voucher-dev-georgi-spent', 'SPENT20', 'active', 0],
      ['voucher-dev-georgi-void', 'VOID30', 'void', 3000],
    ]);
    expect(result.value.every((v) => v.issuedToUserId?.value === GEORGI)).toBe(
      true,
    );
  });

  it('never hands one person another’s voucher, nor anyone a paper one', async () => {
    const { reader } = setUp();

    const result = await reader.listForHolder(MARTIN);

    expect(
      result.isSuccess() && result.value.map((voucher) => voucher.code),
    ).toEqual(['GIFT2025']);
  });

  it('answers as the port’s reference does, voucher for voucher', async () => {
    const { reader } = setUp();
    const reference = InMemoryClientVouchersReader.seeded();

    for (const holder of [GEORGI, MARTIN, 'dev-client-3']) {
      const [read, expected] = await Promise.all([
        reader.listForHolder(holder),
        reference.listForHolder(holder),
      ]);
      if (read.isFailure() || expected.isFailure()) {
        throw new Error('both must answer');
      }
      expect(read.value.map((v) => v.id.value)).toEqual(
        expected.value.map((v) => v.id.value),
      );
    }
  });

  it('is an empty list, never an error, for a client who holds none', async () => {
    const { reader } = setUp();

    const result = await reader.listForHolder('dev-client-3');

    expect(result.isSuccess() && result.value).toEqual([]);
  });

  it('reads nothing for no one: a blank id would ask for the paper vouchers', async () => {
    const { reader, db } = setUp();

    const result = await reader.listForHolder('   ');

    expect(result.isSuccess() && result.value).toEqual([]);
    expect(db.reads).toEqual([]);
  });

  it('leaves out a document that is no voucher rather than cost the person the rest', async () => {
    const { reader } = setUp(
      seeded().set('giftVouchers/voucher-broken', {
        code: 'BROKEN1',
        issuedToUserId: GEORGI,
        state: { kind: 'active' },
      }),
    );

    const result = await reader.listForHolder(GEORGI);

    expect(result.isSuccess() && result.value.map((v) => v.id.value)).toEqual([
      'voucher-dev-georgi',
      'voucher-dev-georgi-spent',
      'voucher-dev-georgi-void',
    ]);
  });

  it('turns a refused read into a failed Result', async () => {
    const { reader, db } = setUp();
    const refusal = Object.assign(new Error('Missing permissions'), {
      code: 'permission-denied',
    });
    db.failWith(refusal);

    const result = await reader.listForHolder(GEORGI);

    expect(result.isFailure() && result.error).toBeInstanceOf(RepositoryError);
    expect(result.isFailure() && result.error.cause).toBe(refusal);
  });
});
