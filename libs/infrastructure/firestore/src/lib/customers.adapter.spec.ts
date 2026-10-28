import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  CustomerOrigin,
  E164,
  ErasureLifecycle,
  ErasureStatus,
  WriteProvenance,
} from '@core/components';
import { CustomerId, Result, UserId } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import type { Customer } from '@core/entities';
import { SearchFieldsSystem } from '@core/systems';
import { recordingTelemetry, utcMs } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';
import { UNGUARDED } from '../testing/unguarded';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { customerPorts, customerSearchPorts } =
  await import('./customers.adapter');
const { guardedReads } = await import('./observe');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

describe('customerPorts.loadCustomerForUser — the client record of an account', () => {
  const georgi = {
    userId: 'u-georgi',
    displayName: 'Георги Петров',
    phone: '+359888000001',
    email: null,
    searchName: 'георги петров',
    searchPrefixes: ['ге', 'гео'],
    createdAtUtcMs: 1,
    customerOrigin: 'FIRST_BOOKING',
    erasureStatus: ErasureStatus.None,
  };

  it('asks by the link field, one document, and answers the record', async () => {
    const fake = new FakeFirestore({
      'customers/cus_georgi': georgi,
      'customers/cus_martin': { ...georgi, userId: 'u-martin' },
    });

    const found = await customerPorts(
      asDb(fake),
      UNGUARDED,
    ).loadCustomerForUser(UserId.of('u-georgi'));

    expect(found).toEqual(Result.ok({ id: 'cus_georgi', ...georgi }));
    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'customers',
        constraints: ['userId == "u-georgi"', 'limit 1'],
      },
    ]);
  });

  it('answers null for an account with no record yet', async () => {
    const found = await customerPorts(
      asDb(new FakeFirestore()),
      UNGUARDED,
    ).loadCustomerForUser(UserId.of('u-new'));

    expect(found).toEqual(Result.ok(null));
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const found = await customerPorts(
      asDb(fake),
      UNGUARDED,
    ).loadCustomerForUser(UserId.of('u-georgi'));

    expect(found).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'customers',
        reason: 'permission-denied',
      }),
    );
  });
});

describe('customerPorts.loadCustomerForUser, guarded — the SINGLE rule (edge hardening D-3)', () => {
  const record = {
    userId: 'u-georgi',
    displayName: 'Георги Петров',
    phone: '+359888000001',
    email: null,
    searchName: 'георги петров',
    searchPrefixes: ['ге', 'гео'],
    createdAtUtcMs: 1_790_575_200_000,
    customerOrigin: 'FIRST_BOOKING',
    erasureStatus: ErasureStatus.None,
  };

  it('answers a malformed record as REPOSITORY_MALFORMED — never ok(null), never “no record yet”', async () => {
    const telemetry = recordingTelemetry();
    const fake = new FakeFirestore({
      'customers/cus_georgi': { ...record, customerOrigin: 'WALK_IN' },
    });

    const found = await customerPorts(
      asDb(fake),
      guardedReads(telemetry),
    ).loadCustomerForUser(UserId.of('u-georgi'));

    expect(found).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.Malformed,
        path: 'customers/cus_georgi',
        reason: 'customerOrigin',
      }),
    );
    expect(telemetry.lines.map((line) => line.fields)).toEqual([
      { path: 'customers/cus_georgi', field: 'customerOrigin' },
    ]);
  });

  it('answers a well-formed record — and no record — exactly as before', async () => {
    const telemetry = recordingTelemetry();
    const fake = new FakeFirestore({ 'customers/cus_georgi': record });
    const ports = customerPorts(asDb(fake), guardedReads(telemetry));

    expect(await ports.loadCustomerForUser(UserId.of('u-georgi'))).toEqual(
      Result.ok({ id: 'cus_georgi', ...record }),
    );
    expect(await ports.loadCustomerForUser(UserId.of('u-new'))).toEqual(
      Result.ok(null),
    );
    expect(telemetry.lines).toEqual([]);
  });
});

