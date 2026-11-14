import { describe, expect, it } from 'vitest';
import { Actor, Role, StaffPermissions } from '@core/components';
import { Result, UserId } from '@core/primitives';
import {
  AccessErrorCode,
  RepositoryError,
  RepositoryErrorCode,
  TeamErrorCode,
} from '@core/errors';
import { Collections, STAFF_PERMISSIONS_DOC } from '@core/entities';
import {
  bodyOf,
  memoryProfileLoadPorts,
  memoryStaffPermissionsPorts,
  memoryStore,
  memoryTxPorts,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  admitTeamCaller,
  loadStaffCaller,
  readStaffCaller,
  type StaffCallerFacts,
  TEAM_BARBERS,
  TEAM_LOCATIONS,
  TEAM_ROSTERS,
  TEAM_SERVICES,
  TEAM_STAFF_ACCOUNTS,
  TEAM_STAFF_ACCOUNTS_MAX,
  type TeamCaller,
  teamActor,
} from './team-caller.pipeline';

const UID = UserId.of('u-caller');
const caller = (
  roles: readonly Role[],
  callerUserId: UserId | null = UID,
): TeamCaller => ({ callerUserId, callerRoles: roles });

describe('admitTeamCaller — the one token gate of the team acts', () => {
  it('admits a token holding any staff role — which staff, and for what, the stored account decides', () => {
    for (const role of [
      Role.Admin,
      Role.Sysadmin,
      Role.ContentManager,
      Role.Receptionist,
      Role.Barber,
    ]) {
      expect(unwrapOk(admitTeamCaller(caller([role]))), role).toBe(UID);
    }
    expect(unwrapOk(admitTeamCaller(caller([Role.Client, Role.Barber])))).toBe(
      UID,
    );
  });

  it('refuses no session as TEAM_UNAUTHENTICATED — before the roles are read', () => {
    expect(unwrapErr(admitTeamCaller(caller([Role.Admin], null)))).toEqual({
      errorCode: TeamErrorCode.Unauthenticated,
    });
  });

  it('refuses a client and an empty claim as ACCESS_NOT_STAFF', () => {
    for (const roles of [[Role.Client], []]) {
      expect(unwrapErr(admitTeamCaller(caller(roles)))).toEqual({
        errorCode: AccessErrorCode.NotStaff,
      });
    }
  });
});

