import { describe, expect, it } from 'vitest';
import {
  Actor,
  BarberActivation,
  BarberStatus,
  Role,
  StaffSetupItem,
  WriteOp,
} from '@core/components';
import { AuditEntryId, OperationId, Result, UserId } from '@core/primitives';
import { AccessErrorCode, TeamErrorCode } from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type Service,
  STAFF_PERMISSIONS_DOC,
  type User,
} from '@core/entities';
import { AuditSystem, StaffSetupSystem, TeamSystem } from '@core/systems';
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
  utcMs,
} from '@core/testing';
import {
  type ActivateBarberCommand,
  activateBarber,
} from './activate-barber.pipeline';
import { TEAM_SERVICES } from './team-caller.pipeline';

/*
 * `activateBarber` (team onboarding D9): the idempotent go-live step. The
 * token gate (any staff role), then ONE commit that reads the caller, the
 * record, its roster and every service, and takes a ready DRAFT live —
 * the record whole beside its ONE `TEAM_BARBER_STATUS_CHANGED` row.
 */

const CALLER = UserId.of('u-desk');
const OP = OperationId.of('operation-live-012345678');
const IVAN = FIXTURE_IDS.barber;

/** The front desk: whoever saved the last needed item may trigger the step. */
const STORED_DESK: User = registeredUserFixture({
  id: CALLER,
  roles: [Role.Receptionist],
});
/** Ivan as a draft bound for the public catalogue, added some weeks ago. */
const DRAFT: Barber = barberFixture(
  {},
  {
    barberStatus: BarberStatus.Draft,
    barberStatusChangedAtUtcMs: utcMs('2026-01-05T08:00:00Z'),
    barberDraftTargetStatus: BarberStatus.Public,
  },
);

type RigOptions = {
  readonly caller?: User | null;
  readonly barber?: Barber | null;
  readonly schedule?: BarberSchedule | null;
  readonly services?: readonly Service[];
};

/** A store where the draft is READY by default: Ivan's roster and a service that lists him. */
function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_DESK : options.caller;
  const barber = options.barber === undefined ? DRAFT : options.barber;
  const schedule =
    options.schedule === undefined ? barberScheduleFixture() : options.schedule;
  const store = memoryStore([
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
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
    ...(options.services ?? [serviceFixture()]).map((service) => ({
      path: [Collections.Services, service.id],
      body: bodyOf(service),
    })),
  ]);
  const tx = memoryTxPorts(store);
  return { store, tx, run: activateBarber(tx) };
}

const call = (
  extra: Partial<ActivateBarberCommand> = {},
): ActivateBarberCommand => ({
  callerUserId: CALLER,
  callerRoles: [Role.Receptionist],
  operationId: OP,
  barberId: IVAN,
  ...extra,
});

