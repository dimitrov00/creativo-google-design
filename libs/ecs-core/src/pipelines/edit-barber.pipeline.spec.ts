import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  BarberEdit,
  type BarberEditRequest,
  BarberStatus,
  BlockReason,
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
import { RepositoryErrorCode, TeamErrorCode } from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type ShopLocation,
  type User,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { AuditSystem, TeamSystem } from '@core/systems';
import {
  auditRowsOf,
  barberFixture,
  barberScheduleFixture,
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
import { type EditBarberCommand, editBarber } from './edit-barber.pipeline';
import { TEAM_LOCATIONS } from './team-caller.pipeline';

/*
 * `editBarber` (team onboarding D5): one part of one record, replaced
 * whole. The token gate (staff for a profile, the admin for the rest), then
 * ONE commit that reads the caller and the record — and the shops and the
 * roster for a shops edit — and writes the record whole beside its ONE row.
 */

const ADMIN = UserId.of('u-admin');
const OP = OperationId.of('operation-edit-012345678');
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');
const CENTER = FIXTURE_IDS.location;
const MLADOST = LocationId.of('loc-mladost');

const STORED_ADMIN: User = registeredUserFixture({
  id: ADMIN,
  roles: [Role.Admin],
});
const SHOPS: readonly ShopLocation[] = [
  locationFixture(),
  locationFixture({ id: MLADOST }),
];
/** Ivan as stored: public, at the centre shop. */
const STORED_IVAN: Barber = barberFixture();
const DEPARTED: Barber = barberFixture(
  {},
  {
    barberStatus: BarberStatus.Departed,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDepartedUserId: null,
    barberSessionsRevokedAtUtcMs: null,
    barberRehireStatus: BarberStatus.Public,
  },
);

type RigOptions = {
  readonly caller?: User | null;
  readonly barber?: Barber | null;
  readonly shops?: readonly ShopLocation[];
  readonly schedule?: BarberSchedule | null;
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const barber = options.barber === undefined ? STORED_IVAN : options.barber;
  const schedule = options.schedule ?? null;
  const store = memoryStore([
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
    ...(barber === null
      ? []
      : [{ path: [Collections.Barbers, barber.id], body: bodyOf(barber) }]),
    ...(options.shops ?? SHOPS).map((shop) => ({
      path: [Collections.Locations, shop.id],
      body: bodyOf(shop),
    })),
    ...(schedule === null
      ? []
      : [
          {
            path: [Collections.BarberSchedules, schedule.id],
            body: bodyOf(schedule),
          },
        ]),
  ]);
  const tx = memoryTxPorts(store);
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  return {
    store,
    tx,
    run: editBarber({ ...tx, commit, defaultLocationId: CENTER }),
  };
}

const PROFILE: BarberEditRequest.Profile = {
  barberEdit: BarberEdit.Profile,
  name: { bg: 'Сентинел Име', en: 'Sentinel Name' },
  title: { bg: 'Сентинел титла', en: null },
  bio: null,
  instagramHandle: '@sentinel.handle',
  yearsExperience: 9,
};
const POOL: BarberEditRequest.Pool = {
  barberEdit: BarberEdit.Pool,
  barberJoinsAnyPool: false,
};

const call = (
  edit: BarberEditRequest,
  extra: Partial<EditBarberCommand> = {},
): EditBarberCommand =>
  ({
    callerUserId: ADMIN,
    callerRoles: [Role.Admin],
    operationId: OP,
    barberId: IVAN,
    ...edit,
    ...extra,
  }) as EditBarberCommand;

/** The plan of one edit: the record whole, then its row under `hash(basis)`. */
function planOf(
  action: Parameters<typeof AuditSystem.planTeamBarber>[0],
  before: Barber,
  after: Barber,
  actor: Actor = Actor.forCaller(ADMIN, [Role.Admin]),
) {
  const row = AuditSystem.planTeamBarber(
    action,
    before.id,
    before,
    after,
    TeamSystem.changedFields(before, after),
    actor,
    FIXTURE_NOW_UTC_MS,
    OP,
  );
  return [
    WriteOp.set([Collections.Barbers, before.id], bodyOf(after)),
    WriteOp.create(
      [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
      row.row,
    ),
  ];
}

describe('editBarber', () => {
  describe('the profile', () => {
    it('sets the record whole with the new profile and its ONE TEAM_BARBER_PROFILE_CHANGED row', async () => {
      const { store, tx, run } = rig();
      const answer = await run(call(PROFILE));
      expect(answer).toEqual(Result.ok({ barberId: IVAN }));
      expect(Object.keys(unwrapOk(answer))).toEqual(['barberId']);
      const after = unwrapOk(TeamSystem.editProfile(STORED_IVAN, PROFILE, OP));
      expect(tx.plans).toEqual([
        planOf('TEAM_BARBER_PROFILE_CHANGED', STORED_IVAN, after),
      ]);
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        name: { bg: 'Сентинел Име', en: 'Sentinel Name' },
        title: { bg: 'Сентинел титла', en: 'Сентинел титла' },
        bio: null,
        instagramHandle: 'sentinel.handle',
        yearsExperience: 9,
        writeOperationId: OP,
      });
    });

    it('names the changed fields on the row — never the text', async () => {
      const { tx, run } = rig();
      await run(call(PROFILE));
      const rows = auditRowsOf(tx.plans);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        auditAction: 'TEAM_BARBER_PROFILE_CHANGED',
        resourceId: `barbers/${IVAN}`,
        auditOperationId: OP,
        teamBarberFields: [
          'bio',
          'instagramHandle',
          'name',
          'title',
          'yearsExperience',
        ],
        teamBarberStatusFrom: BarberStatus.Public,
        teamBarberStatusTo: BarberStatus.Public,
      });
      const text = JSON.stringify(rows).toLowerCase();
      expect(text).not.toContain('сентинел');
      expect(text).not.toContain('sentinel');
    });

    it('reads the caller and the record only — no shop, no roster', async () => {
      const { tx, run } = rig();
      await run(call(PROFILE));
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        [Collections.Barbers, IVAN],
      ]);
      expect(tx.transactions[0]?.queries).toEqual([]);
    });

    it('is the content editor’s, and a barber’s for the record their account is linked to', async () => {
      const editor = registeredUserFixture({
        id: ADMIN,
        roles: [Role.ContentManager],
      });
      const own = registeredUserFixture({
        id: ADMIN,
        roles: [Role.Barber],
        linkedBarberId: IVAN,
      });
      for (const caller of [editor, own]) {
        const { tx, run } = rig({ caller });
        const answer = await run(
          call(PROFILE, { callerRoles: [...caller.roles] }),
        );
        expect(answer.ok).toBe(true);
        expect(auditRowsOf(tx.plans)[0]).toMatchObject(
          Actor.forCaller(ADMIN, caller.roles),
        );
      }
    });

    it('refuses a barber another record, the front desk and a client token', async () => {
      const others: readonly User[] = [
        registeredUserFixture({
          id: ADMIN,
          roles: [Role.Barber],
          linkedBarberId: NIKO,
        }),
        registeredUserFixture({ id: ADMIN, roles: [Role.Barber] }),
        registeredUserFixture({ id: ADMIN, roles: [Role.Receptionist] }),
      ];
      for (const caller of others) {
        const { tx, run } = rig({ caller });
        expect(
          unwrapErr(
            await run(call(PROFILE, { callerRoles: [...caller.roles] })),
          ),
        ).toEqual({ errorCode: TeamErrorCode.Forbidden });
        expect(tx.plans).toEqual([]);
      }
      // A client's token is turned away before any read.
      const { tx, run } = rig();
      expect(
        unwrapErr(await run(call(PROFILE, { callerRoles: [Role.Client] }))),
      ).toEqual({ errorCode: TeamErrorCode.Forbidden });
      expect(tx.transactions).toHaveLength(0);
    });

    it('names the first field at fault and writes nothing', async () => {
      const { tx, run } = rig();
      expect(
        unwrapErr(
          await run(call({ ...PROFILE, instagramHandle: 'not a handle' })),
        ),
      ).toEqual({
        errorCode: TeamErrorCode.InvalidInput,
        field: 'instagramHandle',
      });
      expect(tx.plans).toEqual([]);
    });
  });

  describe('the shops', () => {
    const shops = (locationIds: readonly LocationId[]): BarberEditRequest => ({
      barberEdit: BarberEdit.Shops,
      locationIds,
    });

    it('reads every shop and the roster, and sets the shops beside a TEAM_BARBER_SHOPS_CHANGED row', async () => {
      const { tx, run } = rig();
      await run(call(shops([CENTER, MLADOST])));
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        [Collections.Barbers, IVAN],
        [Collections.BarberSchedules, IVAN],
      ]);
      expect(tx.transactions[0]?.queries).toEqual([TEAM_LOCATIONS]);
      expect(tx.plans).toEqual([
        planOf('TEAM_BARBER_SHOPS_CHANGED', STORED_IVAN, {
          ...STORED_IVAN,
          locationIds: [CENTER, MLADOST],
          writeOperationId: OP,
        }),
      ]);
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        teamBarberFields: ['locationIds'],
      });
    });

    it('refuses a shop that is not listed, and one the coming hours still name', async () => {
      const stranger = LocationId.of('loc-nowhere');
      const { tx, run } = rig({ schedule: barberScheduleFixture() });
      expect(unwrapErr(await run(call(shops([stranger]))))).toEqual({
        errorCode: TeamErrorCode.ShopUnknown,
        locationId: stranger,
      });
      // Ivan's roster works the centre shop: it cannot be taken away.
      expect(unwrapErr(await run(call(shops([MLADOST]))))).toEqual({
        errorCode: TeamErrorCode.ShopHasHours,
        locationId: CENTER,
      });
      expect(tx.plans).toEqual([]);
    });

    it('answers a store failure — never a refusal — when no shop exists to read the clock from', async () => {
      const { tx, run } = rig({ shops: [] });
      expect(unwrapErr(await run(call(shops([])))).errorCode).toBe(
        RepositoryErrorCode.ReadFailed,
      );
      expect(tx.plans).toEqual([]);
    });
  });

  describe('the working period, the pool and the access', () => {
    it('sets the period beside a TEAM_BARBER_PERIOD_CHANGED row carrying the period it left', async () => {
      const { tx, run } = rig();
      const last = localDate('2027-03-31');
      await run(
        call({
          barberEdit: BarberEdit.Period,
          barberStartsLocalDate: STORED_IVAN.barberStartsLocalDate,
          barberLastWorkingLocalDate: last,
        }),
      );
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        auditAction: 'TEAM_BARBER_PERIOD_CHANGED',
        teamBarberFields: ['barberLastWorkingLocalDate'],
        teamBarberStartsLocalDate: STORED_IVAN.barberStartsLocalDate,
        teamBarberLastWorkingLocalDate: last,
      });
    });

    it('refuses a last day before the start', async () => {
      const { tx, run } = rig();
      expect(
        unwrapErr(
          await run(
            call({
              barberEdit: BarberEdit.Period,
              barberStartsLocalDate: localDate('2026-12-01'),
              barberLastWorkingLocalDate: localDate('2026-11-30'),
            }),
          ),
        ),
      ).toEqual({ errorCode: TeamErrorCode.PeriodInvalid });
      expect(tx.plans).toEqual([]);
    });

    it('takes a barber out of the pool beside a TEAM_BARBER_POOL_CHANGED row', async () => {
      const { tx, run } = rig();
      await run(call(POOL));
      expect(tx.plans).toEqual([
        planOf('TEAM_BARBER_POOL_CHANGED', STORED_IVAN, {
          ...STORED_IVAN,
          barberJoinsAnyPool: false,
          writeOperationId: OP,
        }),
      ]);
    });

    it('moves a live record to staff-only beside a TEAM_BARBER_STATUS_CHANGED row naming both sides', async () => {
      const { store, tx, run } = rig();
      await run(
        call({
          barberEdit: BarberEdit.Access,
          barberStatus: BarberStatus.StaffOnly,
        }),
      );
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        auditAction: 'TEAM_BARBER_STATUS_CHANGED',
        teamBarberStatusFrom: BarberStatus.Public,
        teamBarberStatusTo: BarberStatus.StaffOnly,
      });
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberStatus: BarberStatus.StaffOnly,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      });
    });

    it('is the admin’s alone: every other token is turned away before any read, every other stored account after it', async () => {
      const { tx, run } = rig();
      for (const callerRoles of [
        [Role.ContentManager],
        [Role.Receptionist],
        [Role.Barber],
        [Role.Sysadmin],
      ]) {
        expect(unwrapErr(await run(call(POOL, { callerRoles })))).toEqual({
          errorCode: TeamErrorCode.Forbidden,
        });
      }
      expect(unwrapErr(await run(call(POOL, { callerUserId: null })))).toEqual({
        errorCode: TeamErrorCode.Unauthenticated,
      });
      expect(tx.transactions).toHaveLength(0);

      for (const caller of [
        // The barber's own record is theirs for the profile only.
        registeredUserFixture({
          id: ADMIN,
          roles: [Role.Barber],
          linkedBarberId: IVAN,
        }),
        registeredUserFixture({
          id: ADMIN,
          roles: [Role.Admin],
          ...AccountLifecycle.block(BlockReason.Manual, null),
        }),
        null,
      ]) {
        const stored = rig({ caller });
        expect(unwrapErr(await stored.run(call(POOL)))).toEqual({
          errorCode: TeamErrorCode.Forbidden,
        });
        expect(stored.tx.plans).toEqual([]);
      }
    });
  });

  describe('the record', () => {
    it('answers TEAM_BARBER_NOT_FOUND for an id with no record — only to an admitted caller', async () => {
      const { tx, run } = rig({ barber: null });
      expect(unwrapErr(await run(call(POOL)))).toEqual({
        errorCode: TeamErrorCode.BarberNotFound,
        barberId: IVAN,
      });
      expect(tx.plans).toEqual([]);
      const stranger = rig({
        barber: null,
        caller: registeredUserFixture({ id: ADMIN, roles: [Role.Barber] }),
      });
      expect(unwrapErr(await stranger.run(call(POOL)))).toEqual({
        errorCode: TeamErrorCode.Forbidden,
      });
    });

    it('never edits a record that has left', async () => {
      const { tx, run } = rig({ barber: DEPARTED });
      for (const edit of [PROFILE, POOL]) {
        expect(unwrapErr(await run(call(edit)))).toEqual({
          errorCode: TeamErrorCode.BarberDeparted,
          barberId: IVAN,
        });
      }
      expect(tx.plans).toEqual([]);
    });

    it('writes nothing for a save of what is already there — and so for the replay of one that landed', async () => {
      const { store, tx, run } = rig();
      await run(call(POOL));
      const written = store.get(`${Collections.Barbers}/${IVAN}`);
      // The replay: the same act again.
      expect(await run(call(POOL))).toEqual(Result.ok({ barberId: IVAN }));
      // Another act that asks for what is already stored.
      const other = OperationId.of('operation-edit-another01');
      expect(await run(call(POOL, { operationId: other }))).toEqual(
        Result.ok({ barberId: IVAN }),
      );
      expect(tx.plans.slice(1)).toEqual([[], []]);
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toEqual(written);
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
    });

    it('derives the same plan when the transaction re-runs (contention)', async () => {
      let decisions: readonly (readonly WriteOp[])[] = [];
      const { tx, run } = rig({
        commit: (commit) => {
          const contended = contendedCommit(commit);
          decisions = contended.decisions;
          return contended.commit;
        },
      });
      await run(
        call({
          barberEdit: BarberEdit.Access,
          barberStatus: BarberStatus.StaffOnly,
        }),
      );
      expect(decisions).toHaveLength(2);
      expect(decisions[0]).toEqual(decisions[1]);
      expect(tx.plans).toEqual([decisions[1]]);
    });
  });
});
