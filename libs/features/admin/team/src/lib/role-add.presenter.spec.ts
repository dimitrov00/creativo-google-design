import { describe, expect, it } from 'vitest';
import { E164, Email, Role } from '@core/components';
import { UserId } from '@core/primitives';
import { deepFreeze, userFixture } from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import { LinkAnswer } from './link.vm';
import {
  type RoleAddInput,
  roleAddQuestionVm,
  roleAddVm,
} from './role-add.presenter';
import { roleAddWordsOf } from './role-add.words';
import { ELENA, IVAN, MARIA } from './team.fixtures.spec-support';
import { teamWordsOf } from './team.words';

/*
 * «Добави в екипа», worded (Law 10): the rows and the question pinned in
 * both languages from fixed inputs and the app's real catalogue. Who may
 * take the role is handed in, as the sheet hands it.
 */

const NBSP = ' ';
const read = (line: string | null): string | null =>
  line === null ? null : line.replaceAll(NBSP, ' ');

/** A registered client, found by phone. */
const GEORGI = userFixture({
  id: UserId.of('u-georgi'),
  firstName: 'Георги',
  lastName: 'Иванов',
  phone: E164.of('+359881112233'),
});
/** A content editor who signs in by email. */
const ANA = userFixture({
  id: UserId.of('u-ana'),
  firstName: 'Ана',
  lastName: 'Колева',
  phone: null,
  email: Email.of('ana@example.com'),
  roles: [Role.Client, Role.ContentManager],
});

/** Ivan's record, with the account he signs in with. */
const IVAN_LINKED = {
  ...IVAN,
  memberUserId: UserId.of('u-ivan'),
  memberAccountName: 'Иван Петров',
};

const wordsOf = (lang: 'bg' | 'en') => ({
  words: teamWordsOf(catalogueTranslate(lang)),
  roleAddWords: roleAddWordsOf(catalogueTranslate(lang)),
});

function inputOf(
  over: Partial<RoleAddInput> = {},
  lang: 'bg' | 'en' = 'bg',
): RoleAddInput {
  return deepFreeze({
    role: Role.Receptionist,
    team: [],
    found: [],
    asked: false,
    searching: false,
    failed: false,
    ...wordsOf(lang),
    ...over,
  });
}

describe('roleAddVm — before anything is typed', () => {
  it('says which role the account gets, and offers the team’s own people who do not hold it', () => {
    const vm = roleAddVm(inputOf({ team: [IVAN_LINKED, MARIA] }));
    expect(vm.lede).toBe(
      'Избери чий профил получава роля „Рецепция“. Човекът влиза в приложението с него.',
    );
    expect(vm.heading).toBe('От екипа');
    expect(vm.rows).toEqual([
      {
        userId: 'u-ivan',
        name: 'Иван Петров',
        line: 'Бръснар',
        testId: 'team-role-u-ivan',
      },
      {
        userId: MARIA.memberUserId,
        name: 'Мария Ангелова',
        line: 'Съдържание',
        testId: 'team-role-u-maria',
      },
    ]);
    expect(vm.emptyBody).toBeNull();
  });

  it('with nobody to offer, says how to find the account and how the person gets one', () => {
    const vm = roleAddVm(inputOf());
    expect(vm.heading).toBeNull();
    expect(vm.rows).toEqual([]);
    expect(vm.emptyTitle).toBe('');
    expect(vm.emptyBody).toBe(
      'Потърси профила по име, телефон или имейл. Ако човекът още няма профил, помоли го да влезе веднъж в приложението.',
    );
  });

  it('names the role it was opened for', () => {
    expect(roleAddVm(inputOf({ role: Role.Admin })).lede).toContain(
      '„Администратор“',
    );
    expect(roleAddVm(inputOf({ role: Role.ContentManager })).lede).toContain(
      '„Съдържание“',
    );
  });
});

