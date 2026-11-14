import { describe, expect, it } from 'vitest';
import {
  Actor,
  BarberStatus,
  type DocBody,
  Role,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
  OperationId,
  Result,
  ServiceId,
  UserId,
} from '@core/primitives';
import { AccessErrorCode, TeamErrorCode } from '@core/errors';
import {
  BARBER_LINK_DOC,
  type Barber,
  type BarberSchedule,
  Collections,
  type Service,
  STAFF_PERMISSIONS_DOC,
  Subcollections,
  type User,
} from '@core/entities';
import { AuditSystem, TeamSystem } from '@core/systems';
import {
  auditRowsOf,
  barberFixture,
  barberScheduleFixture,
  bodyOf,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  registeredUserFixture,
  serviceFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  type DeleteDraftBarberCommand,
  deleteDraftBarber,
} from './delete-draft-barber.pipeline';
import { TEAM_SERVICES } from './team-caller.pipeline';

/*
 * `deleteDraftBarber` (team onboarding D10): a record that never went
 * live, removed with everything that names it — in ONE plan beside its ONE
 * `TEAM_BARBER_DELETED` row.
 */

const ADMIN = UserId.of('u-admin');
const LINKED = UserId.of('u-newcomer');
const OP = OperationId.of('operation-del-0123456789');
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');

