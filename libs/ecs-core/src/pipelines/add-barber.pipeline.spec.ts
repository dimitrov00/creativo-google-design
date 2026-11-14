import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  BarberStatus,
  BlockReason,
  type DocBody,
  Role,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
  LocationId,
  OperationId,
  Result,
  UserId,
} from '@core/primitives';
import { AccessErrorCode, TeamErrorCode } from '@core/errors';
import {
  type Barber,
  Collections,
  STAFF_PERMISSIONS_DOC,
  type User,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { AuditSystem, TeamSystem } from '@core/systems';
import {
  auditRowsOf,
  barberFixture,
  bodyOf,
  contendedCommit,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { type AddBarberCommand, addBarber } from './add-barber.pipeline';
import { TEAM_BARBERS, TEAM_LOCATIONS } from './team-caller.pipeline';

/*
 * `addBarber` (team onboarding D5; staff permissions P6): the token gate
 * (any staff role), then ONE commit that reads the caller and the owner's
 * cells, the record the act names, every shop and every barber record,
 * asks `TEAM_MANAGE` of the stored account, and writes the DRAFT whole
 * beside its ONE `TEAM_BARBER_ADDED` row. The act's id IS the record's
 * id, so a replay writes nothing.
 */

const ADMIN = UserId.of('u-admin');
const OP = OperationId.of('operation-add-0123456789');
const NEW = BarberId.of(OP);
const CENTER = FIXTURE_IDS.location;
const MLADOST = LocationId.of('loc-mladost');
const STARTS = localDate('2026-12-01');

const STORED_ADMIN: User = registeredUserFixture({
  id: ADMIN,
  roles: [Role.Admin],
});

const PERMISSIONS = [Collections.Settings, STAFF_PERMISSIONS_DOC];
const NOT_STAFF = { errorCode: AccessErrorCode.NotStaff };
const DENIED = {
  errorCode: AccessErrorCode.Denied,
  staffCapability: 'TEAM_MANAGE',
};

type RigOptions = {
  readonly caller?: User | null;
  /** The stored `settings/staffPermissions` body; none by default — no document. */
  readonly permissions?: DocBody;
  /** The barber records already stored (default one: Ivan). */
  readonly barbers?: readonly Barber[];
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const store = memoryStore([
    ...(options.permissions === undefined
      ? []
      : [{ path: PERMISSIONS, body: options.permissions }]),
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
    ...[locationFixture(), locationFixture({ id: MLADOST })].map((shop) => ({
      path: [Collections.Locations, shop.id],
      body: bodyOf(shop),
    })),
    ...(options.barbers ?? [barberFixture()]).map((barber) => ({
      path: [Collections.Barbers, barber.id],
      body: bodyOf(barber),
    })),
  ]);
  const tx = memoryTxPorts(store);
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  return { store, tx, run: addBarber({ ...tx, commit }) };
}

const call = (extra: Partial<AddBarberCommand> = {}): AddBarberCommand => ({
  callerUserId: ADMIN,
  callerRoles: [Role.Admin],
  operationId: OP,
  name: { bg: 'Сентинел Име', en: null },
  locationIds: [CENTER],
  barberStartsLocalDate: STARTS,
  barberLastWorkingLocalDate: null,
  barberDraftTargetStatus: BarberStatus.Public,
  barberJoinsAnyPool: true,
  ...extra,
});

/** The record `TeamSystem.add` answers for the call over a store of `barberCount` records. */
const added = (cmd: AddBarberCommand, barberCount: number): Barber =>
  unwrapOk(
    TeamSystem.add(cmd, {
      barberId: NEW,
      listedShops: [{ id: CENTER }, { id: MLADOST }],
      barberCount,
      nowUtcMs: FIXTURE_NOW_UTC_MS,
      operationId: cmd.operationId,
    }),
  );

describe('addBarber', () => {
  it('commits the DRAFT whole — under the act’s own id — and its ONE row, in one plan', async () => {
    const { store, tx, run } = rig();
    const answer = await run(call());
    expect(answer).toEqual(Result.ok({ barberId: NEW }));
    // The callable answers this value as it is: exactly the wire's keys.
    expect(Object.keys(unwrapOk(answer))).toEqual(['barberId']);

    const record = added(call(), 1);
    const row = AuditSystem.planTeamBarber(
      'TEAM_BARBER_ADDED',
      NEW,
      null,
      record,
      TeamSystem.changedFields(null, record),
      Actor.forCaller(ADMIN, [Role.Admin]),
      FIXTURE_NOW_UTC_MS,
      OP,
    );
    expect(tx.plans).toEqual([
      [
        WriteOp.set([Collections.Barbers, NEW], bodyOf(record)),
        WriteOp.create(
          [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
          row.row,
        ),
      ],
    ]);
    expect(store.get(`${Collections.Barbers}/${NEW}`)).toMatchObject({
      barberStatus: BarberStatus.Draft,
      barberDraftTargetStatus: BarberStatus.Public,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      name: { bg: 'Сентинел Име', en: 'Сентинел Име' },
      locationIds: [CENTER],
      barberStartsLocalDate: STARTS,
      sortOrder: 2,
      writeOperationId: OP,
    });
  });

  it('reads the caller and the owner’s cells, the named record, every shop and every barber record — in one round trip', async () => {
    const { tx, run } = rig();
    await run(call());
    expect(tx.transactions).toHaveLength(1);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Users, ADMIN],
      PERMISSIONS,
      [Collections.Barbers, NEW],
    ]);
    expect(tx.transactions[0]?.queries).toEqual([TEAM_LOCATIONS, TEAM_BARBERS]);
  });

  it('credits the row to the caller over their STORED roles, names fields and tags only — never the name', async () => {
    const { tx, run } = rig();
    await run(call());
    const rows = auditRowsOf(tx.plans);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: 'TEAM_BARBER_ADDED',
      resourceId: `barbers/${NEW}`,
      auditOperationId: OP,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      ...Actor.forCaller(ADMIN, [Role.Admin]),
      teamBarberStatusFrom: null,
      teamBarberStatusTo: BarberStatus.Draft,
      teamBarberStartsLocalDate: STARTS,
      teamBarberLastWorkingLocalDate: null,
    });
    expect(JSON.stringify(rows)).not.toContain('Сентинел');
  });

  it('sorts the new record after every existing one', async () => {
    const { store, run } = rig({
      barbers: [
        barberFixture(),
        barberFixture({ id: BarberId.of('niko') }),
        barberFixture({ id: BarberId.of('petar') }),
      ],
    });
    await run(call());
    expect(store.get(`${Collections.Barbers}/${NEW}`)?.['sortOrder']).toBe(4);
  });

  it('writes nothing on a replay: the same act answers the record its first run wrote', async () => {
    const { store, tx, run } = rig();
    await run(call());
    const written = store.get(`${Collections.Barbers}/${NEW}`);
    // A second tap — even with other words in the sheet — is the same act.
    const again = await run(call({ name: { bg: 'Друго', en: null } }));
    expect(again).toEqual(Result.ok({ barberId: NEW }));
    expect(tx.plans).toHaveLength(2);
    expect(tx.plans[1]).toEqual([]);
    expect(store.get(`${Collections.Barbers}/${NEW}`)).toEqual(written);
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
    await run(call());
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toEqual(decisions[1]);
    expect(tx.plans).toEqual([decisions[1]]);
  });

  describe('the caller', () => {
    it('refuses no session and a token with no staff role before any read', async () => {
      const { tx, run } = rig();
      expect(unwrapErr(await run(call({ callerUserId: null })))).toEqual({
        errorCode: TeamErrorCode.Unauthenticated,
      });
      for (const callerRoles of [[Role.Client], []]) {
        expect(unwrapErr(await run(call({ callerRoles })))).toEqual(NOT_STAFF);
      }
      expect(tx.transactions).toHaveLength(0);
    });

    it('judges the STORED account, not the token: a taken-away role, a block and a missing account are refused', async () => {
      const cases: [User | null, object][] = [
        [registeredUserFixture({ id: ADMIN, roles: [Role.Barber] }), DENIED],
        [
          registeredUserFixture({
            id: ADMIN,
            roles: [Role.Admin],
            ...AccountLifecycle.block(BlockReason.Manual, null),
          }),
          NOT_STAFF,
        ],
        [null, NOT_STAFF],
      ];
      for (const [caller, refusal] of cases) {
        const { store, tx, run } = rig({ caller });
        expect(unwrapErr(await run(call()))).toEqual(refusal);
        expect(tx.plans).toEqual([]);
        expect(store.has(`${Collections.Barbers}/${NEW}`)).toBe(false);
      }
    });

    it('with no document, is the admin’s alone — every other level is refused after the read, whatever its token', async () => {
      for (const role of [
        Role.ContentManager,
        Role.Receptionist,
        Role.Barber,
        Role.Sysadmin,
      ]) {
        const { store, tx, run } = rig({
          caller: registeredUserFixture({ id: ADMIN, roles: [role] }),
        });
        expect(
          unwrapErr(await run(call({ callerRoles: [role] }))),
          role,
        ).toEqual(DENIED);
        expect(tx.plans).toEqual([]);
        expect(store.has(`${Collections.Barbers}/${NEW}`)).toBe(false);
      }
      // A staff token the admin's own account still holds is enough to ask.
      const { run } = rig();
      expect((await run(call({ callerRoles: [Role.Barber] }))).ok).toBe(true);
    });

    it('follows the owner’s cells: a level given the team adds a barber, credited over its stored roles; a bad cell gives nothing', async () => {
      const editor = registeredUserFixture({
        id: ADMIN,
        roles: [Role.ContentManager],
      });
      const widened = rig({
        caller: editor,
        permissions: { contentManagerTeamManageScope: 'ALL' },
      });
      expect(
        await widened.run(call({ callerRoles: [Role.ContentManager] })),
      ).toEqual(Result.ok({ barberId: NEW }));
      expect(auditRowsOf(widened.tx.plans)[0]).toMatchObject(
        Actor.forCaller(ADMIN, [Role.ContentManager]),
      );
      // "Own" is not on offer for the team: a hand-written one reads as nobody.
      for (const permissions of [
        { contentManagerTeamManageScope: 'OWN' },
        { contentManagerTeamManageScope: 'EVERYONE' },
      ]) {
        const { run } = rig({ caller: editor, permissions });
        expect(
          unwrapErr(await run(call({ callerRoles: [Role.ContentManager] }))),
        ).toEqual(DENIED);
      }
    });
  });

  describe('the record', () => {
    it('refuses a blank name, an unlisted shop, a last day before the start — and writes nothing', async () => {
      const { store, tx, run } = rig();
      expect(
        unwrapErr(await run(call({ name: { bg: '  ', en: 'Ivan' } }))),
      ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'name' });
      const stranger = LocationId.of('loc-nowhere');
      expect(
        unwrapErr(await run(call({ locationIds: [CENTER, stranger] }))),
      ).toEqual({ errorCode: TeamErrorCode.ShopUnknown, locationId: stranger });
      expect(
        unwrapErr(
          await run(
            call({ barberLastWorkingLocalDate: localDate('2026-11-30') }),
          ),
        ),
      ).toEqual({ errorCode: TeamErrorCode.PeriodInvalid });
      expect(tx.plans).toEqual([]);
      expect(store.has(`${Collections.Barbers}/${NEW}`)).toBe(false);
    });

    it('takes "every shop", a second shop and a staff-only target as they are', async () => {
      const { store, run } = rig();
      await run(
        call({
          locationIds: [MLADOST, CENTER, MLADOST],
          barberDraftTargetStatus: BarberStatus.StaffOnly,
          barberJoinsAnyPool: false,
        }),
      );
      expect(store.get(`${Collections.Barbers}/${NEW}`)).toMatchObject({
        locationIds: [MLADOST, CENTER],
        barberDraftTargetStatus: BarberStatus.StaffOnly,
        barberJoinsAnyPool: false,
      });
    });
  });
});
