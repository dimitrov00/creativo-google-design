import { describe, expect, it } from 'vitest';
import { CustomerOrigin, E164, Email, WriteOp } from '@core/components';
import { CustomerId, UserId } from '@core/primitives';
import {
  type AccountContact,
  Collections,
  type Customer,
  Profile,
} from '@core/entities';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  deepFreeze,
  fixtureHash,
} from '@core/testing';
import { CustomerRecordSystem } from './customer-record.system';
import { SearchFieldsSystem } from './search-fields.system';

/*
 * MOVED, titles kept, from pipelines/customer-records.pipeline.spec.ts (the
 * `customerCreates` cases of flip 1, F1-5) with the body and the
 * create-when-absent decision they test (identity flip (2), F2-7b); plus
 * the `REGISTRATION` origin `completeRegistration` plans.
 */

const SON = UserId.of('u-son');
const SON_RECORD = CustomerId.forUser(SON, fixtureHash);

const MARIA: AccountContact = {
  firstName: 'Maria',
  lastName: 'Ivanova',
  phone: null,
  email: Email.of('maria@example.com'),
};

/** The account → record resolution the pipelines derive (`customerIdsFor`). */
function resolvedFor(
  ...userIds: readonly UserId[]
): ReadonlyMap<UserId, CustomerId> {
  const ids = new Map<UserId, CustomerId>();
  for (const userId of userIds) {
    ids.set(userId, CustomerId.forUser(userId, fixtureHash));
  }
  return ids;
}

describe('CustomerRecordSystem.createsFor — the client records a transaction creates (D29)', () => {
  it('creates ONLY a record the transaction found absent — FIRST_BOOKING, the snapshot’s name and channels, the search keys', () => {
    const writes = CustomerRecordSystem.createsFor(
      resolvedFor(FIXTURE_IDS.client, SON),
      new Map<CustomerId, Customer | null>([
        [FIXTURE_IDS.customer, null],
        [SON_RECORD, { id: SON_RECORD } as Customer],
      ]),
      new Map([[FIXTURE_IDS.client, MARIA]]),
      CustomerOrigin.FirstBooking,
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
    const writes = CustomerRecordSystem.createsFor(
      resolvedFor(FIXTURE_IDS.client, SON),
      new Map<CustomerId, Customer | null>([[SON_RECORD, null]]),
      new Map(),
      CustomerOrigin.FirstBooking,
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

  it('a registration creates the account’s record as REGISTRATION — the registered name, both channels, the explicit userId link (F2-7b)', () => {
    const registered: AccountContact = {
      firstName: 'Maria',
      lastName: 'Ivanova',
      phone: E164.of('+359888123456'),
      email: Email.of('maria@example.com'),
    };
    const writes = CustomerRecordSystem.createsFor(
      resolvedFor(FIXTURE_IDS.client),
      new Map<CustomerId, Customer | null>([[FIXTURE_IDS.customer, null]]),
      new Map([[FIXTURE_IDS.client, registered]]),
      CustomerOrigin.Registration,
      FIXTURE_NOW_UTC_MS,
    );
    expect(writes).toEqual([
      WriteOp.create([Collections.Customers, FIXTURE_IDS.customer], {
        userId: FIXTURE_IDS.client,
        displayName: 'Maria Ivanova',
        phone: registered.phone,
        email: registered.email,
        ...SearchFieldsSystem.searchFields(
          'Maria',
          'Ivanova',
          registered.phone,
          registered.email,
        ),
        createdAtUtcMs: FIXTURE_NOW_UTC_MS,
        customerOrigin: CustomerOrigin.Registration,
      }),
    ]);
    // A re-run that reads the record it created plans nothing.
    expect(
      CustomerRecordSystem.createsFor(
        resolvedFor(FIXTURE_IDS.client),
        new Map<CustomerId, Customer | null>([
          [FIXTURE_IDS.customer, { id: FIXTURE_IDS.customer } as Customer],
        ]),
        new Map([[FIXTURE_IDS.client, registered]]),
        CustomerOrigin.Registration,
        FIXTURE_NOW_UTC_MS,
      ),
    ).toEqual([]);
  });

  it('plans one create per record, however many accounts resolve to it', () => {
    const shared = new Map<UserId, CustomerId>([
      [FIXTURE_IDS.client, FIXTURE_IDS.customer],
      [SON, FIXTURE_IDS.customer],
    ]);
    const writes = CustomerRecordSystem.createsFor(
      shared,
      new Map<CustomerId, Customer | null>([[FIXTURE_IDS.customer, null]]),
      new Map([[FIXTURE_IDS.client, MARIA]]),
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    expect(writes).toHaveLength(1);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const resolved = resolvedFor(FIXTURE_IDS.client, SON);
    const stored = new Map<CustomerId, Customer | null>([
      [FIXTURE_IDS.customer, null],
      [SON_RECORD, null],
    ]);
    const contacts = new Map([[FIXTURE_IDS.client, deepFreeze({ ...MARIA })]]);
    const once = CustomerRecordSystem.createsFor(
      resolved,
      stored,
      contacts,
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    const twice = CustomerRecordSystem.createsFor(
      resolved,
      stored,
      contacts,
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    expect(twice).toEqual(once);
    expect([...stored.values()]).toEqual([null, null]);
    expect(resolved.size).toBe(2);
  });
});
