import {
  BarberStatus,
  type TeamMember,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import {
  type Barber,
  type BarberSchedule,
  Profile,
  type Service,
  type User,
} from '@core/entities';
import { StaffSetupSystem } from './staff-setup.system';

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
      let done = 0;
      for (let j = 0; j < checklist.needed.length; j++) {
        if (checklist.needed[j]?.done === true) done++;
      }
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
        setupDoneCount: done,
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
} as const;
