import { describe, expect, it } from 'vitest';
import {
  AccountStanding,
  Role,
  StaffPermissions,
  type TeamMember,
  TeamMemberStatus,
} from '@core/components';
import { AccessScope, StaffCapability, UserId } from '@core/primitives';
import { RoleAssignmentSystem } from '@core/systems';
import { deepFreeze } from '@core/testing';
import { type AccountPageInput, accountPageVm } from './account.presenter';
import { accountWordsOf } from './account.words';
import { catalogueTranslate } from './catalogue.spec-support';
import { LinkAnswer } from './link.vm';
import { memberWordsOf } from './member.words';
import { ELENA, MARIA, OWNER } from './team.fixtures.spec-support';
import { teamWordsOf } from './team.words';

/*
 * A staff account's page, worded (Law 10): its rows pinned in both
 * languages from fixed inputs and the app's real catalogue. Every decision
 * is handed in the way the page's store hands it — asked of the same
 * systems.
 */

/** The page's input for an account — the owner looking at someone else's, unless told. */
function inputOf(
  account: TeamMember.RoleOnly,
  over: Partial<AccountPageInput> = {},
  lang: 'bg' | 'en' = 'bg',
): AccountPageInput {
  const ticks = RoleAssignmentSystem.teamTicksOf(account.memberRoles);
  return deepFreeze({
    account,
    accountStanding: AccountStanding.Editable,
    ticks,
    ticked: ticks.filter((role) => account.memberRoles.includes(role)),
    editsPermissions: true,
    permissions: StaffPermissions.UNSET,
    words: teamWordsOf(catalogueTranslate(lang)),
    memberWords: memberWordsOf(catalogueTranslate(lang)),
    accountWords: accountWordsOf(catalogueTranslate(lang)),
    ...over,
  });
}

describe('accountPageVm — someone else’s account, to the owner', () => {
  const vm = accountPageVm(inputOf(ELENA));

  it('heads the page with the person and what they are on the team', () => {
    expect(vm.userId).toBe('u-elena');
    expect(vm.name).toBe('Елена Василева');
    expect(vm.line).toBe('Рецепция');
  });

  it('offers the staff roles as ticks, the held ones on — «Бръснар» is no tick for someone who is not one', () => {
    expect(vm.editable).toBe(true);
    expect(vm.ticks).toEqual([
      {
        role: Role.Receptionist,
        label: 'Рецепция',
        checked: true,
        testId: 'account-role-receptionist',
      },
      {
        role: Role.ContentManager,
        label: 'Съдържание',
        checked: false,
        testId: 'account-role-content_manager',
      },
      {
        role: Role.Admin,
        label: 'Администратор',
        checked: false,
        testId: 'account-role-admin',
      },
    ]);
  });

  it('says what a change costs the person, and where «Бръснар» is given', () => {
    expect(vm.notes).toEqual([
      'След промяна Елена ще трябва да влезе отново.',
      '„Бръснар“ се дава от страницата на бръснаря, със „Свържи профил“.',
    ]);
  });

  it('with no tick left, says first that the account would leave the team', () => {
    expect(accountPageVm(inputOf(ELENA, { ticked: [] })).notes[0]).toBe(
      'Без роля профилът напуска екипа. Използвай „Махни от екипа“.',
    );
  });

  it('leads to «Права» for the level held, and counts how far it departs', () => {
    expect(vm.levels).toEqual([
      {
        level: Role.Receptionist,
        label: 'Права на „Рецепция“',
        value: 'Стандартни',
        testId: 'account-level-receptionist',
      },
    ]);
    const cut = StaffPermissions.read({
      [StaffPermissions.fieldOf(Role.Receptionist, StaffCapability.Hours)]:
        AccessScope.None,
    });
    expect(
      accountPageVm(inputOf(ELENA, { permissions: cut })).levels[0]?.value,
    ).toBe('1 промяна');
  });

  it('asks before the account leaves the team, and says what is left', () => {
    expect(vm.remove).toEqual({
      title: 'Да махна ли Елена Василева от екипа?',
      message: 'Елена остава клиент и ще трябва да влезе отново.',
      actions: [
        {
          id: LinkAnswer.Confirm,
          label: 'Махни',
          role: 'default',
          testId: 'account-remove-confirm',
        },
        {
          id: LinkAnswer.Cancel,
          label: 'Отказ',
          role: 'cancel',
          testId: 'account-remove-cancel',
        },
      ],
    });
  });

  it('a barber with no record keeps «Бръснар» as a tick, and is not told where it is given', () => {
    const barber: TeamMember.RoleOnly = {
      ...ELENA,
      memberRoles: [Role.Barber, Role.Receptionist],
    };
    const page = accountPageVm(inputOf(barber));
    expect(page.line).toBe('Бръснар, Рецепция');
    expect(page.ticks.map((tick) => [tick.label, tick.checked])).toEqual([
      ['Бръснар', true],
      ['Рецепция', true],
      ['Съдържание', false],
      ['Администратор', false],
    ]);
    expect(page.notes).toEqual([
      'След промяна Елена ще трябва да влезе отново.',
    ]);
  });
});

