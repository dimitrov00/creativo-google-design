import { CustomerOrigin, WriteOp } from '@core/components';
import { CustomerId, RepositoryError, Result, UserId } from '@core/primitives';
import { type Customer, Collections, Profile } from '@core/entities';
import type { AccountContact } from '@core/ports';
import { SearchFieldsSystem } from '@core/systems';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryReadTx,
  memoryStore,
} from '@core/testing';
import {
  customerCreates,
  customerIdsFor,
  customerIdsOf,
  isCustomerConflict,
  readCustomers,
  runWithCustomerRetry,
} from './customer-records.pipeline';

const SON = UserId.of('u-son');
const SON_RECORD = CustomerId.forUser(SON, fixtureHash);

const MARIA: AccountContact = {
  firstName: 'Maria',
  lastName: 'Ivanova',
  phone: null,
  email: 'maria@example.com' as AccountContact['email'],
};

describe('the client records of a booking (D29, F1-5)', () => {
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

  it('creates ONLY a record the transaction found absent — FIRST_BOOKING, the snapshot’s name and channels, the search keys', () => {
    const resolved = customerIdsFor([FIXTURE_IDS.client, SON], fixtureHash);
    const writes = customerCreates(
      resolved,
      new Map<CustomerId, Customer | null>([
        [FIXTURE_IDS.customer, null],
        [SON_RECORD, { id: SON_RECORD } as Customer],
      ]),
      new Map([[FIXTURE_IDS.client, MARIA]]),
      FIXTURE_NOW_UTC_MS,
    );
    const body: Omit<Customer, 'id'> = {
      userId: FIXTURE_IDS.client,
      displayName: Profile.fullName(MARIA),
      phone: null,
      email: MARIA.email,
      ...SearchFieldsSystem.searchFields('Maria', 'Ivanova', null, MARIA.email),
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
      customerOrigin: CustomerOrigin.FirstBooking,
    };
    expect(writes).toEqual([
      WriteOp.create([Collections.Customers, FIXTURE_IDS.customer], body),
    ]);
  });

  it('a record never read is not absent — nothing is planned for it; an account with no snapshot gets a nameless record', () => {
    const resolved = customerIdsFor([FIXTURE_IDS.client, SON], fixtureHash);
    const writes = customerCreates(
      resolved,
      new Map<CustomerId, Customer | null>([[SON_RECORD, null]]),
      new Map(),
      FIXTURE_NOW_UTC_MS,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(
      WriteOp.create([Collections.Customers, SON_RECORD], {
        userId: SON,
        displayName: '',
        phone: null,
        email: null,
        searchName: '',
        searchPrefixes: [],
        createdAtUtcMs: FIXTURE_NOW_UTC_MS,
        customerOrigin: CustomerOrigin.FirstBooking,
      }),
    );
  });

  it('recognises a lost create race ONLY on a customer path', () => {
    expect(
      isCustomerConflict(
        Result.err(RepositoryError.alreadyExists('customers/cus_x')),
      ),
    ).toBe(true);
    expect(
      isCustomerConflict(
        Result.err(RepositoryError.alreadyExists('appointments/a1')),
      ),
    ).toBe(false);
    expect(
      isCustomerConflict(
        Result.err(RepositoryError.readFailed('customers/cus_x', 'x')),
      ),
    ).toBe(false);
    expect(isCustomerConflict(Result.ok(1))).toBe(false);
    expect(isCustomerConflict(Result.err('plain'))).toBe(false);
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
