import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  BarberEdit,
  type BarberEditRequest,
  BarberStatus,
  BlockReason,
  type DocBody,
  Role,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
  LocalDate,
  LocationId,
  LogEvent,
  OperationId,
  Result,
  UserId,
} from '@core/primitives';
import {
  AccessErrorCode,
  RepositoryErrorCode,
  TeamErrorCode,
} from '@core/errors';
import {
  type Barber,
  BARBER_LINK_DOC,
  type BarberSchedule,
  Collections,
  type ShopLocation,
  STAFF_PERMISSIONS_DOC,
  Subcollections,
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
  FIXTURE_TODAY,
  fixtureHash,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  recordingSessionRevokePorts,
  recordingTelemetry,
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
    barberKeptAccessUserId: null,
    barberRehireStatus: BarberStatus.Public,
  },
);

const PERMISSIONS = [Collections.Settings, STAFF_PERMISSIONS_DOC];
const NOT_STAFF = { errorCode: AccessErrorCode.NotStaff };
const denied = (staffCapability: string) => ({
  errorCode: AccessErrorCode.Denied,
  staffCapability,
});
const ownOnly = (staffCapability: string) => ({
  errorCode: AccessErrorCode.OwnOnly,
  staffCapability,
});

type RigOptions = {
  readonly caller?: User | null;
  /** The stored `settings/staffPermissions` body; none by default — no document. */
  readonly permissions?: DocBody;
  readonly barber?: Barber | null;
  readonly shops?: readonly ShopLocation[];
  readonly schedule?: BarberSchedule | null;
  /** The account linked to the record, with its lock; none by default. */
  readonly linked?: User;
  /** The shop's zone cannot be read. */
  readonly zoneFails?: boolean;
  /** Ending an account's sessions fails. */
  readonly revokeFails?: boolean;
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const barber = options.barber === undefined ? STORED_IVAN : options.barber;
  const schedule = options.schedule ?? null;
  const store = memoryStore([
    ...(options.permissions === undefined
      ? []
      : [{ path: PERMISSIONS, body: options.permissions }]),
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
    ...(options.linked === undefined || barber === null
      ? []
      : [
          {
            path: [Collections.Users, options.linked.id],
            body: bodyOf(options.linked),
          },
          {
            path: [
              Collections.Barbers,
              barber.id,
              Subcollections.Restricted,
              BARBER_LINK_DOC,
            ],
            body: { linkedUserId: options.linked.id },
          },
        ]),
  ]);
  const tx = memoryTxPorts(store);
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  const telemetry = recordingTelemetry();
  const revoke = recordingSessionRevokePorts({
    failing: options.revokeFails === true,
  });
  const shops = options.shops ?? SHOPS;
  return {
    store,
    tx,
    telemetry,
    /** Every account whose sessions were ended, in order. */
    revoked: revoke.revoked,
    run: editBarber({
      ...tx,
      commit,
      defaultLocationId: CENTER,
      ...revoke.ports,
      ...telemetry,
      // The shop's clock, for a period that may have ended already.
      loadLocation: async (id) =>
        options.zoneFails === true
          ? Result.err({
              errorCode: RepositoryErrorCode.ReadFailed,
              path: `${Collections.Locations}/${id}`,
              reason: 'unavailable',
            })
          : Result.ok(shops.find((shop) => shop.id === id) ?? null),
    }),
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

    it('reads the caller, the owner’s cells and the record only — no shop, no roster', async () => {
      const { tx, run } = rig();
      await run(call(PROFILE));
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        PERMISSIONS,
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
      const others: [User, object][] = [
        // Own only, and the record is a colleague's — or nobody's.
        [
          registeredUserFixture({
            id: ADMIN,
            roles: [Role.Barber],
            linkedBarberId: NIKO,
          }),
          ownOnly('TEAM_PROFILES'),
        ],
        [
          registeredUserFixture({ id: ADMIN, roles: [Role.Barber] }),
          ownOnly('TEAM_PROFILES'),
        ],
        [
          registeredUserFixture({ id: ADMIN, roles: [Role.Receptionist] }),
          denied('TEAM_PROFILES'),
        ],
      ];
      for (const [caller, refusal] of others) {
        const { tx, run } = rig({ caller });
        expect(
          unwrapErr(
            await run(call(PROFILE, { callerRoles: [...caller.roles] })),
          ),
        ).toEqual(refusal);
        expect(tx.plans).toEqual([]);
      }
      // A client's token is turned away before any read.
      const { tx, run } = rig();
      expect(
        unwrapErr(await run(call(PROFILE, { callerRoles: [Role.Client] }))),
      ).toEqual(NOT_STAFF);
      expect(tx.transactions).toHaveLength(0);
    });

    it('follows the owner’s cells: profiles taken from a level, and given to another', async () => {
      const editor = registeredUserFixture({
        id: ADMIN,
        roles: [Role.ContentManager],
      });
      const own = registeredUserFixture({
        id: ADMIN,
        roles: [Role.Barber],
        linkedBarberId: IVAN,
      });
      const desk = registeredUserFixture({
        id: ADMIN,
        roles: [Role.Receptionist],
      });
      const cases: [User, DocBody, object | null][] = [
        // Narrowed: the content editor, and a barber's own.
        [
          editor,
          { contentManagerTeamProfilesScope: 'NONE' },
          denied('TEAM_PROFILES'),
        ],
        [own, { barberTeamProfilesScope: 'NONE' }, denied('TEAM_PROFILES')],
        // Widened: the front desk, and a barber for every colleague.
        [desk, { receptionistTeamProfilesScope: 'ALL' }, null],
        [
          registeredUserFixture({
            id: ADMIN,
            roles: [Role.Barber],
            linkedBarberId: NIKO,
          }),
          { barberTeamProfilesScope: 'ALL' },
          null,
        ],
        // A value nobody could save refuses its level.
        [
          editor,
          { contentManagerTeamProfilesScope: 'OWN' },
          denied('TEAM_PROFILES'),
        ],
      ];
      for (const [caller, permissions, refusal] of cases) {
        const { tx, run } = rig({ caller, permissions });
        const answer = await run(
          call(PROFILE, { callerRoles: [...caller.roles] }),
        );
        if (refusal === null) {
          expect(answer.ok).toBe(true);
        } else {
          expect(unwrapErr(answer)).toEqual(refusal);
          expect(tx.plans).toEqual([]);
        }
      }
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
        PERMISSIONS,
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

    it('turns away no session and a token with no staff role before any read', async () => {
      const { tx, run } = rig();
      for (const callerRoles of [[Role.Client], []]) {
        expect(unwrapErr(await run(call(POOL, { callerRoles })))).toEqual(
          NOT_STAFF,
        );
      }
      expect(unwrapErr(await run(call(POOL, { callerUserId: null })))).toEqual({
        errorCode: TeamErrorCode.Unauthenticated,
      });
      expect(tx.transactions).toHaveLength(0);
    });

    it('with no document, is the admin’s alone: every other stored account is refused after the read', async () => {
      const cases: [User | null, object][] = [
        // The barber's own record is theirs for the profile only.
        [
          registeredUserFixture({
            id: ADMIN,
            roles: [Role.Barber],
            linkedBarberId: IVAN,
          }),
          denied('TEAM_MANAGE'),
        ],
        [
          registeredUserFixture({ id: ADMIN, roles: [Role.ContentManager] }),
          denied('TEAM_MANAGE'),
        ],
        [
          registeredUserFixture({ id: ADMIN, roles: [Role.Receptionist] }),
          denied('TEAM_MANAGE'),
        ],
        [
          registeredUserFixture({ id: ADMIN, roles: [Role.Sysadmin] }),
          denied('TEAM_MANAGE'),
        ],
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
        const stored = rig({ caller });
        expect(unwrapErr(await stored.run(call(POOL)))).toEqual(refusal);
        expect(stored.tx.plans).toEqual([]);
      }
    });

    it('a level given the team changes the pool — and editing profiles alone does not', async () => {
      const editor = registeredUserFixture({
        id: ADMIN,
        roles: [Role.ContentManager],
      });
      const given = rig({
        caller: editor,
        permissions: { contentManagerTeamManageScope: 'ALL' },
      });
      expect(
        (await given.run(call(POOL, { callerRoles: [Role.ContentManager] })))
          .ok,
      ).toBe(true);
      // The content editor edits every profile by default — that is not the team.
      const plain = rig({ caller: editor });
      expect(
        unwrapErr(
          await plain.run(call(POOL, { callerRoles: [Role.ContentManager] })),
        ),
      ).toEqual(denied('TEAM_MANAGE'));
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
      expect(unwrapErr(await stranger.run(call(POOL)))).toEqual(
        denied('TEAM_MANAGE'),
      );
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

  describe('a return — a record that has left, back on the team (team onboarding D10)', () => {
    const LAST = LocalDate.addDays(FIXTURE_TODAY, -30);
    /** Ivan, who left a month ago: a public barber before. */
    const LEFT: Barber = barberFixture(
      { barberLastWorkingLocalDate: LAST },
      {
        barberStatus: BarberStatus.Departed,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberDepartedUserId: null,
        barberSessionsRevokedAtUtcMs: null,
        barberKeptAccessUserId: null,
        barberRehireStatus: BarberStatus.Public,
      },
    );
    /** His roster as the close left it: one version, ended on the last day. */
    const CLOSED = barberScheduleFixture({
      versions: barberScheduleFixture().versions.map((version) => ({
        ...version,
        effectiveToLocalDate: LAST,
      })),
    });
    const back = (barberStartsLocalDate: LocalDate = FIXTURE_TODAY) =>
      call({ barberEdit: BarberEdit.Return, barberStartsLocalDate });

    it('ONE commit: the record live again on a new period beside ONE status row, and the week last worked standing again in the roster', async () => {
      const { store, tx, run } = rig({ barber: LEFT, schedule: CLOSED });

      expect(unwrapOk(await run(back()))).toEqual({ barberId: IVAN });

      expect(tx.plans).toHaveLength(1);
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberStatus: BarberStatus.Public,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberStartsLocalDate: FIXTURE_TODAY,
        barberLastWorkingLocalDate: null,
        writeOperationId: OP,
      });
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).not.toHaveProperty(
        'barberRehireStatus',
      );
      const roster = store.get(`${Collections.BarberSchedules}/${IVAN}`);
      expect(roster).toMatchObject({ writeOperationId: OP });
      expect(
        (roster?.['versions'] as readonly Record<string, unknown>[]).map(
          (version) => [
            version['effectiveFromLocalDate'],
            version['effectiveToLocalDate'],
          ],
        ),
      ).toEqual([
        [CLOSED.versions[0]?.effectiveFromLocalDate, LAST],
        [FIXTURE_TODAY, null],
      ]);
      const rows = auditRowsOf(tx.plans);
      expect(rows.map((row) => row.auditAction)).toEqual([
        'TEAM_BARBER_STATUS_CHANGED',
      ]);
      expect(rows[0]).toMatchObject({
        ...Actor.forCaller(ADMIN, [Role.Admin]),
        teamBarberStatusFrom: BarberStatus.Departed,
        teamBarberStatusTo: BarberStatus.Public,
      });
    });

    it('a record with no roster returns all the same: the hours are set from its page', async () => {
      const { store, tx, run } = rig({ barber: LEFT });
      expect(unwrapOk(await run(back()))).toEqual({ barberId: IVAN });
      expect(tx.plans[0]).toHaveLength(2);
      expect(
        store.get(`${Collections.BarberSchedules}/${IVAN}`),
      ).toBeUndefined();
    });

    it('the replay of a return that landed writes nothing — no second version, no second row', async () => {
      const { store, tx, run } = rig({ barber: LEFT, schedule: CLOSED });
      await run(back());
      const roster = store.get(`${Collections.BarberSchedules}/${IVAN}`);

      expect(unwrapOk(await run(back()))).toEqual({ barberId: IVAN });
      expect(tx.plans.slice(1)).toEqual([[]]);
      expect(store.get(`${Collections.BarberSchedules}/${IVAN}`)).toEqual(
        roster,
      );
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
    });

    it('refuses a start on or before the last day worked, and a record that has not left — nothing written', async () => {
      const early = rig({ barber: LEFT, schedule: CLOSED });
      expect(unwrapErr(await early.run(back(LAST)))).toEqual({
        errorCode: TeamErrorCode.ReturnTooEarly,
        lastLocalDate: LAST,
      });
      expect(early.tx.plans).toEqual([]);

      const working = rig();
      expect(unwrapErr(await working.run(back()))).toEqual({
        errorCode: TeamErrorCode.BarberNotDeparted,
        barberId: IVAN,
      });
      expect(working.tx.plans).toEqual([]);
    });

    it('is the team manager’s alone: a barber is refused before the record is judged', async () => {
      const barber = registeredUserFixture({
        id: UserId.of('u-barber'),
        roles: [Role.Barber],
      });
      const { tx, run } = rig({ barber: LEFT, caller: barber });
      expect(
        unwrapErr(
          await run(
            call(
              {
                barberEdit: BarberEdit.Return,
                barberStartsLocalDate: FIXTURE_TODAY,
              },
              { callerUserId: barber.id, callerRoles: [Role.Barber] },
            ),
          ),
        ),
      ).toEqual(denied('TEAM_MANAGE'));
      expect(tx.plans).toEqual([]);
    });

    it('every other part of a record that has left is still refused', async () => {
      const { tx, run } = rig({ barber: LEFT });
      expect(unwrapErr(await run(call(POOL)))).toEqual({
        errorCode: TeamErrorCode.BarberDeparted,
        barberId: IVAN,
      });
      expect(tx.plans).toEqual([]);
    });

    it('a barber who leaves and comes back: the close and the return leave one record, one roster and no day covered twice', async () => {
      const yesterday = LocalDate.addDays(FIXTURE_TODAY, -1);
      const { store, run } = rig({ schedule: barberScheduleFixture() });
      // Leaves: a last day already passed is closed at once.
      await run(
        call({
          barberEdit: BarberEdit.Period,
          barberStartsLocalDate: STORED_IVAN.barberStartsLocalDate,
          barberLastWorkingLocalDate: yesterday,
        }),
      );
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberStatus: BarberStatus.Departed,
      });
      // Comes back today.
      expect(
        unwrapOk(
          await run(
            call(
              {
                barberEdit: BarberEdit.Return,
                barberStartsLocalDate: FIXTURE_TODAY,
              },
              { operationId: OperationId.of('operation-edit-return01') },
            ),
          ),
        ),
      ).toEqual({ barberId: IVAN });
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberStatus: BarberStatus.Public,
        barberStartsLocalDate: FIXTURE_TODAY,
        barberLastWorkingLocalDate: null,
      });
      const versions = store.get(`${Collections.BarberSchedules}/${IVAN}`)?.[
        'versions'
      ] as readonly Record<string, unknown>[];
      expect(
        versions.map((version) => [
          version['effectiveFromLocalDate'],
          version['effectiveToLocalDate'],
        ]),
      ).toEqual([
        [
          barberScheduleFixture().versions[0]?.effectiveFromLocalDate,
          yesterday,
        ],
        [FIXTURE_TODAY, null],
      ]);
    });
  });

  describe('a last day that has already passed — the record leaves at once (team onboarding D10)', () => {
    const YESTERDAY = LocalDate.addDays(FIXTURE_TODAY, -1);
    const IVANS_ACCOUNT: User = registeredUserFixture({
      id: UserId.of('u-ivan'),
      roles: [Role.Client, Role.Barber],
      linkedBarberId: IVAN,
    });
    const period = (barberLastWorkingLocalDate: LocalDate | null) =>
      call({
        barberEdit: BarberEdit.Period,
        barberStartsLocalDate: STORED_IVAN.barberStartsLocalDate,
        barberLastWorkingLocalDate,
      });

    it('closes the period right after its own commit: the record DEPARTED, the account a client with no link, its sessions ended and marked — all credited to the caller', async () => {
      const { store, tx, revoked, run } = rig({
        linked: IVANS_ACCOUNT,
        schedule: barberScheduleFixture(),
      });

      expect(unwrapOk(await run(period(YESTERDAY)))).toEqual({
        barberId: IVAN,
      });

      // The edit, the close, the revoke's marker: three plans, in that order.
      expect(tx.plans).toHaveLength(3);
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberStatus: BarberStatus.Departed,
        barberLastWorkingLocalDate: YESTERDAY,
        barberDepartedUserId: IVANS_ACCOUNT.id,
        barberSessionsRevokedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberKeptAccessUserId: null,
        barberRehireStatus: BarberStatus.Public,
      });
      expect(
        store.get(`${Collections.Users}/${IVANS_ACCOUNT.id}`),
      ).toMatchObject({ roles: [Role.Client], linkedBarberId: null });
      expect(
        store.get(
          `${Collections.Barbers}/${IVAN}/${Subcollections.Restricted}/${BARBER_LINK_DOC}`,
        ),
      ).toBeUndefined();
      expect(store.get(`${Collections.BarberSchedules}/${IVAN}`)).toMatchObject(
        {
          versions: [{ effectiveToLocalDate: YESTERDAY }],
        },
      );
      expect(revoked).toEqual([IVANS_ACCOUNT.id]);
      // The period's row, then the close's two and the marker's — every one the caller's.
      const rows = auditRowsOf(tx.plans);
      expect(rows.map((row) => row.auditAction)).toEqual([
        'TEAM_BARBER_PERIOD_CHANGED',
        'TEAM_BARBER_STATUS_CHANGED',
        'PROFILE_ROLES_CHANGED',
        'TEAM_BARBER_STATUS_CHANGED',
      ]);
      for (const row of rows) {
        expect(row).toMatchObject(Actor.forCaller(ADMIN, [Role.Admin]));
      }
    });

    it('leaves a record whose last day is today, or ahead, working — the barber works the last day through', async () => {
      for (const last of [
        FIXTURE_TODAY,
        LocalDate.addDays(FIXTURE_TODAY, 30),
      ]) {
        const { store, tx, revoked, run } = rig({ linked: IVANS_ACCOUNT });
        await run(period(last));
        expect(tx.plans, last).toHaveLength(1);
        expect(store.get(`${Collections.Barbers}/${IVAN}`), last).toMatchObject(
          { barberStatus: BarberStatus.Public },
        );
        expect(revoked, last).toEqual([]);
      }
    });

    it('asks nothing of the shop’s clock when no last day is set', async () => {
      const { tx, telemetry, run } = rig({ zoneFails: true });
      await run(period(LocalDate.addDays(FIXTURE_TODAY, 30)));
      // A day is set here: the clock is asked, cannot be read, and that is logged.
      expect(telemetry.lines.map((line) => line.msg)).toEqual([
        LogEvent.TeamPeriodCloseFailed,
      ]);
      const cleared = rig({
        zoneFails: true,
        barber: { ...STORED_IVAN, barberLastWorkingLocalDate: YESTERDAY },
      });
      expect(unwrapOk(await cleared.run(period(null)))).toEqual({
        barberId: IVAN,
      });
      expect(cleared.telemetry.lines).toEqual([]);
      expect(tx.plans).toHaveLength(1);
    });

    it('a close that could not run never refuses the edit: the period is saved, the failure logged', async () => {
      const { store, tx, telemetry, run } = rig({ zoneFails: true });
      expect(unwrapOk(await run(period(YESTERDAY)))).toEqual({
        barberId: IVAN,
      });
      expect(tx.plans).toHaveLength(1);
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberStatus: BarberStatus.Public,
        barberLastWorkingLocalDate: YESTERDAY,
      });
      expect(telemetry.lines).toEqual([
        {
          level: 'error',
          msg: LogEvent.TeamPeriodCloseFailed,
          fields: {
            barberId: IVAN,
            errorCode: RepositoryErrorCode.ReadFailed,
          },
        },
      ]);
    });

    it('no other part of a record closes anything', async () => {
      const { tx, telemetry, run } = rig({
        zoneFails: true,
        barber: { ...STORED_IVAN, barberLastWorkingLocalDate: YESTERDAY },
      });
      await run(call(POOL));
      expect(tx.plans).toHaveLength(1);
      expect(telemetry.lines).toEqual([]);
    });
  });
  describe('«Опитай пак» — the sessions a departure still owes, ended now (team onboarding D10)', () => {
    const OWED_ACCOUNT = UserId.of('u-gone');
    const left = (barberDepartedUserId: UserId | null): Barber =>
      barberFixture(
        { barberLastWorkingLocalDate: LocalDate.addDays(FIXTURE_TODAY, -3) },
        {
          barberStatus: BarberStatus.Departed,
          barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
          barberDepartedUserId,
          barberSessionsRevokedAtUtcMs: null,
          barberKeptAccessUserId: null,
          barberRehireStatus: BarberStatus.Public,
        },
      );
    const retry = () => call({ barberEdit: BarberEdit.EndSessions });

    it('ends the owed sessions and marks them, credited to the caller — the record otherwise as it was', async () => {
      const { store, tx, revoked, run } = rig({ barber: left(OWED_ACCOUNT) });
      expect(unwrapOk(await run(retry()))).toEqual({ barberId: IVAN });
      expect(revoked).toEqual([OWED_ACCOUNT]);
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberStatus: BarberStatus.Departed,
        barberDepartedUserId: OWED_ACCOUNT,
        barberSessionsRevokedAtUtcMs: FIXTURE_NOW_UTC_MS,
      });
      const rows = auditRowsOf(tx.plans);
      expect(rows.map((row) => row.auditAction)).toEqual([
        'TEAM_BARBER_STATUS_CHANGED',
      ]);
      expect(rows.at(0)).toMatchObject(Actor.forCaller(ADMIN, [Role.Admin]));
    });

    it('answers TEAM_SESSIONS_NOT_ENDED when they cannot be ended again — still owed, the failure logged', async () => {
      const { store, telemetry, run } = rig({
        barber: left(OWED_ACCOUNT),
        revokeFails: true,
      });
      expect(await run(retry())).toEqual({
        ok: false,
        error: { errorCode: TeamErrorCode.SessionsNotEnded, barberId: IVAN },
      });
      expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
        barberSessionsRevokedAtUtcMs: null,
      });
      expect(telemetry.lines.map((line) => line.msg)).toContain(
        LogEvent.TeamSessionsNotRevoked,
      );
    });

    it('is simply saved for a leaver who owes nothing: nothing ended, nothing written', async () => {
      const { tx, revoked, run } = rig({ barber: left(null) });
      expect(unwrapOk(await run(retry()))).toEqual({ barberId: IVAN });
      expect(revoked).toEqual([]);
      expect(auditRowsOf(tx.plans)).toEqual([]);
    });

    it('refuses a record that has not left, and a caller who does not manage the team — nothing ended', async () => {
      const working = rig();
      expect(await working.run(retry())).toEqual({
        ok: false,
        error: { errorCode: TeamErrorCode.BarberNotDeparted, barberId: IVAN },
      });
      expect(working.revoked).toEqual([]);

      const someone = registeredUserFixture({
        id: UserId.of('u-barber'),
        roles: [Role.Barber],
      });
      const barber = rig({ barber: left(OWED_ACCOUNT), caller: someone });
      expect(
        unwrapErr(
          await barber.run(
            call(
              { barberEdit: BarberEdit.EndSessions },
              { callerUserId: someone.id, callerRoles: [Role.Barber] },
            ),
          ),
        ),
      ).toEqual(denied('TEAM_MANAGE'));
      expect(barber.revoked).toEqual([]);
    });
  });
});