describe('customerSearchPorts.searchCustomers — the client records the desk can find again (OR-26)', () => {
  /** A record whose search keys are computed as the server writes them. */
  function record(
    id: string,
    name: string,
    rawPhone: string,
    userId: string | null,
  ): Customer {
    const phone = E164.of(rawPhone);
    return {
      id: CustomerId.of(id),
      userId: userId === null ? null : UserId.of(userId),
      displayName: name,
      phone,
      email: null,
      ...SearchFieldsSystem.searchFields(name, null, phone, null),
      createdAtUtcMs: utcMs('2026-09-28T09:00:00.000+03:00'),
      customerOrigin:
        userId === null ? CustomerOrigin.StaffWalkIn : CustomerOrigin.Seed,
      ...WriteProvenance.NONE,
      ...ErasureLifecycle.none(),
    };
  }
  const MARIA = record('cus_maria', 'Мария', '+359888123456', null);
  const MARTIN = record('cus_martin', 'Мартин Илиев', '+359887654321', 'u-m');
  const IVAN = record('cus_ivan', 'Иван Маринов', '+359888000002', null);

  function storeOf(...records: readonly Customer[]): FakeFirestore {
    return new FakeFirestore(
      new Map(
        records.map(({ id, ...body }) => [`customers/${id}`, body] as const),
      ),
    );
  }
  const bySearchName = (a: Customer, b: Customer): number =>
    a.searchName < b.searchName ? -1 : a.searchName > b.searchName ? 1 : 0;

  it('asks searchPrefixes array-contains, orderBy searchName, limit — and answers the stored records, a walk-in with no account included', async () => {
    const fake = storeOf(MARTIN, MARIA, IVAN);

    const found = await customerSearchPorts(
      asDb(fake),
      UNGUARDED,
    ).searchCustomers('мар', 20);

    expect(found).toEqual(Result.ok([MARIA, MARTIN, IVAN].sort(bySearchName)));
    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'customers',
        constraints: [
          'searchPrefixes array-contains "мар"',
          'orderBy searchName asc',
          'limit 20',
        ],
      },
    ]);
  });

  it('finds a walk-in by the digits the desk types', async () => {
    const found = await customerSearchPorts(
      asDb(storeOf(MARIA, MARTIN)),
      UNGUARDED,
    ).searchCustomers(SearchFieldsSystem.normalizeQuery('0888 123'), 20);

    expect(found.ok && found.value.map((row) => row.id)).toEqual(['cus_maria']);
  });

  it('cuts at the caller’s limit', async () => {
    const found = await customerSearchPorts(
      asDb(storeOf(MARTIN, MARIA, IVAN)),
      UNGUARDED,
    ).searchCustomers('мар', 2);

    expect(found.ok && found.value).toHaveLength(2);
  });

  it('answers a refused query as the port’s RepositoryError', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const found = await customerSearchPorts(
      asDb(fake),
      UNGUARDED,
    ).searchCustomers('мар', 20);

    expect(found).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'customers',
        reason: 'permission-denied',
      }),
    );
  });

  it('guarded, drops a malformed record and reports it — one bad record never blanks a search', async () => {
    const telemetry = recordingTelemetry();
    const { id: _id, ...body } = MARIA;
    const fake = new FakeFirestore(
      new Map<string, Record<string, unknown>>([
        ['customers/cus_maria', body],
        ['customers/cus_broken', { ...body, customerOrigin: 'WALK_IN' }],
      ]),
    );

    const found = await customerSearchPorts(
      asDb(fake),
      guardedReads(telemetry),
    ).searchCustomers('мар', 20);

    expect(found.ok && found.value.map((row) => row.id)).toEqual(['cus_maria']);
    expect(telemetry.lines.map((line) => line.fields)).toEqual([
      { path: 'customers/cus_broken', field: 'customerOrigin' },
    ]);
  });
});
