import { describe, expect, it } from 'vitest';
import {
  BarberStatus,
  Role,
  type StaffLevel,
  StaffSetupItem,
  type TeamMember,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import { BarberId, UserId } from '@core/primitives';
import {
  barberFixture,
  barberScheduleFixture,
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  serviceFixture,
  userFixture,
} from '@core/testing';
import { TeamRosterSystem } from './team-roster.system';

const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');
const NEW = BarberId.of('b-new');

/** Ivan: live, with a roster and a service that lists him — ready. */
const ivan = barberFixture({ sortOrder: 2 });
/** Niko: live, sorted first, with neither roster nor service. */
const niko = barberFixture({ id: NIKO, sortOrder: 1 });
const draft = barberFixture(
  { id: NEW, sortOrder: 3 },
  {
    barberStatus: BarberStatus.Draft,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDraftTargetStatus: BarberStatus.Public,
  },
);
const account = (
  id: string,
  roles: readonly Role[],
  linkedBarberId: BarberId | null = null,
  names: { firstName: string; lastName: string } = {
    firstName: 'Мария',
    lastName: 'Петрова',
  },
) =>
  userFixture({
    id: UserId.of(id),
    roles: [...roles],
    linkedBarberId,
    ...names,
  });

const facts = (
  extra: Partial<Parameters<typeof TeamRosterSystem.membersOf>[0]> = {},
) => ({
  barbers: [ivan, niko],
  accounts: [],
  services: [serviceFixture()],
  schedules: [barberScheduleFixture()],
  ...extra,
});

describe('TeamRosterSystem.membersOf — the Team page’s rows', () => {
  it('lists the barber records in team order, each with its status, days and setup progress', () => {
    const members = TeamRosterSystem.membersOf(facts());
    expect(members).toEqual([
      {
        teamMemberStatus: BarberStatus.Public,
        barberId: NIKO,
        memberName: niko.name,
        memberUserId: null,
        memberAccountName: null,
        memberRoles: [],
        teamMemberNote: TeamMemberNote.NoAccount,
        barberStartsLocalDate: niko.barberStartsLocalDate,
        barberLastWorkingLocalDate: null,
        // Name, start day and shops are done; services and hours are not.
        setupDoneCount: 3,
        setupNeededCount: 5,
        staffSetupItem: StaffSetupItem.Services,
      },
      {
        teamMemberStatus: BarberStatus.Public,
        barberId: IVAN,
        memberName: ivan.name,
        memberUserId: null,
        memberAccountName: null,
        memberRoles: [],
        teamMemberNote: TeamMemberNote.NoAccount,
        barberStartsLocalDate: ivan.barberStartsLocalDate,
        barberLastWorkingLocalDate: null,
        setupDoneCount: 5,
        setupNeededCount: 5,
        staffSetupItem: null,
      },
    ]);
  });

  it('orders a tie on sortOrder by id', () => {
    const tied = [
      barberFixture({ id: BarberId.of('zed'), sortOrder: 1 }),
      barberFixture({ id: BarberId.of('abe'), sortOrder: 1 }),
    ];
    expect(
      TeamRosterSystem.membersOf(facts({ barbers: tied })).map((member) =>
        'barberId' in member ? member.barberId : null,
      ),
    ).toEqual(['abe', 'zed']);
  });

  it('joins the account linked to a record: its id, name and stored roles — and no "no account" note', () => {
    const [, row] = TeamRosterSystem.membersOf(
      facts({
        accounts: [
          account('u-ivan', [Role.Barber, Role.Admin], IVAN, {
            firstName: 'Иван',
            lastName: 'Колев',
          }),
        ],
      }),
    );
    expect(row).toMatchObject({
      barberId: IVAN,
      memberUserId: 'u-ivan',
      memberAccountName: 'Иван Колев',
      memberRoles: [Role.Barber, Role.Admin],
      teamMemberNote: null,
    });
  });

  it('notes a last working day first, for a barber who has not left — never for one who has', () => {
    const leaving = barberFixture({
      barberLastWorkingLocalDate: localDate('2026-12-31'),
    });
    const [row] = TeamRosterSystem.membersOf(facts({ barbers: [leaving] }));
    expect(row).toMatchObject({
      teamMemberNote: TeamMemberNote.LastDaySet,
      barberLastWorkingLocalDate: '2026-12-31',
    });
    const departed = barberFixture(
      { barberLastWorkingLocalDate: localDate('2026-10-31') },
      {
        barberStatus: BarberStatus.Departed,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberDepartedUserId: null,
        barberSessionsRevokedAtUtcMs: null,
        barberRehireStatus: BarberStatus.Public,
      },
    );
    expect(
      TeamRosterSystem.membersOf(facts({ barbers: [departed] }))[0],
    ).toMatchObject({
      teamMemberStatus: BarberStatus.Departed,
      teamMemberNote: TeamMemberNote.NoAccount,
    });
  });

  it('counts a draft’s progress and names the first needed item it misses', () => {
    const [row] = TeamRosterSystem.membersOf(
      facts({ barbers: [draft], schedules: [] }),
    );
    expect(row).toMatchObject({
      teamMemberStatus: BarberStatus.Draft,
      setupDoneCount: 3,
      setupNeededCount: 5,
      staffSetupItem: StaffSetupItem.Services,
    });
  });

  it('lists the staff accounts linked to no record after the barbers, by name — a barber not linked yet among them', () => {
    const members = TeamRosterSystem.membersOf(
      facts({
        accounts: [
          account('u-desk', [Role.Receptionist], null, {
            firstName: 'Яна',
            lastName: 'Димова',
          }),
          account('u-ivan', [Role.Barber], IVAN),
          account('u-editor', [Role.ContentManager], null, {
            firstName: 'Ана',
            lastName: 'Иванова',
          }),
          // Linked to a record that no longer exists: a role-only row.
          account('u-ghost', [Role.Barber], BarberId.of('gone'), {
            firstName: 'Боян',
            lastName: 'Стоев',
          }),
        ],
      }),
    );
    expect(members.slice(2)).toEqual([
      {
        teamMemberStatus: TeamMemberStatus.RoleOnly,
        memberUserId: 'u-editor',
        memberAccountName: 'Ана Иванова',
        memberRoles: [Role.ContentManager],
      },
      {
        teamMemberStatus: TeamMemberStatus.RoleOnly,
        memberUserId: 'u-ghost',
        memberAccountName: 'Боян Стоев',
        memberRoles: [Role.Barber],
      },
      {
        teamMemberStatus: TeamMemberStatus.RoleOnly,
        memberUserId: 'u-desk',
        memberAccountName: 'Яна Димова',
        memberRoles: [Role.Receptionist],
      },
    ]);
  });

  it('shows one account on a record two are linked to, and neither as role-only', () => {
    const members = TeamRosterSystem.membersOf(
      facts({
        barbers: [ivan],
        accounts: [
          account('u-first', [Role.Barber], IVAN),
          account('u-second', [Role.Barber], IVAN),
        ],
      }),
    );
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ memberUserId: 'u-first' });
  });

  it('answers nothing for an empty shop', () => {
    expect(
      TeamRosterSystem.membersOf({
        barbers: [],
        accounts: [],
        services: [],
        schedules: [],
      }),
    ).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(
      facts({
        barbers: [ivan, niko, draft],
        accounts: [account('u-desk', [Role.Receptionist])],
      }),
    );
    expect(TeamRosterSystem.membersOf(frozen)).toEqual(
      TeamRosterSystem.membersOf(frozen),
    );
    const members = deepFreeze([...TeamRosterSystem.membersOf(frozen)]);
    expect(TeamRosterSystem.sectionsOf(members)).toEqual(
      TeamRosterSystem.sectionsOf(members),
    );
    expect(TeamRosterSystem.holdersOf(members, Role.Receptionist)).toEqual(
      TeamRosterSystem.holdersOf(members, Role.Receptionist),
    );
  });
});

