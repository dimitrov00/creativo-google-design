import { describe, expect, it } from 'vitest';
import {
  AccountStanding,
  BarberStatus,
  RecordClaim,
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
import { type RecordViewer, TeamRosterSystem } from './team-roster.system';

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

describe('TeamRosterSystem — the sessions a departure still owes (team onboarding D10)', () => {
  const LEAVER_ACCOUNT = UserId.of('u-leaver');
  const leaver = (revokedAtUtcMs: typeof FIXTURE_NOW_UTC_MS | null) =>
    barberFixture(
      { barberLastWorkingLocalDate: localDate('2026-10-31') },
      {
        barberStatus: BarberStatus.Departed,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberDepartedUserId: LEAVER_ACCOUNT,
        barberSessionsRevokedAtUtcMs: revokedAtUtcMs,
        barberRehireStatus: BarberStatus.Public,
      },
    );

  it('notes a leaver whose account still has its sessions before any other note — only to a reader who sees accounts', () => {
    const [owed] = TeamRosterSystem.membersOf(
      facts({ barbers: [leaver(null)] }),
    );
    expect(owed).toMatchObject({
      teamMemberNote: TeamMemberNote.SessionsOwed,
    });
    const [unseen] = TeamRosterSystem.membersOf(
      facts({ barbers: [leaver(null)], accounts: null }),
    );
    expect(unseen).toMatchObject({ teamMemberNote: null });
    const [ended] = TeamRosterSystem.membersOf(
      facts({ barbers: [leaver(FIXTURE_NOW_UTC_MS)] }),
    );
    expect(ended).toMatchObject({ teamMemberNote: TeamMemberNote.NoAccount });
  });

  it('owingOf names the leavers who owe sessions, in the members’ order — nobody else', () => {
    const members = TeamRosterSystem.membersOf(
      facts({
        barbers: [
          ivan,
          { ...leaver(null), id: BarberId.of('gone-a'), sortOrder: 5 },
          { ...leaver(FIXTURE_NOW_UTC_MS), id: BarberId.of('gone-b') },
          { ...leaver(null), id: BarberId.of('gone-c'), sortOrder: 6 },
        ],
      }),
    );
    expect(
      TeamRosterSystem.owingOf(members).map((member) => member.barberId),
    ).toEqual(['gone-a', 'gone-c']);
  });
});

describe('TeamRosterSystem.remindersOf — the last days close enough to decide on (team onboarding D10)', () => {
  const TODAY = localDate('2026-11-16');
  const ending = (id: string, last: string, starts = '2026-01-01') =>
    barberFixture({
      id: BarberId.of(id),
      sortOrder: 1,
      barberStartsLocalDate: localDate(starts),
      barberLastWorkingLocalDate: localDate(last),
    });

  it('names the working barbers whose last day is today or within seven days, soonest first', () => {
    const members = TeamRosterSystem.membersOf(
      facts({
        barbers: [
          ending('in-four', '2026-11-20'),
          ending('today', '2026-11-16'),
          ending('in-seven', '2026-11-23'),
          ending('in-eight', '2026-11-24'),
          ending('passed', '2026-11-15'),
          ivan,
        ],
      }),
    );
    expect(
      TeamRosterSystem.remindersOf(members, TODAY).map(
        (member) => member.barberId,
      ),
    ).toEqual(['today', 'in-four', 'in-seven']);
  });

  it('says nothing about a period of seven days or less, a record in preparation or one that has left', () => {
    const shortStay = ending('guest', '2026-11-20', '2026-11-14');
    const preparing = {
      ...ending('draft', '2026-11-20'),
      barberStatus: BarberStatus.Draft,
      barberDraftTargetStatus: BarberStatus.Public,
    } as typeof draft;
    const left = barberFixture(
      {
        id: BarberId.of('left'),
        barberLastWorkingLocalDate: localDate('2026-11-20'),
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
      facts({ barbers: [shortStay, preparing, left] }),
    );
    expect(TeamRosterSystem.remindersOf(members, TODAY)).toEqual([]);
  });

  it('keeps the members’ order between two on one day, and is pure', () => {
    const members = deepFreeze([
      ...TeamRosterSystem.membersOf(
        facts({
          barbers: [
            { ...ending('first', '2026-11-18'), sortOrder: 1 },
            { ...ending('second', '2026-11-18'), sortOrder: 2 },
          ],
        }),
      ),
    ]);
    const once = TeamRosterSystem.remindersOf(members, TODAY);
    expect(once.map((member) => member.barberId)).toEqual(['first', 'second']);
    expect(TeamRosterSystem.remindersOf(members, TODAY)).toEqual(once);
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

describe('TeamRosterSystem.recordOf — a barber record’s row', () => {
  const members = TeamRosterSystem.membersOf(
    facts({
      barbers: [ivan, niko],
      accounts: [account('u-desk', [Role.Receptionist])],
    }),
  );

  it('finds the record by its id, and never an account’s row', () => {
    expect(TeamRosterSystem.recordOf(members, NIKO)?.barberId).toBe(NIKO);
    expect(TeamRosterSystem.recordOf(members, IVAN)?.barberId).toBe(IVAN);
  });

  it('answers null for an id no row carries', () => {
    expect(TeamRosterSystem.recordOf(members, NEW)).toBeNull();
    expect(TeamRosterSystem.recordOf([], IVAN)).toBeNull();
  });
});

describe('TeamRosterSystem.claimOf — whose record it is to the person looking (staff permissions P9)', () => {
  const members = TeamRosterSystem.membersOf(
    facts({
      barbers: [ivan, niko],
      accounts: [account('u-ivan', [Role.Barber], IVAN)],
    }),
  );
  const linked = TeamRosterSystem.recordOf(
    members,
    IVAN,
  ) as TeamMember.OfBarber;
  const free = TeamRosterSystem.recordOf(members, NIKO) as TeamMember.OfBarber;
  const owner = {
    userId: UserId.of('u-owner'),
    linkedBarberId: null,
    assignsRoles: true,
  };

  it('is open to an owner linked to no record, when nobody is linked to it', () => {
    expect(TeamRosterSystem.claimOf(free, owner)).toBe(RecordClaim.Open);
  });

  it('is the viewer’s own the moment their stored link names it, whatever the row still says', () => {
    expect(
      TeamRosterSystem.claimOf(free, { ...owner, linkedBarberId: NIKO }),
    ).toBe(RecordClaim.Mine);
  });

  it('is nobody’s to take when another account holds it, or the viewer already has a record', () => {
    expect(TeamRosterSystem.claimOf(linked, owner)).toBe(RecordClaim.None);
    expect(
      TeamRosterSystem.claimOf(free, { ...owner, linkedBarberId: IVAN }),
    ).toBe(RecordClaim.None);
  });

  it('is never offered to someone who assigns no roles, or to nobody', () => {
    expect(
      TeamRosterSystem.claimOf(free, { ...owner, assignsRoles: false }),
    ).toBe(RecordClaim.None);
    expect(TeamRosterSystem.claimOf(free, { ...owner, userId: null })).toBe(
      RecordClaim.None,
    );
  });

  it('is never open on a leaver’s record', () => {
    const leaver: TeamMember.OfBarber = {
      ...free,
      teamMemberStatus: TeamMemberStatus.Departed,
    };
    expect(TeamRosterSystem.claimOf(leaver, owner)).toBe(RecordClaim.None);
  });
});

describe('TeamRosterSystem — the account beside a record: who may link one, who may release it (team onboarding D8)', () => {
  const members = TeamRosterSystem.membersOf(
    facts({
      barbers: [ivan, niko],
      accounts: [
        account('u-ivan', [Role.Barber], IVAN),
        account('u-owner', [Role.Admin]),
        account('u-desk', [Role.Receptionist], null, {
          firstName: 'Ана',
          lastName: 'Колева',
        }),
        account('u-vendor', [Role.Sysadmin], null, {
          firstName: 'Вера',
          lastName: 'Димова',
        }),
        account('u-stub', [Role.Barber], null, { firstName: '', lastName: '' }),
      ],
    }),
  );
  const linked = TeamRosterSystem.recordOf(
    members,
    IVAN,
  ) as TeamMember.OfBarber;
  const free = TeamRosterSystem.recordOf(members, NIKO) as TeamMember.OfBarber;
  const owner = {
    userId: UserId.of('u-owner'),
    linkedBarberId: null,
    assignsRoles: true,
  };

  it('an owner links an account to a record nobody is linked to — even when they hold a record themself', () => {
    expect(TeamRosterSystem.linksAccount(free, owner)).toBe(true);
    expect(
      TeamRosterSystem.linksAccount(free, { ...owner, linkedBarberId: IVAN }),
    ).toBe(true);
    expect(TeamRosterSystem.linksAccount(linked, owner)).toBe(false);
  });

  it('an owner releases someone else’s account, never their own: that leaves through «Не съм аз»', () => {
    expect(TeamRosterSystem.releasesAccount(linked, owner)).toBe(true);
    expect(TeamRosterSystem.releasesAccount(free, owner)).toBe(false);
    expect(
      TeamRosterSystem.releasesAccount(linked, {
        ...owner,
        userId: UserId.of('u-ivan'),
      }),
    ).toBe(false);
  });

  it('neither door is there for someone who assigns no roles, for nobody, or on a leaver’s record', () => {
    const leaver = (member: TeamMember.OfBarber): TeamMember.OfBarber => ({
      ...member,
      teamMemberStatus: TeamMemberStatus.Departed,
    });
    for (const viewer of [
      { ...owner, assignsRoles: false },
      { ...owner, userId: null },
    ]) {
      expect(TeamRosterSystem.linksAccount(free, viewer)).toBe(false);
      expect(TeamRosterSystem.releasesAccount(linked, viewer)).toBe(false);
    }
    expect(TeamRosterSystem.linksAccount(leaver(free), owner)).toBe(false);
    expect(TeamRosterSystem.releasesAccount(leaver(linked), owner)).toBe(false);
  });

  it('unlinkedOf lists the registered staff accounts with no record — not the viewer, a sysadmin or a stub', () => {
    const unlinked = TeamRosterSystem.unlinkedOf(members, owner.userId);
    expect(unlinked.map((member) => member.memberUserId)).toEqual(['u-desk']);
    expect(members).toContain(unlinked[0]);
    // With nobody looking, nobody is offered.
    expect(TeamRosterSystem.unlinkedOf(members, null)).toEqual([]);
  });

  it('additionCandidatesOf lists the members with an account that could take the role — a linked barber and a staff account, not one that holds it, the viewer, a sysadmin, a stub or a record nobody signs in as', () => {
    const ids = (role: Role, viewer: UserId | null = owner.userId) =>
      TeamRosterSystem.additionCandidatesOf(members, role, viewer).map(
        (member) => member.memberUserId,
      );
    expect(ids(Role.Receptionist)).toEqual([UserId.of('u-ivan')]);
    expect(ids(Role.Admin)).toEqual([UserId.of('u-ivan'), UserId.of('u-desk')]);
    // The rows themselves.
    expect(
      TeamRosterSystem.additionCandidatesOf(
        members,
        Role.Receptionist,
        owner.userId,
      )[0],
    ).toBe(linked);
    // Nobody looking: nobody offered.
    expect(ids(Role.Admin, null)).toEqual([]);
    // The viewer's own roles are not changed from a list: looking from
    // the front desk's account, Ivan is offered and the desk is not.
    expect(ids(Role.ContentManager, UserId.of('u-desk'))).toEqual([
      UserId.of('u-ivan'),
    ]);
    // An admin already does everything a role gives: never offered one.
    expect(ids(Role.ContentManager)).not.toContain(UserId.of('u-owner'));
    expect(ids(Role.ContentManager, UserId.of('u-desk'))).not.toContain(
      UserId.of('u-owner'),
    );
  });

  it('additionCandidatesOf leaves a leaver’s account out', () => {
    const left = members.map((member) =>
      member === linked
        ? { ...linked, teamMemberStatus: TeamMemberStatus.Departed }
        : member,
    );
    expect(
      TeamRosterSystem.additionCandidatesOf(
        left,
        Role.Receptionist,
        owner.userId,
      ),
    ).toEqual([]);
  });

  it('accountOf finds a staff account’s row by its id, never a barber record’s', () => {
    expect(
      TeamRosterSystem.accountOf(members, UserId.of('u-desk'))?.memberRoles,
    ).toEqual([Role.Receptionist]);
    // Ivan's account is beside his record: it is no row of its own.
    expect(TeamRosterSystem.accountOf(members, UserId.of('u-ivan'))).toBeNull();
    expect(TeamRosterSystem.accountOf([], UserId.of('u-desk'))).toBeNull();
  });

  it('accountStandingOf says what an account’s page is to the person looking, the first that applies', () => {
    const rowOf = (id: string) =>
      TeamRosterSystem.accountOf(members, UserId.of(id)) as TeamMember.RoleOnly;
    const standingOf = (id: string, viewer: RecordViewer = owner) =>
      TeamRosterSystem.accountStandingOf(rowOf(id), viewer);
    expect(standingOf('u-desk')).toBe(AccountStanding.Editable);
    expect(standingOf('u-owner')).toBe(AccountStanding.Own);
    expect(standingOf('u-vendor')).toBe(AccountStanding.Vendor);
    expect(standingOf('u-stub')).toBe(AccountStanding.Unregistered);
    const frontDesk = {
      userId: UserId.of('u-desk'),
      linkedBarberId: null,
      assignsRoles: false,
    };
    // Someone who assigns no roles reads a colleague's account, and still knows their own.
    expect(standingOf('u-owner', frontDesk)).toBe(AccountStanding.ReadOnly);
    expect(standingOf('u-stub', frontDesk)).toBe(AccountStanding.ReadOnly);
    expect(standingOf('u-desk', frontDesk)).toBe(AccountStanding.Own);
    expect(standingOf('u-vendor', frontDesk)).toBe(AccountStanding.Vendor);
    expect(standingOf('u-desk', { ...owner, userId: null })).toBe(
      AccountStanding.ReadOnly,
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(members);
    expect(TeamRosterSystem.unlinkedOf(frozen, owner.userId)).toEqual(
      TeamRosterSystem.unlinkedOf(frozen, owner.userId),
    );
  });
});