const STORED_ADMIN: User = registeredUserFixture({
  id: ADMIN,
  roles: [Role.Admin],
});
const DRAFT: Barber = barberFixture(
  {},
  {
    barberStatus: BarberStatus.Draft,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDraftTargetStatus: BarberStatus.Public,
  },
);
const lockPath = [
  Collections.Barbers,
  IVAN,
  Subcollections.Restricted,
  BARBER_LINK_DOC,
];
/** A second service, performed by Ivan and Niko. */
const SHAVE: Service = serviceFixture({
  id: ServiceId.of('svc-shave'),
  offerings: [
    ...serviceFixture().offerings,
    {
      ...(serviceFixture().offerings[0] as Service['offerings'][number]),
      barberId: NIKO,
    },
  ],
});
/** A service Ivan does not perform — left alone. */
const COLOUR: Service = serviceFixture({
  id: ServiceId.of('svc-colour'),
  offerings: [
    {
      ...(serviceFixture().offerings[0] as Service['offerings'][number]),
      barberId: NIKO,
    },
  ],
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
  readonly barber?: Barber | null;
  readonly schedule?: BarberSchedule | null;
  /** The account the record's lock names; `null` is no lock. */
  readonly linked?: User | null;
  readonly services?: readonly Service[];
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const barber = options.barber === undefined ? DRAFT : options.barber;
  const schedule = options.schedule ?? null;
  const linked = options.linked ?? null;
  const store = memoryStore([
    ...(options.permissions === undefined
      ? []
      : [{ path: PERMISSIONS, body: options.permissions }]),
    ...[caller, linked].flatMap((user) =>
      user === null
        ? []
        : [{ path: [Collections.Users, user.id], body: bodyOf(user) }],
    ),
    ...(barber === null
      ? []
      : [{ path: [Collections.Barbers, barber.id], body: bodyOf(barber) }]),
    ...(schedule === null
      ? []
      : [
          {
            path: [Collections.BarberSchedules, schedule.id],
            body: bodyOf(schedule),
          },
        ]),
    ...(linked === null
      ? []
      : [{ path: lockPath, body: { linkedUserId: linked.id } }]),
    ...(options.services ?? []).map((service) => ({
      path: [Collections.Services, service.id],
      body: bodyOf(service),
    })),
  ]);
  const tx = memoryTxPorts(store);
  return { store, tx, run: deleteDraftBarber(tx) };
}

const call = (
  extra: Partial<DeleteDraftBarberCommand> = {},
): DeleteDraftBarberCommand => ({
  callerUserId: ADMIN,
  callerRoles: [Role.Admin],
  operationId: OP,
  barberId: IVAN,
  ...extra,
});

/** The record's removal and its row — the head of every plan. */
function removalOf(record: Barber) {
  const row = AuditSystem.planTeamBarber(
    'TEAM_BARBER_DELETED',
    record.id,
    record,
    null,
    TeamSystem.changedFields(record, null),
    Actor.forCaller(ADMIN, [Role.Admin]),
    FIXTURE_NOW_UTC_MS,
    OP,
  );
  return [
    WriteOp.remove([Collections.Barbers, record.id]),
    WriteOp.create(
      [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
      row.row,
    ),
  ];
}

describe('deleteDraftBarber', () => {
  it('removes a bare draft beside its ONE TEAM_BARBER_DELETED row', async () => {
    const { store, tx, run } = rig();
    const answer = await run(call());
    expect(answer).toEqual(Result.ok({ barberId: IVAN }));
    expect(Object.keys(unwrapOk(answer))).toEqual(['barberId']);
    expect(tx.plans).toEqual([removalOf(DRAFT)]);
    expect(store.has(`${Collections.Barbers}/${IVAN}`)).toBe(false);
    expect(auditRowsOf(tx.plans)[0]).toMatchObject({
      auditAction: 'TEAM_BARBER_DELETED',
      resourceId: `barbers/${IVAN}`,
      auditOperationId: OP,
      ...Actor.forCaller(ADMIN, [Role.Admin]),
      teamBarberStatusFrom: BarberStatus.Draft,
      teamBarberStatusTo: null,
    });
  });

  it('takes everything that names the record with it, in the same plan: roster, lock, link, offerings', async () => {
    const linked = registeredUserFixture({
      id: LINKED,
      roles: [Role.Barber],
      linkedBarberId: IVAN,
    });
    const { store, tx, run } = rig({
      schedule: barberScheduleFixture(),
      linked,
      services: [serviceFixture(), SHAVE, COLOUR],
    });
    await run(call());
    expect(tx.plans).toEqual([
      [
        ...removalOf(DRAFT),
        WriteOp.remove([Collections.BarberSchedules, IVAN]),
        WriteOp.remove(lockPath),
        WriteOp.update([Collections.Users, LINKED], { linkedBarberId: null }),
        // The classic cut was Ivan's alone: its list empties.
        WriteOp.update([Collections.Services, serviceFixture().id], {
          offerings: [],
        }),
        // The shave keeps Niko's offering.
        WriteOp.update([Collections.Services, SHAVE.id], {
          offerings: [SHAVE.offerings[1]],
        }),
      ],
    ]);
    expect(store.has(`${Collections.BarberSchedules}/${IVAN}`)).toBe(false);
    expect(store.has(lockPath.join('/'))).toBe(false);
    // The account keeps its roles: "barber, not linked".
    expect(store.get(`${Collections.Users}/${LINKED}`)).toMatchObject({
      roles: [Role.Barber],
      linkedBarberId: null,
    });
    expect(store.get(`${Collections.Services}/${COLOUR.id}`)).toEqual(
      bodyOf(COLOUR),
    );
  });

  it('reads the caller, the record, its roster, its lock and every service — then the linked account', async () => {
    const linked = registeredUserFixture({
      id: LINKED,
      roles: [Role.Barber],
      linkedBarberId: IVAN,
    });
    const { tx, run } = rig({ linked });
    await run(call());
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Users, ADMIN],
      PERMISSIONS,
      [Collections.Barbers, IVAN],
      [Collections.BarberSchedules, IVAN],
      lockPath,
      [Collections.Users, LINKED],
    ]);
    expect(tx.transactions[0]?.queries).toEqual([TEAM_SERVICES]);
  });

  it('removes a stale lock without touching an account that is linked elsewhere now', async () => {
    const moved = registeredUserFixture({
      id: LINKED,
      roles: [Role.Barber],
      linkedBarberId: NIKO,
    });
    const { store, tx, run } = rig({ linked: moved });
    await run(call());
    expect(tx.plans).toEqual([[...removalOf(DRAFT), WriteOp.remove(lockPath)]]);
    expect(store.get(`${Collections.Users}/${LINKED}`)).toEqual(bodyOf(moved));
  });

  it('refuses a record that has been live as TEAM_NOT_DRAFT — and writes nothing', async () => {
    const { store, tx, run } = rig({
      barber: barberFixture(),
      schedule: barberScheduleFixture(),
      services: [serviceFixture()],
    });
    expect(unwrapErr(await run(call()))).toEqual({
      errorCode: TeamErrorCode.NotDraft,
      barberId: IVAN,
    });
    expect(tx.plans).toEqual([]);
    expect(store.has(`${Collections.Barbers}/${IVAN}`)).toBe(true);
    expect(store.has(`${Collections.BarberSchedules}/${IVAN}`)).toBe(true);
  });

  it('answers TEAM_BARBER_NOT_FOUND for an id with no record — the second of two taps', async () => {
    const { tx, run } = rig();
    await run(call());
    expect(unwrapErr(await run(call()))).toEqual({
      errorCode: TeamErrorCode.BarberNotFound,
      barberId: IVAN,
    });
    expect(tx.plans).toHaveLength(1);
    expect(auditRowsOf(tx.plans)).toHaveLength(1);
  });

  it('turns away no session and a token with no staff role before any read', async () => {
    const { tx, run } = rig();
    expect(unwrapErr(await run(call({ callerUserId: null })))).toEqual({
      errorCode: TeamErrorCode.Unauthenticated,
    });
    for (const callerRoles of [[Role.Client], []]) {
      expect(unwrapErr(await run(call({ callerRoles })))).toEqual(NOT_STAFF);
    }
    expect(tx.transactions).toHaveLength(0);
  });

  it('with no document, is the admin’s alone: every other stored account is refused, and the draft stays', async () => {
    for (const role of [
      Role.ContentManager,
      Role.Receptionist,
      Role.Barber,
      Role.Sysadmin,
    ]) {
      const { store, tx, run } = rig({
        caller: registeredUserFixture({ id: ADMIN, roles: [role] }),
      });
      // The token still says admin; the stored account decides.
      expect(unwrapErr(await run(call())), role).toEqual(DENIED);
      expect(tx.plans).toEqual([]);
      expect(store.has(`${Collections.Barbers}/${IVAN}`)).toBe(true);
    }
    const gone = rig({ caller: null });
    expect(unwrapErr(await gone.run(call()))).toEqual(NOT_STAFF);
  });

  it('follows the owner’s cells: a level given the team deletes a draft', async () => {
    const { store, run } = rig({
      caller: registeredUserFixture({ id: ADMIN, roles: [Role.Receptionist] }),
      permissions: { receptionistTeamManageScope: 'ALL' },
    });
    expect(await run(call({ callerRoles: [Role.Receptionist] }))).toEqual(
      Result.ok({ barberId: IVAN }),
    );
    expect(store.has(`${Collections.Barbers}/${IVAN}`)).toBe(false);
  });
});
