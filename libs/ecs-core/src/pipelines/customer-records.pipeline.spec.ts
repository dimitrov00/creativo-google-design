import { CustomerId, RepositoryError, Result, UserId } from '@core/primitives';
import { Collections } from '@core/entities';
import {
  FIXTURE_IDS,
  fixtureHash,
  memoryReadTx,
  memoryStore,
} from '@core/testing';
import {
  customerIdsFor,
  customerIdsOf,
  isCreateConflict,
  readCustomers,
  runWithCreateRetry,
  runWithCustomerRetry,
} from './customer-records.pipeline';

/*
 * The create-when-absent cases moved, titles kept, to
 * systems/customer-record.system.spec.ts with `CustomerRecordSystem.createsFor`
 * (identity flip (2), F2-7b); the retry is generalised over the collections
 * a transaction creates in (`runWithCreateRetry`), `runWithCustomerRetry`
 * its customers specialisation.
 */

const SON = UserId.of('u-son');
const SON_RECORD = CustomerId.forUser(SON, fixtureHash);

describe('the client records of a transaction (D29, F1-5, F2-7b)', () => {
  it('derives every record id from its account — CustomerId.forUser(uid, hash), each account once', () => {
    const ids = customerIdsFor(
      [FIXTURE_IDS.client, SON, FIXTURE_IDS.client],
      fixtureHash,
    );
    expect([...ids]).toEqual([
      [FIXTURE_IDS.client, FIXTURE_IDS.customer],
      [SON, SON_RECORD],
    ]);
    expect(customerIdsOf(ids)).toEqual([FIXTURE_IDS.customer, SON_RECORD]);
  });

  it('reads the records in ONE getAll, absent ones as null', async () => {
    const tx = memoryReadTx(
      memoryStore([
        { path: [Collections.Customers, SON_RECORD], body: { userId: SON } },
      ]),
    );
    const found = await readCustomers(tx, [
      FIXTURE_IDS.customer,
      SON_RECORD,
      SON_RECORD,
    ]);
    expect(tx.reads).toEqual([
      [Collections.Customers, FIXTURE_IDS.customer],
      [Collections.Customers, SON_RECORD],
    ]);
    expect(found.get(FIXTURE_IDS.customer)).toBeNull();
    expect(found.get(SON_RECORD)).toMatchObject({ userId: SON });
    expect((await readCustomers(memoryReadTx(memoryStore()), [])).size).toBe(0);
  });

  it('recognises a lost create race ONLY on a listed collection', () => {
    const customers = [Collections.Customers];
    expect(
      isCreateConflict(
        Result.err(RepositoryError.alreadyExists('customers/cus_x')),
        customers,
      ),
    ).toBe(true);
    expect(
      isCreateConflict(
        Result.err(RepositoryError.alreadyExists('appointments/a1')),
        customers,
      ),
    ).toBe(false);
    expect(
      isCreateConflict(
        Result.err(RepositoryError.readFailed('customers/cus_x', 'x')),
        customers,
      ),
    ).toBe(false);
    expect(isCreateConflict(Result.ok(1), customers)).toBe(false);
    expect(isCreateConflict(Result.err('plain'), customers)).toBe(false);
    // A prefix is a whole collection name: `customersArchive/…` is not `customers`.
    expect(
      isCreateConflict(
        Result.err(RepositoryError.alreadyExists('customersArchive/c1')),
        customers,
      ),
    ).toBe(false);
    // Several collections: the stub `Create` of verifyOtp is a `users` conflict.
    expect(
      isCreateConflict(Result.err(RepositoryError.alreadyExists('users/u1')), [
        Collections.Users,
        Collections.Customers,
      ]),
    ).toBe(true);
    expect(
      isCreateConflict(
        Result.err(RepositoryError.alreadyExists('users/u1')),
        customers,
      ),
    ).toBe(false);
  });

  it('re-runs the whole transaction ONCE on a create conflict — and a second conflict is the answer, never success', async () => {
    const conflict = Result.err(RepositoryError.alreadyExists('users/u1'));
    const users = [Collections.Users];
    let calls = 0;
    const settles = await runWithCreateRetry(async () => {
      calls += 1;
      return calls === 1 ? conflict : Result.ok('signed-in');
    }, users);
    expect([calls, settles]).toEqual([2, Result.ok('signed-in')]);

    calls = 0;
    const fails = await runWithCreateRetry(async () => {
      calls += 1;
      return conflict;
    }, users);
    expect([calls, fails]).toEqual([2, conflict]);

    calls = 0;
    const other = await runWithCreateRetry(async () => {
      calls += 1;
      return Result.err(RepositoryError.alreadyExists('customers/cus_x'));
    }, users);
    expect(calls).toBe(1);
    expect(other.ok).toBe(false);
  });

  it('re-runs the whole transaction ONCE on a customer conflict — and a second conflict is the answer, never success', async () => {
    const conflict = Result.err(
      RepositoryError.alreadyExists('customers/cus_x'),
    );
    let calls = 0;
    const settles = await runWithCustomerRetry(async () => {
      calls += 1;
      return calls === 1 ? conflict : Result.ok('booked');
    });
    expect([calls, settles]).toEqual([2, Result.ok('booked')]);

    calls = 0;
    const fails = await runWithCustomerRetry(async () => {
      calls += 1;
      return conflict;
    });
    expect([calls, fails]).toEqual([2, conflict]);

    calls = 0;
    const other = await runWithCustomerRetry(async () => {
      calls += 1;
      return Result.err(RepositoryError.alreadyExists('appointments/a1'));
    });
    expect(calls).toBe(1);
    expect(other.ok).toBe(false);
  });
});
