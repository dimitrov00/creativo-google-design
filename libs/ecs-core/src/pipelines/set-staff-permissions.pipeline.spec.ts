import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  BlockReason,
  type DocBody,
  type PermissionChange,
  Role,
  StaffPermissions,
  WriteOp,
} from '@core/components';
import {
  AccessScope,
  AuditEntryId,
  LogEvent,
  OperationId,
  Result,
  StaffCapability,
  UserId,
} from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { Collections, STAFF_PERMISSIONS_DOC, type User } from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { AuditSystem } from '@core/systems';
import {
  auditRowsOf,
  bodyOf,
  contendedCommit,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryClockPorts,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  admitPermissionsCaller,
  type SetStaffPermissionsCommand,
  setStaffPermissions,
} from './set-staff-permissions.pipeline';

/*
 * `setStaffPermissions` (staff permissions P6, P11; stage A, exit test 4):
 * the token gate, then ONE commit that reads the caller and the stored
 * cells, and SETS the whole document beside its ONE
 * `TEAM_PERMISSIONS_CHANGED` row — or, for a save that changes nothing,
 * writes nothing at all.
 */

const OWNER = UserId.of('u-owner');
const OP = OperationId.of('operation-permissions-0123456789');
const PATH = [Collections.Settings, STAFF_PERMISSIONS_DOC];
const KEY = `${Collections.Settings}/${STAFF_PERMISSIONS_DOC}`;
const { None, Own, All } = AccessScope;
const { Hours, TimeOff, TeamManage } = StaffCapability;

const STORED_OWNER: User = registeredUserFixture({
  id: OWNER,
  roles: [Role.Admin],
});

type RigOptions = {
  readonly caller?: User | null;
  /** The stored document's body; none by default — no document. */
  readonly stored?: DocBody;
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_OWNER : options.caller;
  const store = memoryStore([
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
    ...(options.stored === undefined
      ? []
      : [{ path: PATH, body: options.stored }]),
  ]);
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  return {
    store,
    tx,
    telemetry,
    run: setStaffPermissions({
      ...tx,
      commit,
      ...memoryClockPorts(FIXTURE_NOW_UTC_MS),
      log: telemetry.log,
    }),
  };
}

const change = (
  role: Role,
  staffCapability: StaffCapability,
  accessScope: AccessScope,
): PermissionChange => ({ staffCapability, role, accessScope });

const call = (
  changes: readonly PermissionChange[],
  extra: Partial<SetStaffPermissionsCommand> = {},
): SetStaffPermissionsCommand => ({
  adminUserId: OWNER,
  adminRoles: [Role.Admin],
  operationId: OP,
  changes,
  ...extra,
});

const NARROW_DESK = [change(Role.Receptionist, Hours, None)];
const DESK_CHANGE = {
  staffCapability: Hours,
  role: Role.Receptionist,
  accessScopeFrom: All,
  accessScopeTo: None,
};

