import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { StaffPermissions } from '@core/components';
import { AccessScope, Result } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { staffPermissionsStreamPorts } =
  await import('./staff-permissions.adapter');

const PATH = 'settings/staffPermissions';
const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

describe('staffPermissionsStreamPorts.observeStaffPermissions — the cells, live', () => {
  it('reads no document as every default, from the one path', () => {
    const fake = new FakeFirestore();

    const cells = recorded(
      staffPermissionsStreamPorts(asDb(fake)).observeStaffPermissions(),
    );

    expect(cells.seen).toEqual([Result.ok(StaffPermissions.UNSET)]);
    expect(fake.reads.map((read) => read.path)).toEqual([PATH]);
  });

  it('reads the body through the guard: a cell as stored, the stamp and any other key ignored', () => {
    const fake = new FakeFirestore({
      [PATH]: {
        receptionistHoursScope: AccessScope.None,
        barberTimeOffScope: AccessScope.All,
        writeOperationId: 'op-1',
        adminHoursScope: AccessScope.None,
      },
    });

    const cells = recorded(
      staffPermissionsStreamPorts(asDb(fake)).observeStaffPermissions(),
    );

    expect(cells.seen).toEqual([
      Result.ok({
        ...StaffPermissions.UNSET,
        receptionistHoursScope: AccessScope.None,
        barberTimeOffScope: AccessScope.All,
      }),
    ]);
  });

  it('reads a value nobody can read as NOBODY, never as the default', () => {
    const fake = new FakeFirestore({
      [PATH]: { receptionistHoursScope: 'EVERYONE', barberHoursScope: 7 },
    });

    const cells = recorded(
      staffPermissionsStreamPorts(asDb(fake)).observeStaffPermissions(),
    );

    expect(cells.seen).toEqual([
      Result.ok({
        ...StaffPermissions.UNSET,
        receptionistHoursScope: AccessScope.None,
        barberHoursScope: AccessScope.None,
      }),
    ]);
  });

  it('follows the owner’s save while the listener is open', () => {
    const fake = new FakeFirestore();
    const cells = recorded(
      staffPermissionsStreamPorts(asDb(fake)).observeStaffPermissions(),
    );

    fake.set(PATH, { receptionistHoursScope: AccessScope.None });

    expect(cells.seen).toEqual([
      Result.ok(StaffPermissions.UNSET),
      Result.ok({
        ...StaffPermissions.UNSET,
        receptionistHoursScope: AccessScope.None,
      }),
    ]);
  });

  it('hands a refused read on as the port’s error', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const cells = recorded(
      staffPermissionsStreamPorts(asDb(fake)).observeStaffPermissions(),
    );

    expect(cells.seen).toEqual([
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: PATH,
        reason: 'permission-denied',
      }),
    ]);
  });
});
