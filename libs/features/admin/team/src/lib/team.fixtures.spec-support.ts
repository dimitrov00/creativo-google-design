import {
  BarberStatus,
  Role,
  type TeamMember,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import { BarberId, UserId } from '@core/primitives';
import { localDate } from '@core/testing';

/*
 * The Team screens' sample shop, as `listTeam` answers it: four barber
 * records in team order — two taking bookings (one with a last day set), a
 * course student the team alone sees, one in preparation with no account —
 * a leaver, and three accounts with no record. Specs only.
 */

const START = localDate('2024-03-03');

function barber(
  id: string,
  bg: string,
  en: string,
  over: Partial<TeamMember.OfBarber> = {},
): TeamMember.OfBarber {
  return {
    teamMemberStatus: BarberStatus.Public,
    barberId: BarberId.of(id),
    memberName: { bg, en },
    memberUserId: UserId.of(`u-${id}`),
    memberAccountName: bg,
    memberRoles: [Role.Barber],
    teamMemberNote: null,
    barberStartsLocalDate: START,
    barberLastWorkingLocalDate: null,
    setupDoneCount: 5,
    setupNeededCount: 5,
    staffSetupItem: null,
    ...over,
  };
}

export const IVAN = barber('ivan', 'Иван Петров', 'Ivan Petrov');
export const GEORGI = barber('georgi', 'Георги Димов', 'Georgi Dimov', {
  teamMemberNote: TeamMemberNote.LastDaySet,
  barberLastWorkingLocalDate: localDate('2026-12-31'),
});
export const MARTIN = barber('martin', 'Мартин Колев', 'Martin Kolev', {
  teamMemberStatus: BarberStatus.StaffOnly,
});
export const NIKOLAY = barber(
  'nikolay',
  'Николай Стоянов',
  'Nikolay Stoyanov',
  {
    teamMemberStatus: BarberStatus.Draft,
    memberUserId: null,
    memberAccountName: null,
    memberRoles: [],
    teamMemberNote: TeamMemberNote.NoAccount,
    setupDoneCount: 3,
  },
);
export const STEFAN = barber('stefan', 'Стефан Илиев', 'Stefan Iliev', {
  teamMemberStatus: BarberStatus.Departed,
  memberUserId: null,
  memberAccountName: null,
  memberRoles: [],
  barberLastWorkingLocalDate: localDate('2026-09-30'),
});

function account(
  id: string,
  name: string,
  roles: readonly Role[],
): TeamMember.RoleOnly {
  return {
    teamMemberStatus: TeamMemberStatus.RoleOnly,
    memberUserId: UserId.of(id),
    memberAccountName: name,
    memberRoles: roles,
  };
}

export const OWNER = account('u-owner', 'Александър Тодоров', [Role.Admin]);
export const ELENA = account('u-elena', 'Елена Василева', [Role.Receptionist]);
export const MARIA = account('u-maria', 'Мария Ангелова', [
  Role.ContentManager,
  Role.Client,
]);

/** The whole shop, in `listTeam`'s order: the records in team order, then the accounts by name. */
export const TEAM: readonly TeamMember[] = [
  IVAN,
  GEORGI,
  MARTIN,
  NIKOLAY,
  STEFAN,
  OWNER,
  ELENA,
  MARIA,
];

/** What someone who edits profiles and does not manage the team is answered: the records alone, with no account read. */
export const RECORDS: readonly TeamMember[] = [
  IVAN,
  GEORGI,
  MARTIN,
  NIKOLAY,
  STEFAN,
].map((member) => ({
  ...member,
  memberUserId: null,
  memberAccountName: null,
  memberRoles: [],
  teamMemberNote:
    member.teamMemberNote === TeamMemberNote.NoAccount
      ? null
      : member.teamMemberNote,
}));
