import {
  BarberLifecycle,
  BarberStatus,
  Role,
  type TeamMember,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import { BarberId, UserId } from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  barberFixture,
  barberScheduleFixture,
  localDate,
  serviceFixture,
  termsFixture,
} from '@core/testing';

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

/*
 * The same shop's barber RECORDS, as the staff's team stream holds them:
 * Ivan at work with a title, a service and a roster; Nikolay in
 * preparation with nothing but a name and a start day; Stefan gone.
 */

/** Ivan: taking bookings since March 2024. */
export const IVAN_RECORD = barberFixture({
  id: IVAN.barberId,
  name: IVAN.memberName,
  title: { bg: 'Старши бръснар', en: 'Senior barber' },
  barberStartsLocalDate: START,
  sortOrder: 0,
});

/** Nikolay: in preparation, starting in December, working at every shop. */
export const NIKOLAY_RECORD = barberFixture(
  {
    id: NIKOLAY.barberId,
    name: NIKOLAY.memberName,
    title: null,
    bio: null,
    yearsExperience: null,
    locationIds: [],
    barberStartsLocalDate: localDate('2026-12-01'),
    sortOrder: 3,
  },
  BarberLifecycle.draft(FIXTURE_NOW_UTC_MS, BarberStatus.Public),
);

/** Stefan: left at the end of September. */
export const STEFAN_RECORD = barberFixture(
  {
    id: STEFAN.barberId,
    name: STEFAN.memberName,
    barberStartsLocalDate: START,
    barberLastWorkingLocalDate: localDate('2026-09-30'),
    sortOrder: 4,
  },
  {
    barberStatus: BarberStatus.Departed,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDepartedUserId: null,
    barberSessionsRevokedAtUtcMs: null,
    barberRehireStatus: BarberStatus.Public,
  },
);

/** A service that lists the given barbers, each at the service's own terms. */
export function serviceOf(...barberIds: readonly BarberId[]) {
  const terms = termsFixture(1500, 30);
  return serviceFixture({
    ...terms,
    offerings: barberIds.map((barberId) => ({
      barberId,
      overrides: [],
      ...terms,
    })),
  });
}

/** A weekday roster for the given barber, in force since the start of 2026. */
export function rosterOf(barberId: BarberId) {
  return barberScheduleFixture({ id: barberId });
}