describe('accountPageVm — an account that is read', () => {
  it('the viewer’s own: the roles held as rows, why they are read, no way off the team', () => {
    const vm = accountPageVm(
      inputOf(OWNER, { accountStanding: AccountStanding.Own }),
    );
    expect(vm.editable).toBe(false);
    expect(vm.ticks.map((tick) => tick.label)).toEqual(['Администратор']);
    expect(vm.notes).toEqual([
      'Това е твоят профил. Ролите му не се променят оттук.',
    ]);
    expect(vm.remove).toBeNull();
    // The admin's everything is no level: nothing leads to «Права».
    expect(vm.levels).toEqual([]);
  });

  it('the vendor’s: named, with no role to list and no change to make', () => {
    const vendor: TeamMember.RoleOnly = {
      teamMemberStatus: TeamMemberStatus.RoleOnly,
      memberUserId: UserId.of('u-vendor'),
      memberAccountName: 'Вера Димова',
      memberRoles: [Role.Sysadmin],
    };
    const vm = accountPageVm(
      inputOf(vendor, { accountStanding: AccountStanding.Vendor }),
    );
    expect(vm.line).toBe('Поддръжка');
    expect(vm.ticks).toEqual([]);
    expect(vm.notes).toEqual([
      'Профил на поддръжката. Ролите му не се променят.',
    ]);
  });

  it('someone who has not registered: the word for no name, and why nothing can change', () => {
    const stub: TeamMember.RoleOnly = { ...ELENA, memberAccountName: '' };
    const vm = accountPageVm(
      inputOf(stub, { accountStanding: AccountStanding.Unregistered }),
    );
    expect(vm.name).toBe('Без име');
    expect(vm.notes).toEqual([
      'Този човек още не е завършил регистрацията си.',
    ]);
  });

  it('to someone who assigns no roles: the roles held, who changes them, and no way to «Права»', () => {
    const vm = accountPageVm(
      inputOf(MARIA, {
        accountStanding: AccountStanding.ReadOnly,
        editsPermissions: false,
      }),
    );
    expect(vm.ticks.map((tick) => tick.label)).toEqual(['Съдържание']);
    expect(vm.notes).toEqual(['Ролите променя само администраторът.']);
    expect(vm.levels).toEqual([]);
    expect(vm.remove).toBeNull();
  });
});

describe('accountPageVm — in English, and pure', () => {
  it('words the page in English', () => {
    const vm = accountPageVm(inputOf(ELENA, {}, 'en'));
    expect(vm.line).toBe('Front desk');
    expect(vm.notes).toEqual([
      'After a change Елена will have to sign in again.',
      '“Barber” is given from the barber’s page, with “Link an account”.',
    ]);
    expect(vm.remove?.title).toBe('Remove Елена Василева from the team?');
    expect(vm.remove?.actions.map((action) => action.label)).toEqual([
      'Remove',
      'Cancel',
    ]);
  });

  it('same input → same output, the input untouched', () => {
    const input = inputOf(ELENA);
    expect(accountPageVm(input)).toEqual(accountPageVm(input));
  });
});
