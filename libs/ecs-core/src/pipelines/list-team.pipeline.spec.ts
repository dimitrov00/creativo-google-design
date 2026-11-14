import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BarberStatus,
  BlockReason,
  type DocBody,
  Role,
  TeamCall,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import { BarberId, UserId } from '@core/primitives';
import { AccessErrorCode, TeamErrorCode } from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type Service,
  STAFF_PERMISSIONS_DOC,
  type User,
} from '@core/entities';
import { TeamRosterSystem } from '@core/systems';
import {
  barberFixture,
  barberScheduleFixture,
  bodyOf,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  memoryStore,
  memoryTxPorts,
  registeredUserFixture,
  serviceFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { type ListTeamCommand, listTeam } from './list-team.pipeline';
import {
  TEAM_BARBERS,
  TEAM_ROSTERS,
  TEAM_SERVICES,
  TEAM_STAFF_ACCOUNTS,
} from './team-caller.pipeline';

/*
 * `listTeam` (team onboarding D8; staff permissions P6): the Team page's
 * one read. The token gate (any staff role), then ONE read-only
 * transaction that reads the caller and the owner's cells FIRST, and — for
 * a caller who may list the team — every barber record, every roster and
 * every service, and every staff account when they may see accounts; it
 * derives the rows. Nothing is written.
 */

const ADMIN = UserId.of('u-admin');
const IVAN = FIXTURE_IDS.barber;
const NEW = BarberId.of('b-new');

const STORED_ADMIN: User = registeredUserFixture({
  id: ADMIN,
  roles: [Role.Admin],
  firstName: 'Петър',
  lastName: 'Собственик',
});
/** Ivan's own account, with a contact no row may carry. */
const IVAN_ACCOUNT: User = registeredUserFixture({
  id: UserId.of('u-ivan'),
  roles: [Role.Barber],
  linkedBarberId: IVAN,
  firstName: 'Иван',
  lastName: 'Колев',
});
const DESK: User = registeredUserFixture({
  id: UserId.of('u-desk'),
  roles: [Role.Receptionist],
  firstName: 'Яна',
  lastName: 'Димова',
});
/** A client: holds no staff role, so the staff query never returns them. */
const CLIENT: User = registeredUserFixture({ id: UserId.of('u-client') });
const DRAFT: Barber = barberFixture(
  { id: NEW, sortOrder: 5 },
  {
    barberStatus: BarberStatus.Draft,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDraftTargetStatus: BarberStatus.Public,
  },
);

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
  readonly barbers?: readonly Barber[];
  readonly accounts?: readonly User[];
  readonly schedules?: readonly BarberSchedule[];
  readonly services?: readonly Service[];
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const users = [
    ...(caller === null ? [] : [caller]),
    ...(options.accounts ?? [IVAN_ACCOUNT, DESK, CLIENT]),
  ];
  const store = memoryStore([
    ...(options.permissions === undefined
      ? []
      : [{ path: PERMISSIONS, body: options.permissions }]),
    ...users.map((user) => ({
      path: [Collections.Users, user.id],
      body: bodyOf(user),
    })),
    ...(options.barbers ?? [barberFixture(), DRAFT]).map((barber) => ({
      path: [Collections.Barbers, barber.id],
      body: bodyOf(barber),
    })),
    ...(options.schedules ?? [barberScheduleFixture()]).map((schedule) => ({
      path: [Collections.BarberSchedules, schedule.id],
      body: bodyOf(schedule),
    })),
    ...(options.services ?? [serviceFixture()]).map((service) => ({
      path: [Collections.Services, service.id],
      body: bodyOf(service),
    })),
  ]);
  const tx = memoryTxPorts(store);
  return { store, tx, run: listTeam(tx) };
}

const call = (extra: Partial<ListTeamCommand> = {}): ListTeamCommand => ({
  callerUserId: ADMIN,
  callerRoles: [Role.Admin],
  ...extra,
});