describe('readStaffCaller / loadStaffCaller — what a caller is judged on', () => {
  const STORED = registeredUserFixture({ id: UID, roles: [Role.Receptionist] });
  const PATH = [Collections.Settings, STAFF_PERMISSIONS_DOC];

  /** The facts read inside a transaction over `documents`. */
  async function inTransaction(
    documents: Parameters<typeof memoryStore>[0],
  ): Promise<{
    readonly facts: StaffCallerFacts;
    readonly reads: readonly (readonly string[])[];
  }> {
    const tx = memoryTxPorts(memoryStore(documents));
    const committed = await tx.commit(
      (read) => readStaffCaller(read, UID),
      (facts) => Result.ok({ facts, writes: [] }),
    );
    return {
      facts: unwrapOk(committed).facts,
      reads: tx.transactions[0]?.reads ?? [],
    };
  }

  it('reads the account and the cells in one round trip — two documents, nothing else', async () => {
    const { facts, reads } = await inTransaction([
      { path: [Collections.Users, UID], body: bodyOf(STORED) },
      { path: PATH, body: { receptionistHoursScope: 'NONE' } },
    ]);
    expect(reads).toEqual([[Collections.Users, UID], PATH]);
    expect(facts.caller).toEqual(STORED);
    expect(facts.permissions).toEqual({
      ...StaffPermissions.UNSET,
      receptionistHoursScope: 'NONE',
    });
  });

  it('answers no account as null, and no document as every cell at its default', async () => {
    const { facts } = await inTransaction([]);
    expect(facts).toEqual({
      caller: null,
      permissions: StaffPermissions.UNSET,
    });
  });

  it('hands the stored cells through the guard: a value nobody could save reads as nobody', async () => {
    const { facts } = await inTransaction([
      { path: PATH, body: { barberHoursScope: 'EVERYONE', junk: true } },
    ]);
    expect(facts.permissions).toEqual({
      ...StaffPermissions.UNSET,
      barberHoursScope: 'NONE',
    });
  });

  it('reads the same facts through ports, for a call with no transaction', async () => {
    const permissions = StaffPermissions.read({ barberAnalyticsScope: 'ALL' });
    const ports = {
      ...memoryProfileLoadPorts([STORED]),
      ...memoryStaffPermissionsPorts(permissions),
    };
    expect(unwrapOk(await loadStaffCaller(ports, UID))).toEqual({
      caller: STORED,
      permissions,
    });
    expect(
      unwrapOk(await loadStaffCaller(ports, UserId.of('u-nobody'))),
    ).toEqual({ caller: null, permissions });
    // No cells given: every one at its default.
    expect(
      unwrapOk(
        await loadStaffCaller(
          { ...ports, ...memoryStaffPermissionsPorts() },
          UID,
        ),
      ).permissions,
    ).toEqual(StaffPermissions.UNSET);
  });

  it('answers either failed read as it failed', async () => {
    const failure = RepositoryError.readFailed(
      'users/u-caller',
      RepositoryErrorCode.ReadFailed,
    );
    const working = {
      ...memoryProfileLoadPorts([STORED]),
      ...memoryStaffPermissionsPorts(),
    };
    expect(
      unwrapErr(
        await loadStaffCaller(
          { ...working, loadProfile: async () => Result.err(failure) },
          UID,
        ),
      ),
    ).toEqual(failure);
    expect(
      unwrapErr(
        await loadStaffCaller(
          { ...working, loadStaffPermissions: async () => Result.err(failure) },
          UID,
        ),
      ),
    ).toEqual(failure);
  });
});

describe('teamActor — who a team row credits', () => {
  it('credits the caller over the roles their account STORES', () => {
    expect(
      teamActor(UID, registeredUserFixture({ id: UID, roles: [Role.Admin] })),
    ).toEqual(Actor.forCaller(UID, [Role.Admin]));
    expect(
      teamActor(
        UID,
        registeredUserFixture({ id: UID, roles: [Role.Receptionist] }),
      ),
    ).toEqual(Actor.forCaller(UID, [Role.Receptionist]));
  });
});

describe('the team pipelines’ whole-collection reads', () => {
  it('read every shop, barber record and service — no filter, no order, no limit', () => {
    expect([TEAM_LOCATIONS, TEAM_BARBERS, TEAM_SERVICES]).toEqual([
      {
        collection: [Collections.Locations],
        where: [],
        orderBy: [],
        limit: null,
      },
      {
        collection: [Collections.Barbers],
        where: [],
        orderBy: [],
        limit: null,
      },
      {
        collection: [Collections.Services],
        where: [],
        orderBy: [],
        limit: null,
      },
    ]);
  });

  it('read every roster, and the staff accounts by their stored roles — bounded', () => {
    expect(TEAM_ROSTERS).toEqual({
      collection: [Collections.BarberSchedules],
      where: [],
      orderBy: [],
      limit: null,
    });
    expect(TEAM_STAFF_ACCOUNTS).toEqual({
      collection: [Collections.Users],
      where: [
        {
          field: 'roles',
          op: 'array-contains-any',
          value: [
            Role.Barber,
            Role.Receptionist,
            Role.ContentManager,
            Role.Admin,
            Role.Sysadmin,
          ],
        },
      ],
      orderBy: [],
      limit: 200,
    });
    expect(TEAM_STAFF_ACCOUNTS_MAX).toBe(200);
  });
});