describe('setStaffPermissions', () => {
  it('SETS the whole document — every cell, stamped — and its ONE row, in one plan', async () => {
    const { store, tx, run } = rig();
    const answer = await run(call(NARROW_DESK));
    expect(answer).toEqual(Result.ok({ changes: [DESK_CHANGE] }));
    // The callable answers this value as it is: exactly the wire's keys.
    expect(Object.keys(unwrapOk(answer))).toEqual(['changes']);

    const body = {
      ...StaffPermissions.UNSET,
      receptionistHoursScope: None,
      writeOperationId: OP,
    };
    const row = AuditSystem.planPermissionsChanged(
      [DESK_CHANGE],
      Actor.forCaller(OWNER, [Role.Admin]),
      FIXTURE_NOW_UTC_MS,
      OP,
    );
    expect(tx.plans).toEqual([
      [
        WriteOp.set(PATH, body),
        WriteOp.create(
          [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
          row.row,
        ),
      ],
    ]);
    // The body is whole: all eighteen cells and the stamp, nothing else.
    expect(Object.keys(store.get(KEY) ?? {}).sort()).toEqual(
      [...Object.keys(StaffPermissions.UNSET), 'writeOperationId'].sort(),
    );
    expect(store.get(KEY)).toEqual(body);
  });

  it('reads the caller and the stored cells in one round trip, and nothing else', async () => {
    const { tx, run } = rig();
    await run(call(NARROW_DESK));
    expect(tx.transactions).toHaveLength(1);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Users, OWNER],
      PATH,
    ]);
    expect(tx.transactions[0]?.queries).toEqual([]);
  });

  it('writes ONE row per save, whatever the number of cells — on the settings document, keyed by the operation', async () => {
    const { tx, run } = rig();
    await run(
      call([
        change(Role.Receptionist, Hours, None),
        change(Role.Barber, TimeOff, All),
        change(Role.ContentManager, TeamManage, All),
      ]),
    );
    const rows = auditRowsOf(tx.plans);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: 'TEAM_PERMISSIONS_CHANGED',
      resourceId: 'settings/staffPermissions',
      auditOperationId: OP,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      ...Actor.forCaller(OWNER, [Role.Admin]),
      permissionChanges: [
        DESK_CHANGE,
        {
          staffCapability: TimeOff,
          role: Role.Barber,
          accessScopeFrom: Own,
          accessScopeTo: All,
        },
        {
          staffCapability: TeamManage,
          role: Role.ContentManager,
          accessScopeFrom: None,
          accessScopeTo: All,
        },
      ],
    });
  });

  it('stores null for a cell put back to its default, and keeps the cells it did not name', async () => {
    const { store, run } = rig({
      stored: {
        ...StaffPermissions.UNSET,
        receptionistHoursScope: None,
        barberTimeOffScope: All,
        writeOperationId: 'operation-earlier-0123456789',
      },
    });
    const answer = await run(call([change(Role.Receptionist, Hours, All)]));
    expect(unwrapOk(answer).changes).toEqual([
      {
        staffCapability: Hours,
        role: Role.Receptionist,
        accessScopeFrom: None,
        accessScopeTo: All,
      },
    ]);
    expect(store.get(KEY)).toEqual({
      ...StaffPermissions.UNSET,
      barberTimeOffScope: All,
      writeOperationId: OP,
    });
  });

  it('writes nothing for a save that changes no cell — no document, no row', async () => {
    const { store, tx, telemetry, run } = rig();
    const answer = await run(
      call([
        // Each is what the cell already grants.
        change(Role.Receptionist, Hours, All),
        change(Role.Barber, Hours, Own),
      ]),
    );
    expect(answer).toEqual(Result.ok({ changes: [] }));
    expect(tx.plans).toEqual([[]]);
    expect(store.has(KEY)).toBe(false);
    expect(auditRowsOf(tx.plans)).toEqual([]);
    expect(telemetry.lines).toEqual([]);
    // An empty save is the same.
    expect(await run(call([]))).toEqual(Result.ok({ changes: [] }));
    expect(store.has(KEY)).toBe(false);
  });

  it('writes nothing on a replay: the same save over what its first run wrote changes no cell', async () => {
    const { store, tx, run } = rig();
    await run(call(NARROW_DESK));
    const written = store.get(KEY);
    const again = await run(call(NARROW_DESK));
    expect(again).toEqual(Result.ok({ changes: [] }));
    expect(tx.plans).toHaveLength(2);
    expect(tx.plans[1]).toEqual([]);
    expect(store.get(KEY)).toEqual(written);
    expect(auditRowsOf(tx.plans)).toHaveLength(1);
  });

  it('derives the same plan when the transaction re-runs (contention): the instant is read once', async () => {
    let decisions: readonly (readonly WriteOp[])[] = [];
    const { tx, run } = rig({
      commit: (commit) => {
        const contended = contendedCommit(commit);
        decisions = contended.decisions;
        return contended.commit;
      },
    });
    await run(call(NARROW_DESK));
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toEqual(decisions[1]);
    expect(tx.plans).toEqual([decisions[1]]);
  });

  it('logs the count of changed cells — never a cell, never an id', async () => {
    const { telemetry, run } = rig();
    await run(call(NARROW_DESK));
    expect(telemetry.lines).toEqual([
      {
        level: 'info',
        msg: LogEvent.PermissionsChanged,
        fields: { changedCount: 1 },
      },
    ]);
  });

  describe('the caller', () => {
    it('refuses no session and a token without the admin role before any read', async () => {
      const { tx, telemetry, run } = rig();
      expect(
        unwrapErr(await run(call(NARROW_DESK, { adminUserId: null }))),
      ).toEqual({
        errorCode: GovernanceErrorCode.PermissionsUnauthenticated,
      });
      for (const adminRoles of [
        [Role.Sysadmin],
        [Role.Receptionist],
        [Role.Barber, Role.ContentManager],
        [],
      ]) {
        expect(unwrapErr(await run(call(NARROW_DESK, { adminRoles })))).toEqual(
          {
            errorCode: GovernanceErrorCode.PermissionsForbidden,
            callerUserId: OWNER,
          },
        );
      }
      expect(tx.transactions).toEqual([]);
      expect(telemetry.lines).toHaveLength(5);
      expect(
        telemetry.lines.every(
          (line) => line.msg === LogEvent.PermissionsChangeRefused,
        ),
      ).toBe(true);
    });

    it('admitPermissionsCaller: the uid of an admin token, else the refusal', () => {
      expect(admitPermissionsCaller(OWNER, [Role.Admin])).toEqual(
        Result.ok(OWNER),
      );
      expect(admitPermissionsCaller(OWNER, [Role.Barber, Role.Admin]).ok).toBe(
        true,
      );
      expect(unwrapErr(admitPermissionsCaller(null, [Role.Admin]))).toEqual({
        errorCode: GovernanceErrorCode.PermissionsUnauthenticated,
      });
    });

    it('judges the STORED account behind the token: demoted, blocked or gone is refused, and nothing is written', async () => {
      const stale: (User | null)[] = [
        // The token still says admin; the account no longer does.
        registeredUserFixture({ id: OWNER, roles: [Role.Receptionist] }),
        registeredUserFixture({ id: OWNER, roles: [Role.Sysadmin] }),
        registeredUserFixture({
          id: OWNER,
          roles: [Role.Admin],
          ...AccountLifecycle.block(BlockReason.Manual, null),
        }),
        null,
      ];
      for (const caller of stale) {
        const { store, tx, telemetry, run } = rig({ caller });
        expect(unwrapErr(await run(call(NARROW_DESK)))).toEqual({
          errorCode: GovernanceErrorCode.PermissionsForbidden,
          callerUserId: OWNER,
        });
        expect(tx.plans).toEqual([]);
        expect(store.has(KEY)).toBe(false);
        expect(telemetry.lines).toEqual([
          {
            level: 'info',
            msg: LogEvent.PermissionsChangeRefused,
            fields: { errorCode: GovernanceErrorCode.PermissionsForbidden },
          },
        ]);
      }
    });
  });

  describe('the save', () => {
    it('refuses a cell that is not on offer, whole — a valid cell beside it is not written either', async () => {
      const cases: [PermissionChange, AccessScope][] = [
        [change(Role.Admin, Hours, None), None],
        [change(Role.Sysadmin, Hours, All), All],
        [change(Role.Client, Hours, All), All],
        [change(Role.Receptionist, Hours, Own), Own],
        [change(Role.Barber, TeamManage, Own), Own],
      ];
      for (const [bad, accessScope] of cases) {
        const { store, tx, run } = rig();
        expect(
          unwrapErr(await run(call([NARROW_DESK[0] as PermissionChange, bad]))),
        ).toEqual({
          errorCode: GovernanceErrorCode.PermissionsNotOffered,
          staffCapability: bad.staffCapability,
          role: bad.role,
          accessScope,
        });
        expect(tx.plans).toEqual([]);
        expect(store.has(KEY)).toBe(false);
      }
    });

    it('refuses a cell named twice', async () => {
      const { tx, run } = rig();
      expect(
        unwrapErr(
          await run(
            call([
              change(Role.Barber, Hours, All),
              change(Role.Barber, Hours, None),
            ]),
          ),
        ),
      ).toEqual({
        errorCode: GovernanceErrorCode.PermissionsInvalid,
        field: 'changes',
      });
      expect(tx.plans).toEqual([]);
    });

    it('repairs a hand-edited document: bad cells read as nobody, and the save writes a valid whole body', async () => {
      const { store, run } = rig({
        stored: {
          receptionistHoursScope: 'EVERYONE',
          barberHoursScope: 7,
          // A document written before a capability existed has no field for it.
        },
      });
      const answer = await run(call([change(Role.Receptionist, Hours, All)]));
      expect(unwrapOk(answer).changes).toEqual([
        {
          staffCapability: Hours,
          role: Role.Receptionist,
          accessScopeFrom: None,
          accessScopeTo: All,
        },
      ]);
      expect(store.get(KEY)).toEqual({
        ...StaffPermissions.UNSET,
        barberHoursScope: None,
        writeOperationId: OP,
      });
    });
  });
});