describe('listTeam', () => {
  it('answers the barber records in team order, then the staff accounts with no record', async () => {
    const { run } = rig();
    const answer = unwrapOk(await run(call()));
    // The callable answers this value as it is: exactly the wire's keys.
    expect(Object.keys(answer)).toEqual(['members']);
    expect(answer.members).toEqual([
      // Ivan: live, linked to his account, ready.
      expect.objectContaining({
        teamMemberStatus: BarberStatus.Public,
        barberId: IVAN,
        memberUserId: 'u-ivan',
        memberAccountName: 'Иван Колев',
        memberRoles: [Role.Barber],
        teamMemberNote: null,
        setupDoneCount: 5,
        setupNeededCount: 5,
      }),
      // The draft: nobody signs in as them, two needed items missing.
      expect.objectContaining({
        teamMemberStatus: BarberStatus.Draft,
        barberId: NEW,
        memberUserId: null,
        teamMemberNote: TeamMemberNote.NoAccount,
        setupDoneCount: 3,
      }),
      // The caller's own account, then the front desk — by name.
      {
        teamMemberStatus: TeamMemberStatus.RoleOnly,
        memberUserId: ADMIN,
        memberAccountName: 'Петър Собственик',
        memberRoles: [Role.Admin],
      },
      {
        teamMemberStatus: TeamMemberStatus.RoleOnly,
        memberUserId: 'u-desk',
        memberAccountName: 'Яна Димова',
        memberRoles: [Role.Receptionist],
      },
    ]);
  });

  it('is exactly what TeamRosterSystem derives from what it read — and survives the wire’s own decoder', async () => {
    const { run } = rig();
    const answer = unwrapOk(await run(call()));
    expect(answer.members).toEqual(
      TeamRosterSystem.membersOf({
        barbers: [barberFixture(), DRAFT],
        accounts: [STORED_ADMIN, DESK, IVAN_ACCOUNT],
        services: [serviceFixture()],
        schedules: [barberScheduleFixture()],
      }),
    );
    expect(
      unwrapOk(TeamCall.decodeListed(JSON.parse(JSON.stringify(answer)))),
    ).toEqual(answer);
  });

  it('carries no contact of anyone — ids, names, roles, days and counts only', async () => {
    const { run } = rig();
    const text = JSON.stringify(unwrapOk(await run(call())));
    for (const account of [STORED_ADMIN, IVAN_ACCOUNT, DESK]) {
      if (account.phone !== null) expect(text).not.toContain(account.phone);
    }
    expect(text).not.toContain('phone');
    expect(text).not.toContain('email');
    // A client is no member of the team.
    expect(text).not.toContain('u-client');
  });

  it('reads the caller and the owner’s cells, then four collections — in one transaction, and writes nothing', async () => {
    const { store, tx, run } = rig();
    const before = new Map(store);
    await run(call());
    expect(tx.transactions).toHaveLength(1);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Users, ADMIN],
      PERMISSIONS,
    ]);
    expect(tx.transactions[0]?.queries).toEqual([
      TEAM_BARBERS,
      TEAM_STAFF_ACCOUNTS,
      TEAM_ROSTERS,
      TEAM_SERVICES,
    ]);
    expect(tx.plans).toEqual([[]]);
    expect(new Map(store)).toEqual(before);
  });

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

  it('judges the STORED account, whatever the token says: a taken-away role, a block and a missing account see nothing', async () => {
    const cases: [User | null, object][] = [
      // The token still says admin; the account is a barber now.
      [registeredUserFixture({ id: ADMIN, roles: [Role.Barber] }), DENIED],
      [
        registeredUserFixture({
          id: ADMIN,
          roles: [Role.Admin],
          ...AccountLifecycle.block(BlockReason.Manual, null),
        }),
        NOT_STAFF,
      ],
      [registeredUserFixture({ id: ADMIN, roles: [Role.Client] }), NOT_STAFF],
      [null, NOT_STAFF],
    ];
    for (const [caller, refusal] of cases) {
      const { run } = rig({ caller });
      expect(unwrapErr(await run(call()))).toEqual(refusal);
    }
  });

  describe('who may list the team (staff permissions P6)', () => {
    const asStored = (roles: readonly Role[]) => ({
      caller: registeredUserFixture({
        id: ADMIN,
        roles: [...roles],
        firstName: 'Петър',
        lastName: 'Собственик',
      }),
    });
    const token = (roles: readonly Role[]) => call({ callerRoles: [...roles] });

    it('with no document, follows the defaults: the admin lists everyone, the content editor the barber records, nobody else anything', async () => {
      // The content editor edits every barber's profile by default.
      const editor = rig(asStored([Role.ContentManager]));
      const records = unwrapOk(
        await editor.run(token([Role.ContentManager])),
      ).members;
      expect(records.map((member) => member.teamMemberStatus)).toEqual([
        BarberStatus.Public,
        BarberStatus.Draft,
      ]);
      for (const roles of [
        [Role.Receptionist],
        [Role.Barber],
        [Role.Sysadmin],
      ]) {
        const { tx, run } = rig(asStored(roles));
        expect(unwrapErr(await run(token(roles)))).toEqual(DENIED);
        // Refused after two document reads — no collection was queried.
        expect(tx.transactions[0]?.reads).toEqual([
          [Collections.Users, ADMIN],
          PERMISSIONS,
        ]);
        expect(tx.transactions[0]?.queries).toEqual([]);
      }
    });

    it('answers an editor of every barber’s page the records only: no account, name or role, no "no account" note, no role-only row', async () => {
      const { tx, run } = rig(asStored([Role.ContentManager]));
      const answer = unwrapOk(await run(token([Role.ContentManager])));
      expect(answer.members).toEqual([
        expect.objectContaining({
          teamMemberStatus: BarberStatus.Public,
          barberId: IVAN,
          memberUserId: null,
          memberAccountName: null,
          memberRoles: [],
          teamMemberNote: null,
          setupDoneCount: 5,
        }),
        expect.objectContaining({
          teamMemberStatus: BarberStatus.Draft,
          barberId: NEW,
          memberUserId: null,
          memberAccountName: null,
          memberRoles: [],
          // Nobody read the accounts, so "no account" is not said.
          teamMemberNote: null,
        }),
      ]);
      // The accounts were never queried.
      expect(tx.transactions[0]?.queries).toEqual([
        TEAM_BARBERS,
        TEAM_ROSTERS,
        TEAM_SERVICES,
      ]);
      const text = JSON.stringify(answer);
      expect(text).not.toContain('u-ivan');
      expect(text).not.toContain('Колев');
      expect(unwrapOk(TeamCall.decodeListed(JSON.parse(text)))).toEqual(answer);
    });

    it('a widened level is admitted: the owner hands the Team page to the content editor', async () => {
      const { run } = rig({
        ...asStored([Role.ContentManager]),
        permissions: { contentManagerTeamManageScope: 'ALL' },
      });
      const members = unwrapOk(await run(token([Role.ContentManager]))).members;
      // Every row: the accounts beside the records, and the role-only rows.
      expect(members).toHaveLength(4);
      expect(members[0]).toMatchObject({
        barberId: IVAN,
        memberUserId: 'u-ivan',
      });
    });

    it('lists the records for whoever sets every barber’s prices, too', async () => {
      const { run } = rig({
        ...asStored([Role.Receptionist]),
        permissions: { receptionistTeamOfferingsScope: 'ALL' },
      });
      const members = unwrapOk(await run(token([Role.Receptionist]))).members;
      expect(members.map((member) => member.memberUserId)).toEqual([
        null,
        null,
      ]);
    });

    it('a narrowed level is refused: the owner took profiles from the content editor', async () => {
      const { run } = rig({
        ...asStored([Role.ContentManager]),
        permissions: { contentManagerTeamProfilesScope: 'NONE' },
      });
      expect(unwrapErr(await run(token([Role.ContentManager])))).toEqual(
        DENIED,
      );
    });

    it('own only is not the list: a barber who edits their own profile is refused, as the shop needs everyone', async () => {
      const own = registeredUserFixture({
        id: ADMIN,
        roles: [Role.Barber],
        linkedBarberId: IVAN,
      });
      const { run } = rig({ caller: own });
      expect(unwrapErr(await run(token([Role.Barber])))).toEqual(DENIED);
      // …and still, given the team outright but only for their own record.
      const given = rig({
        caller: own,
        permissions: { barberTeamOfferingsScope: 'OWN' },
      });
      expect(unwrapErr(await given.run(token([Role.Barber])))).toEqual(DENIED);
    });

    it('a hand-written bad cell refuses its level, and the admin still lists everyone', async () => {
      const permissions = { contentManagerTeamProfilesScope: 'EVERYONE' };
      const editor = rig({ ...asStored([Role.ContentManager]), permissions });
      expect(unwrapErr(await editor.run(token([Role.ContentManager])))).toEqual(
        DENIED,
      );
      const admin = rig({ permissions });
      expect(unwrapOk(await admin.run(call())).members).toHaveLength(4);
    });
  });

  it('answers an empty team as an empty list — only the caller’s own row', async () => {
    const { run } = rig({
      barbers: [],
      accounts: [],
      schedules: [],
      services: [],
    });
    expect(unwrapOk(await run(call())).members).toEqual([
      {
        teamMemberStatus: TeamMemberStatus.RoleOnly,
        memberUserId: ADMIN,
        memberAccountName: 'Петър Собственик',
        memberRoles: [Role.Admin],
      },
    ]);
  });
});