describe('activateBarber', () => {
  it('takes a ready DRAFT live at its target status: the record whole and its ONE row, in one plan', async () => {
    const { store, tx, run } = rig();
    const answer = await run(call());
    expect(answer).toEqual(
      Result.ok({
        barberId: IVAN,
        barberActivation: BarberActivation.Activated,
      }),
    );
    // The callable answers this value as it is: exactly the wire's keys.
    expect(Object.keys(unwrapOk(answer))).toEqual([
      'barberId',
      'barberActivation',
    ]);

    const live = TeamSystem.activate(
      DRAFT,
      StaffSetupSystem.checklistOf(
        DRAFT,
        [serviceFixture()],
        barberScheduleFixture(),
      ),
      FIXTURE_NOW_UTC_MS,
      OP,
    ).barber;
    if (live === null) throw new Error('the fixture draft is ready');
    const row = AuditSystem.planTeamBarber(
      'TEAM_BARBER_STATUS_CHANGED',
      IVAN,
      DRAFT,
      live,
      TeamSystem.changedFields(DRAFT, live),
      Actor.forCaller(CALLER, [Role.Receptionist]),
      FIXTURE_NOW_UTC_MS,
      OP,
    );
    expect(tx.plans).toEqual([
      [
        WriteOp.set([Collections.Barbers, IVAN], bodyOf(live)),
        WriteOp.create(
          [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
          row.row,
        ),
      ],
    ]);
    // Exactly the PUBLIC variant: the draft's target field is gone.
    const stored = store.get(`${Collections.Barbers}/${IVAN}`);
    expect(stored).toMatchObject({
      barberStatus: BarberStatus.Public,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      writeOperationId: OP,
    });
    expect(Object.keys(stored ?? {})).not.toContain('barberDraftTargetStatus');
  });

  it('credits the row to whoever triggered the step, naming both statuses', async () => {
    const { tx, run } = rig();
    await run(call());
    expect(auditRowsOf(tx.plans)).toHaveLength(1);
    expect(auditRowsOf(tx.plans)[0]).toMatchObject({
      auditAction: 'TEAM_BARBER_STATUS_CHANGED',
      resourceId: `barbers/${IVAN}`,
      auditOperationId: OP,
      ...Actor.forCaller(CALLER, [Role.Receptionist]),
      teamBarberFields: [
        'barberDraftTargetStatus',
        'barberStatus',
        'barberStatusChangedAtUtcMs',
      ],
      teamBarberStatusFrom: BarberStatus.Draft,
      teamBarberStatusTo: BarberStatus.Public,
    });
  });

  it('goes live staff-only when that is where the admin pointed the draft', async () => {
    const { store, run } = rig({
      barber: barberFixture(
        {},
        {
          barberStatus: BarberStatus.Draft,
          barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
          barberDraftTargetStatus: BarberStatus.StaffOnly,
        },
      ),
    });
    await run(call());
    expect(store.get(`${Collections.Barbers}/${IVAN}`)?.['barberStatus']).toBe(
      BarberStatus.StaffOnly,
    );
  });

  it('reads the caller, the record, its roster and every service — in one round trip', async () => {
    const { tx, run } = rig();
    await run(call());
    expect(tx.transactions).toHaveLength(1);
    // The owner's cells ride the shared caller read; the step asks none of them.
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Users, CALLER],
      [Collections.Settings, STAFF_PERMISSIONS_DOC],
      [Collections.Barbers, IVAN],
      [Collections.BarberSchedules, IVAN],
    ]);
    expect(tx.transactions[0]?.queries).toEqual([TEAM_SERVICES]);
  });

  it('answers NOT_READY with the first needed item missing — and writes nothing', async () => {
    const noHours = rig({ schedule: null });
    expect(await noHours.run(call())).toEqual(
      Result.ok({
        barberId: IVAN,
        barberActivation: BarberActivation.NotReady,
        staffSetupItem: StaffSetupItem.Hours,
      }),
    );
    expect(noHours.tx.plans).toEqual([[]]);
    // Services come before hours on the checklist.
    const nothing = rig({ schedule: null, services: [] });
    expect(unwrapOk(await nothing.run(call()))).toMatchObject({
      barberActivation: BarberActivation.NotReady,
      staffSetupItem: StaffSetupItem.Services,
    });
    expect(
      nothing.store.get(`${Collections.Barbers}/${IVAN}`)?.['barberStatus'],
    ).toBe(BarberStatus.Draft);
  });

  it('answers UNCHANGED for a live record — so the replay of a step that landed writes no second row', async () => {
    const { tx, run } = rig();
    await run(call());
    expect(await run(call())).toEqual(
      Result.ok({
        barberId: IVAN,
        barberActivation: BarberActivation.Unchanged,
      }),
    );
    expect(tx.plans[1]).toEqual([]);
    expect(auditRowsOf(tx.plans)).toHaveLength(1);
    // A record that was never a draft, whatever its checklist says.
    const live = rig({ barber: barberFixture(), schedule: null, services: [] });
    expect(unwrapOk(await live.run(call())).barberActivation).toBe(
      BarberActivation.Unchanged,
    );
    expect(live.tx.plans).toEqual([[]]);
  });

  it('is any staff account’s: a client token is turned away before any read, a stored client after it', async () => {
    const NOT_STAFF = { errorCode: AccessErrorCode.NotStaff };
    const { tx, run } = rig();
    expect(unwrapErr(await run(call({ callerUserId: null })))).toEqual({
      errorCode: TeamErrorCode.Unauthenticated,
    });
    expect(unwrapErr(await run(call({ callerRoles: [Role.Client] })))).toEqual(
      NOT_STAFF,
    );
    expect(tx.transactions).toHaveLength(0);

    for (const caller of [
      registeredUserFixture({ id: CALLER, roles: [Role.Client] }),
      null,
    ]) {
      const stored = rig({ caller });
      expect(unwrapErr(await stored.run(call()))).toEqual(NOT_STAFF);
      expect(stored.tx.plans).toEqual([]);
    }
  });

  it('stays the fixed staff tier: no cell the owner sets takes the step from a staff member', async () => {
    for (const role of [Role.Barber, Role.Receptionist, Role.ContentManager]) {
      const { store, run } = rig({
        caller: registeredUserFixture({ id: CALLER, roles: [role] }),
      });
      // Every cell this level has, at nobody — the step is no capability (P2).
      store.set(`${Collections.Settings}/${STAFF_PERMISSIONS_DOC}`, {
        barberHoursScope: 'NONE',
        barberTeamProfilesScope: 'NONE',
        receptionistHoursScope: 'NONE',
        contentManagerTeamProfilesScope: 'NONE',
      });
      expect((await run(call({ callerRoles: [role] }))).ok, role).toBe(true);
    }
  });

  it('answers TEAM_BARBER_NOT_FOUND for an id with no record', async () => {
    const { tx, run } = rig({ barber: null });
    expect(unwrapErr(await run(call()))).toEqual({
      errorCode: TeamErrorCode.BarberNotFound,
      barberId: IVAN,
    });
    expect(tx.plans).toEqual([]);
  });
});
