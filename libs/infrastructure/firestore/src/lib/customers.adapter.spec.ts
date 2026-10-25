import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { Result, UserId } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { recordingTelemetry } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { customerPorts } = await import('./customers.adapter');
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
  };

  it('asks by the link field, one document, and answers the record', async () => {
    const fake = new FakeFirestore({
      'customers/cus_georgi': georgi,
      'customers/cus_martin': { ...georgi, userId: 'u-martin' },
    });

    const found = await customerPorts(asDb(fake)).loadCustomerForUser(
      UserId.of('u-georgi'),
    );

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
    ).loadCustomerForUser(UserId.of('u-new'));

    expect(found).toEqual(Result.ok(null));
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const found = await customerPorts(asDb(fake)).loadCustomerForUser(
      UserId.of('u-georgi'),
    );

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
