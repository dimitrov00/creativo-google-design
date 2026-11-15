import {
  BarberStatus,
  RecordClaim,
  Role,
  type StaffLevel,
  type TeamMember,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import type { BarberId, UserId } from '@core/primitives';
import {
  type Barber,
  type BarberSchedule,
  Profile,
  type Service,
  type User,
} from '@core/entities';
import { StaffSetupSystem } from './staff-setup.system';

/** Who is looking at a record's page, as their stored account says. */
export type RecordViewer = {
  readonly userId: UserId | null;
  /** The barber record the viewer's own account is linked to. */
  readonly linkedBarberId: BarberId | null;
  /** The viewer's stored roles let them change roles and links (`Roles.assignsRoles`). */
  readonly assignsRoles: boolean;
};

/** The Team page's runs (`TeamRosterSystem.sectionsOf`). */
export type TeamSections = {
  /** Barber records that are setting up or working, in team order. */
  readonly working: readonly TeamMember.OfBarber[];
  /** Staff accounts linked to no record, by name. */
  readonly others: readonly TeamMember.RoleOnly[];
  /** Barber records that have left, in team order. */
  readonly departed: readonly TeamMember.OfBarber[];
};

/** What the Team page's read found: every record and every staff account. */
export type TeamRosterFacts = {
  /** Every barber record, whatever its lifecycle. */
  readonly barbers: readonly Barber[];
  /**
   * Every account that holds a staff role — `null` when the reader may
   * not see accounts (staff permissions P6: an editor of every barber's
   * page lists the records, never who holds which role), so they were not
   * read at all.
   */
  readonly accounts: readonly User[] | null;
  /** Every service — the offerings say who performs what. */
  readonly services: readonly Service[];
  /** Every roster — its id is its barber's. */
  readonly schedules: readonly BarberSchedule[];
};

/** Team order: `sortOrder`, a tie by id. */
function byTeamOrder(a: Barber, b: Barber): number {
  return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Role-only accounts by name, a tie by id. */
function byAccountName(a: TeamMember.RoleOnly, b: TeamMember.RoleOnly): number {
  if (a.memberAccountName !== b.memberAccountName) {
    return a.memberAccountName < b.memberAccountName ? -1 : 1;
  }
  return a.memberUserId < b.memberUserId
    ? -1
    : a.memberUserId > b.memberUserId
      ? 1
      : 0;
}

/**
 * The first note that applies to a barber's row (team onboarding D8): a
 * last working day still ahead of a barber who has not left, then no
 * linked account — said only when the accounts were read (`accountsRead`):
 * to a reader who may not see accounts, "no account" would be a guess.
 */
function noteOf(
  barber: Barber,
  account: User | null,
  accountsRead: boolean,
): TeamMemberNote | null {
  if (
    barber.barberStatus !== BarberStatus.Departed &&
    barber.barberLastWorkingLocalDate !== null
  ) {
    return TeamMemberNote.LastDaySet;
  }
  return accountsRead && account === null ? TeamMemberNote.NoAccount : null;
}

/**
 * TeamRosterSystem — the Team page's rows (team onboarding D8,
 * `docs/designs/team-onboarding.md`). Pure: the list pipeline reads the
 * records and the staff accounts and asks. Nothing about a member is
 * stored for the page: each row is derived from the barber record, the
 * account linked to it, the services and the roster, so the page, the
 * member's own setup card and the go-live step read one truth
 * (`StaffSetupSystem.checklistOf`).
 */
export const TeamRosterSystem = {
  /**
   * Every member, in the page's order:
   *
   * 1. the barber records in team order, each with the account linked to it
   *    (`User.linkedBarberId`; the first by the read's order when a
   *    corrupted store links two), that account's name and stored roles,
   *    its one note and its setup progress over the items bookings need;
   * 2. then the staff accounts linked to no record that exists (`ROLE_ONLY`
   *    — the front desk, a content editor, an admin, a barber not linked
   *    yet), by name.
   *
   * With no accounts read (`accounts: null`) the rows are the barber
   * records alone: no account, name or role beside any of them, no
   * "no account" note and no role-only row.
   */
  membersOf(facts: TeamRosterFacts): readonly TeamMember[] {
    const { services, schedules } = facts;
    const accountsRead = facts.accounts !== null;
    const accounts = facts.accounts ?? [];
    const barbers = [...facts.barbers].sort(byTeamOrder);
    const linked = new Set<User>();
    const members: TeamMember[] = [];
    for (let i = 0; i < barbers.length; i++) {
      const barber = barbers[i] as Barber;
      let account: User | null = null;
      for (let j = 0; j < accounts.length; j++) {
        const candidate = accounts[j] as User;
        if (candidate.linkedBarberId !== barber.id) continue;
        linked.add(candidate);
        if (account === null) account = candidate;
      }
      let schedule: BarberSchedule | null = null;
      for (let j = 0; j < schedules.length; j++) {
        if ((schedules[j] as BarberSchedule).id === barber.id) {
          schedule = schedules[j] as BarberSchedule;
          break;
        }
      }
      const checklist = StaffSetupSystem.checklistOf(
        barber,
        services,
        schedule,
      );
      members.push({
        teamMemberStatus: barber.barberStatus,
        barberId: barber.id,
        memberName: barber.name,
        memberUserId: account === null ? null : account.id,
        memberAccountName: account === null ? null : Profile.fullName(account),
        memberRoles: account === null ? [] : account.roles,
        teamMemberNote: noteOf(barber, account, accountsRead),
        barberStartsLocalDate: barber.barberStartsLocalDate,
        barberLastWorkingLocalDate: barber.barberLastWorkingLocalDate,
        setupDoneCount: StaffSetupSystem.doneCountOf(checklist),
        setupNeededCount: checklist.needed.length,
        staffSetupItem: checklist.firstMissing,
      });
    }
    const roleOnly: TeamMember.RoleOnly[] = [];
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i] as User;
      if (linked.has(account)) continue;
      roleOnly.push({
        teamMemberStatus: TeamMemberStatus.RoleOnly,
        memberUserId: account.id,
        memberAccountName: Profile.fullName(account),
        memberRoles: account.roles,
      });
    }
    return [...members, ...roleOnly.sort(byAccountName)];
  },

  /**
   * The page's three runs, each in the members' own order: the barbers who
   * are setting up or working, the staff accounts with no record, and the
   * barbers who have left — set apart, because a leaver is history, not
   * someone to open today.
   */
  sectionsOf(members: readonly TeamMember[]): TeamSections {
    const working: TeamMember.OfBarber[] = [];
    const others: TeamMember.RoleOnly[] = [];
    const departed: TeamMember.OfBarber[] = [];
    for (const member of members) {
      if (member.teamMemberStatus === TeamMemberStatus.RoleOnly) {
        others.push(member);
      } else if (member.teamMemberStatus === TeamMemberStatus.Departed) {
        departed.push(member);
      } else {
        working.push(member);
      }
    }
    return { working, others, departed };
  },

  /**
   * Who holds a staff level, in the members' order: every member whose
   * stored roles name it. A leaver is none of them — their roles went with
   * them — and a barber record with no account holds no level yet.
   */
  holdersOf(
    members: readonly TeamMember[],
    level: StaffLevel,
  ): readonly TeamMember[] {
    return members.filter(
      (member) =>
        member.teamMemberStatus !== TeamMemberStatus.Departed &&
        member.memberRoles.includes(level),
    );
  },

  /** The row of the barber record `barberId`, or `null` when the answer holds none. */
  recordOf(
    members: readonly TeamMember[],
    barberId: BarberId,
  ): TeamMember.OfBarber | null {
    for (const member of members) {
      if (
        member.teamMemberStatus !== TeamMemberStatus.RoleOnly &&
        member.barberId === barberId
      ) {
        return member;
      }
    }
    return null;
  },

  /**
   * What a barber record is to the person looking at its page (staff
   * permissions P9): `MINE` when the viewer's own stored link names it;
   * `OPEN` when nobody is linked to it, it has not left, and the viewer
   * assigns roles and is linked to no record themself; else `NONE`. The
   * viewer's link is the stored account's, so the answer follows a link
   * the moment it is written; the record's is the Team list's row.
   */
  claimOf(member: TeamMember.OfBarber, viewer: RecordViewer): RecordClaim {
    if (viewer.userId === null || !viewer.assignsRoles) return RecordClaim.None;
    if (viewer.linkedBarberId === member.barberId) return RecordClaim.Mine;
    return member.teamMemberStatus !== TeamMemberStatus.Departed &&
      member.memberUserId === null &&
      viewer.linkedBarberId === null
      ? RecordClaim.Open
      : RecordClaim.None;
  },

  /**
   * May the person looking link someone's account to the record («Свържи
   * профил», team onboarding D8): they assign roles, the record has not
   * left, and nobody is linked to it.
   */
  linksAccount(member: TeamMember.OfBarber, viewer: RecordViewer): boolean {
    return (
      viewer.userId !== null &&
      viewer.assignsRoles &&
      member.teamMemberStatus !== TeamMemberStatus.Departed &&
      member.memberUserId === null
    );
  },

  /**
   * May they release the account linked to it («Откачи профила»): they
   * assign roles, the record has not left, and the account linked is
   * someone else's — their own leaves through «Не съм аз», which signs
   * nobody out.
   */
  releasesAccount(member: TeamMember.OfBarber, viewer: RecordViewer): boolean {
    return (
      viewer.userId !== null &&
      viewer.assignsRoles &&
      member.teamMemberStatus !== TeamMemberStatus.Departed &&
      member.memberUserId !== null &&
      member.memberUserId !== viewer.userId
    );
  },

  /**
   * The staff accounts a record may be linked to without a lookup, in the
   * members' order («Свържи профил»): the ones linked to no record
   * (`ROLE_ONLY`) that have registered (a name), hold no `sysadmin` and
   * are not the viewer's own, whose door is «Това съм аз». The rows
   * themselves, never copies.
   */
  unlinkedOf(
    members: readonly TeamMember[],
    viewerUserId: UserId | null,
  ): readonly TeamMember.RoleOnly[] {
    const unlinked: TeamMember.RoleOnly[] = [];
    for (const member of members) {
      if (
        member.teamMemberStatus === TeamMemberStatus.RoleOnly &&
        member.memberUserId !== viewerUserId &&
        member.memberAccountName.length > 0 &&
        !member.memberRoles.includes(Role.Sysadmin)
      ) {
        unlinked.push(member);
      }
    }
    return unlinked;
  },
} as const;
