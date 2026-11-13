import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BarberStatus,
  BlockReason,
  Role,
  TeamCall,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import { BarberId, UserId } from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type Service,
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
 * `listTeam` (team onboarding D8): the Team page's one read. The token gate
 * (the team manager's), then ONE read-only transaction that reads the
 * caller, every barber record, every staff account, every roster and every
 * service, and derives the rows. Nothing is written.
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

type RigOptions = {
  readonly caller?: User | null;
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

  it('reads the caller and four collections in one transaction, and writes nothing', async () => {
    const { store, tx, run } = rig();
    const before = new Map(store);
    await run(call());
    expect(tx.transactions).toHaveLength(1);
    expect(tx.transactions[0]?.reads).toEqual([[Collections.Users, ADMIN]]);
    expect(tx.transactions[0]?.queries).toEqual([
      TEAM_BARBERS,
      TEAM_STAFF_ACCOUNTS,
      TEAM_ROSTERS,
      TEAM_SERVICES,
    ]);
    expect(tx.plans).toEqual([[]]);
    expect(new Map(store)).toEqual(before);
  });

  it('refuses no session and every token without the admin role before any read', async () => {
    const { tx, run } = rig();
    expect(unwrapErr(await run(call({ callerUserId: null })))).toEqual({
      errorCode: TeamErrorCode.Unauthenticated,
    });
    for (const callerRoles of [
      [Role.ContentManager],
      [Role.Receptionist],
      [Role.Barber],
      [Role.Sysadmin],
      [Role.Client],
      [],
    ]) {
      expect(unwrapErr(await run(call({ callerRoles })))).toEqual({
        errorCode: TeamErrorCode.Forbidden,
      });
    }
    expect(tx.transactions).toHaveLength(0);
  });

  it('judges the STORED account: a taken-away role, a block and a missing account see nothing', async () => {
    for (const caller of [
      registeredUserFixture({ id: ADMIN, roles: [Role.Barber] }),
      registeredUserFixture({
        id: ADMIN,
        roles: [Role.Admin],
        ...AccountLifecycle.block(BlockReason.Manual, null),
      }),
      null,
    ]) {
      const { run } = rig({ caller });
      expect(unwrapErr(await run(call()))).toEqual({
        errorCode: TeamErrorCode.Forbidden,
      });
    }
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
