import { describe, expect, it } from 'vitest';
import { BarberId, UserId } from '@core/primitives';
import { localDate } from '@core/testing';
import { BarberStatus } from './barber-status.data';
import { Role } from './role.data';
import { StaffSetupItem } from './staff-setup-item.data';
import {
  TeamMember,
  TeamMemberNote,
  TeamMemberStatus,
} from './team-member.data';

const barberRow = {
  teamMemberStatus: 'DRAFT',
  barberId: 'b-new',
  memberName: { bg: 'Иван', en: 'Ivan' },
  memberUserId: null,
  memberAccountName: null,
  memberRoles: [],
  teamMemberNote: 'NO_ACCOUNT',
  barberStartsLocalDate: '2026-12-01',
  barberLastWorkingLocalDate: null,
  setupDoneCount: 3,
  setupNeededCount: 5,
  staffSetupItem: 'SERVICES',
};
const roleRow = {
  teamMemberStatus: 'ROLE_ONLY',
  memberUserId: 'u-desk',
  memberAccountName: 'Мария Петрова',
  memberRoles: ['receptionist'],
};

describe('TeamMemberStatus / TeamMemberNote', () => {
  it('a member’s status is a barber’s own, or ROLE_ONLY', () => {
    expect(TeamMemberStatus).toEqual({
      Draft: BarberStatus.Draft,
      StaffOnly: BarberStatus.StaffOnly,
      Public: BarberStatus.Public,
      Departed: BarberStatus.Departed,
      RoleOnly: 'ROLE_ONLY',
    });
    expect(TeamMemberNote).toEqual({
      LastDaySet: 'LAST_DAY_SET',
      NoAccount: 'NO_ACCOUNT',
    });
  });
});

describe('TeamMember.read — the edge guard of one row', () => {
  it('reads a barber row whole, every id and day branded', () => {
    expect(TeamMember.read({ ...barberRow, stray: 1 })).toEqual({
      teamMemberStatus: BarberStatus.Draft,
      barberId: BarberId.of('b-new'),
      memberName: { bg: 'Иван', en: 'Ivan' },
      memberUserId: null,
      memberAccountName: null,
      memberRoles: [],
      teamMemberNote: TeamMemberNote.NoAccount,
      barberStartsLocalDate: localDate('2026-12-01'),
      barberLastWorkingLocalDate: null,
      setupDoneCount: 3,
      setupNeededCount: 5,
      staffSetupItem: StaffSetupItem.Services,
    });
  });

  it('reads a linked, live barber with a last day and nothing missing', () => {
    expect(
      TeamMember.read({
        ...barberRow,
        teamMemberStatus: 'PUBLIC',
        memberUserId: 'u-ivan',
        memberAccountName: 'Иван Колев',
        memberRoles: ['barber', 'admin', 'barber'],
        teamMemberNote: 'LAST_DAY_SET',
        barberLastWorkingLocalDate: '2026-12-31',
        setupDoneCount: 5,
        staffSetupItem: null,
      }),
    ).toMatchObject({
      teamMemberStatus: BarberStatus.Public,
      memberUserId: UserId.of('u-ivan'),
      memberAccountName: 'Иван Колев',
      memberRoles: [Role.Barber, Role.Admin],
      teamMemberNote: TeamMemberNote.LastDaySet,
      barberLastWorkingLocalDate: localDate('2026-12-31'),
      staffSetupItem: null,
    });
  });

  it('reads a staff account with no barber record', () => {
    expect(TeamMember.read(roleRow)).toEqual({
      teamMemberStatus: TeamMemberStatus.RoleOnly,
      memberUserId: UserId.of('u-desk'),
      memberAccountName: 'Мария Петрова',
      memberRoles: [Role.Receptionist],
    });
  });

  it.each([
    ['no object', 'ivan'],
    ['an unknown status', { ...barberRow, teamMemberStatus: 'ACTIVE' }],
    ['a blank barber id', { ...barberRow, barberId: '' }],
    ['a name in one language', { ...barberRow, memberName: { bg: 'Иван' } }],
    ['an account id that is no id', { ...barberRow, memberUserId: 7 }],
    ['an account name that is no text', { ...barberRow, memberAccountName: 7 }],
    ['an unknown role', { ...barberRow, memberRoles: ['owner'] }],
    ['roles that are no list', { ...barberRow, memberRoles: 'admin' }],
    ['an unknown note', { ...barberRow, teamMemberNote: 'ON_LEAVE' }],
    [
      'a start day that is no day',
      { ...barberRow, barberStartsLocalDate: 'soon' },
    ],
    [
      'a last day that is no day',
      { ...barberRow, barberLastWorkingLocalDate: 7 },
    ],
    ['a negative count', { ...barberRow, setupDoneCount: -1 }],
    [
      'a count that is no whole number',
      { ...barberRow, setupNeededCount: 2.5 },
    ],
    ['an unknown setup item', { ...barberRow, staffSetupItem: 'PASSPORT' }],
    ['a role-only row with no account', { ...roleRow, memberUserId: null }],
    ['a role-only row with no name', { ...roleRow, memberAccountName: null }],
  ])('refuses %s', (_what, raw) => {
    expect(TeamMember.read(raw)).toBeNull();
  });
});