describe('roleAddVm — a lookup in force', () => {
  it('shows what it found in place of the team’s own: the contact it is told apart by, then the staff roles', () => {
    const vm = roleAddVm(
      inputOf({ asked: true, found: [GEORGI, ANA], team: [ELENA] }),
    );
    expect(vm.heading).toBeNull();
    expect(
      vm.rows.map((row) => [row.userId, row.name, read(row.line), row.testId]),
    ).toEqual([
      ['u-georgi', 'Георги Иванов', '+359 88 111 2233', 'team-role-u-georgi'],
      [
        'u-ana',
        'Ана Колева',
        'ana@example.com · Съдържание',
        'team-role-u-ana',
      ],
    ]);
    expect(vm.emptyBody).toBeNull();
  });

  it('says nothing while the answer is on its way', () => {
    const vm = roleAddVm(inputOf({ asked: true, searching: true }));
    expect(vm.rows).toEqual([]);
    expect(vm.emptyTitle).toBe('');
    expect(vm.emptyBody).toBeNull();
  });

  it('with nobody found, says so and what to ask the person', () => {
    const vm = roleAddVm(inputOf({ asked: true }));
    expect(vm.emptyTitle).toBe('Няма такъв профил');
    expect(vm.emptyBody).toBe(
      'Помоли човека да влезе веднъж в приложението и потърси пак.',
    );
  });

  it('says a lookup that could not be read failed, not that nobody is there', () => {
    const vm = roleAddVm(inputOf({ asked: true, failed: true }));
    expect(vm.emptyTitle).toBe('');
    expect(vm.emptyBody).toBe('Търсенето не успя. Опитай пак.');
  });

  it('words the sheet in English', () => {
    const vm = roleAddVm(inputOf({ asked: true }, 'en'));
    expect(vm.lede).toBe(
      'Choose whose account gets the “Front desk” role. The person signs in to the app with it.',
    );
    expect(vm.emptyTitle).toBe('No such account');
    expect(vm.emptyBody).toBe(
      'Ask the person to sign in to the app once, then search again.',
    );
    expect(roleAddVm(inputOf({ team: [MARIA] }, 'en')).heading).toBe(
      'From the team',
    );
  });
});

describe('roleAddQuestionVm — the question a row asks', () => {
  it('asks before the role is given, and says the person signs in again', () => {
    const { words, roleAddWords } = wordsOf('bg');
    const question = roleAddQuestionVm(
      'Елена Василева',
      Role.ContentManager,
      words,
      roleAddWords,
    );
    expect(question.title).toBe(
      'Да дам ли на Елена Василева роля „Съдържание“?',
    );
    expect(question.message).toBe(
      'Елена ще трябва да влезе отново в приложението.',
    );
    expect(question.actions).toEqual([
      {
        id: LinkAnswer.Confirm,
        label: 'Добави',
        role: 'default',
        testId: 'team-role-confirm',
      },
      {
        id: LinkAnswer.Cancel,
        label: 'Отказ',
        role: 'cancel',
        testId: 'team-role-cancel',
      },
    ]);
  });

  it('says what an admin may do before making someone one', () => {
    const { words, roleAddWords } = wordsOf('bg');
    expect(
      roleAddQuestionVm('Иван Петров', Role.Admin, words, roleAddWords).message,
    ).toBe(
      'Иван ще може да променя всичко в салона, включително ролите и правата, и ще трябва да влезе отново в приложението.',
    );
  });

  it('words the question in English', () => {
    const { words, roleAddWords } = wordsOf('en');
    const desk = roleAddQuestionVm(
      'Elena Vasileva',
      Role.Receptionist,
      words,
      roleAddWords,
    );
    expect(desk.title).toBe('Give Elena Vasileva the “Front desk” role?');
    expect(desk.message).toBe('Elena will have to sign in to the app again.');
    expect(desk.actions.map((action) => action.label)).toEqual([
      'Add',
      'Cancel',
    ]);
    expect(
      roleAddQuestionVm('Ivan Petrov', Role.Admin, words, roleAddWords).message,
    ).toBe(
      'Ivan will be able to change everything in the shop, roles and permissions included, and will have to sign in to the app again.',
    );
  });
});