describe('TeamRosterSystem.sectionsOf — the page’s three runs', () => {
  const gone = barberFixture(
    {
      id: BarberId.of('b-gone'),
      sortOrder: 0,
      barberLastWorkingLocalDate: localDate('2026-10-31'),
    },
    {
      barberStatus: BarberStatus.Departed,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      barberDepartedUserId: null,
      barberSessionsRevokedAtUtcMs: null,
      barberRehireStatus: BarberStatus.Public,
    },
  );
  const members = TeamRosterSystem.membersOf(
    facts({
      barbers: [ivan, niko, draft, gone],
      accounts: [
        account('u-desk', [Role.Receptionist]),
        account('u-ivan', [Role.Barber], IVAN),
      ],
    }),
  );

  it('sets the leavers apart and keeps each run in the members’ order', () => {
    const sections = TeamRosterSystem.sectionsOf(members);
    expect(sections.working.map((member) => member.barberId)).toEqual(
      members
        .filter(
          (member) =>
            member.teamMemberStatus !== TeamMemberStatus.RoleOnly &&
            member.teamMemberStatus !== TeamMemberStatus.Departed,
        )
        .map((member) => ('barberId' in member ? member.barberId : null)),
    );
    expect(sections.working.map((member) => member.barberId)).not.toContain(
      gone.id,
    );
    expect(sections.departed.map((member) => member.barberId)).toEqual([
      gone.id,
    ]);
    expect(sections.others.map((member) => member.memberUserId)).toEqual([
      UserId.of('u-desk'),
    ]);
    // Every member stands in exactly one run.
    expect(
      sections.working.length +
        sections.others.length +
        sections.departed.length,
    ).toBe(members.length);
  });

  it('answers three empty runs for an empty shop', () => {
    expect(TeamRosterSystem.sectionsOf([])).toEqual({
      working: [],
      others: [],
      departed: [],
    });
  });
});

describe('TeamRosterSystem.holdersOf — who holds a staff level', () => {
  const members = TeamRosterSystem.membersOf(
    facts({
      barbers: [ivan, niko],
      accounts: [
        account('u-desk', [Role.Receptionist]),
        account('u-both', [Role.Receptionist, Role.ContentManager]),
        account('u-ivan', [Role.Barber], IVAN),
      ],
    }),
  );

  it('names every member whose stored roles hold the level, in the members’ order', () => {
    const names = (level: StaffLevel) =>
      TeamRosterSystem.holdersOf(members, level).map((member) =>
        'barberId' in member ? member.barberId : member.memberUserId,
      );
    // Ivan's record is linked to a barber's account; Niko's has none.
    expect(names(Role.Barber)).toEqual([IVAN]);
    expect(names(Role.Receptionist).sort()).toEqual(
      [UserId.of('u-both'), UserId.of('u-desk')].sort(),
    );
    expect(names(Role.ContentManager)).toEqual([UserId.of('u-both')]);
  });

  it('never names a leaver, whatever roles the row still carries', () => {
    const leaver: TeamMember = {
      ...(members.find(
        (member) => 'barberId' in member,
      ) as TeamMember.OfBarber),
      teamMemberStatus: TeamMemberStatus.Departed,
      memberRoles: [Role.Barber],
    };
    expect(TeamRosterSystem.holdersOf([leaver], Role.Barber)).toEqual([]);
  });
});
