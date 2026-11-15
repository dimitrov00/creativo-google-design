import { describe, expect, it } from 'vitest';
import { E164, Email, Role } from '@core/components';
import { Locale, UserId } from '@core/primitives';
import { deepFreeze, userFixture } from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import { linkQuestionVm, releaseQuestionVm } from './link-question.presenter';
import { type LinkInput, linkVm } from './link.presenter';
import { LinkAnswer } from './link.vm';
import { linkWordsOf } from './link.words';
import { ELENA, NIKOLAY_RECORD } from './team.fixtures.spec-support';
import { teamWordsOf } from './team.words';

/*
 * «Свържи профил» and «Разкачи профила», worded (Law 10): the rows and the
 * questions pinned in both languages from fixed inputs and the app's real
 * catalogue. Who is offered is handed in, as the sheet hands it.
 */

const NBSP = '\u00a0';
const read = (line: string | null): string | null =>
  line === null ? null : line.replaceAll(NBSP, ' ');

/** A registered client, found by phone. */
const GEORGI = userFixture({
  id: UserId.of('u-georgi'),
  firstName: 'Георги',
  lastName: 'Иванов',
  phone: E164.of('+359881112233'),
});
/** A colleague at the front desk who signs in by email. */
const ANA = userFixture({
  id: UserId.of('u-ana'),
  firstName: 'Ана',
  lastName: 'Колева',
  phone: null,
  email: Email.of('ana@example.com'),
  roles: [Role.Client, Role.Receptionist],
});

function inputOf(
  over: Partial<LinkInput> = {},
  lang: 'bg' | 'en' = 'bg',
): LinkInput {
  return deepFreeze({
    barber: NIKOLAY_RECORD,
    unlinked: [],
    found: [],
    asked: false,
    searching: false,
    failed: false,
    words: teamWordsOf(catalogueTranslate(lang)),
    linkWords: linkWordsOf(catalogueTranslate(lang)),
    locale: lang === 'bg' ? Locale.Bg : Locale.En,
    ...over,
  });
}

describe('linkVm — before anything is typed', () => {
  it('says whose account it will be, and offers the team’s own accounts with no record', () => {
    const vm = linkVm(inputOf({ unlinked: [ELENA] }));
    expect(vm.lede).toBe(
      'Николай ще влиза в приложението с този профил и ще вижда своя график.',
    );
    expect(vm.heading).toBe('От екипа');
    expect(vm.rows).toEqual([
      {
        userId: ELENA.memberUserId,
        name: 'Елена Василева',
        line: 'Рецепция',
        testId: 'member-link-u-elena',
      },
    ]);
    expect(vm.emptyBody).toBeNull();
  });

  it('with nobody to offer, says how to find the account and how the person gets one', () => {
    const vm = linkVm(inputOf());
    expect(vm.heading).toBeNull();
    expect(vm.rows).toEqual([]);
    expect(vm.emptyTitle).toBe('');
    expect(vm.emptyBody).toBe(
      'Потърси профила по име, телефон или имейл. Ако Николай още няма профил, помоли Николай да влезе веднъж в приложението.',
    );
  });
});

describe('linkVm — a lookup in force', () => {
  it('shows what it found in place of the team’s own: the contact it is told apart by, then the staff roles', () => {
    const vm = linkVm(
      inputOf({ asked: true, found: [GEORGI, ANA], unlinked: [ELENA] }),
    );
    expect(vm.heading).toBeNull();
    expect(
      vm.rows.map((row) => [row.userId, row.name, read(row.line)]),
    ).toEqual([
      ['u-georgi', 'Георги Иванов', '+359 88 111 2233'],
      ['u-ana', 'Ана Колева', 'ana@example.com · Рецепция'],
    ]);
    expect(vm.emptyBody).toBeNull();
  });

  it('says nothing while the answer is on its way', () => {
    const vm = linkVm(inputOf({ asked: true, searching: true }));
    expect(vm.rows).toEqual([]);
    expect(vm.emptyTitle).toBe('');
    expect(vm.emptyBody).toBeNull();
  });

  it('with nobody found, says so and what to ask the person', () => {
    const vm = linkVm(inputOf({ asked: true }));
    expect(vm.emptyTitle).toBe('Няма такъв профил');
    expect(vm.emptyBody).toBe(
      'Помоли Николай да влезе веднъж в приложението и потърси пак.',
    );
  });

  it('says a lookup that could not be read failed, not that nobody is there', () => {
    const vm = linkVm(inputOf({ asked: true, failed: true }));
    expect(vm.emptyTitle).toBe('');
    expect(vm.emptyBody).toBe('Търсенето не успя. Опитай пак.');
  });

  it('words the sheet in English', () => {
    const vm = linkVm(inputOf({ asked: true }, 'en'));
    expect(vm.lede).toBe(
      'Nikolay will sign in with this account and see their own schedule.',
    );
    expect(vm.emptyTitle).toBe('No such account');
    expect(vm.emptyBody).toBe(
      'Ask Nikolay to sign in to the app once, then search again.',
    );
    expect(linkVm(inputOf({ unlinked: [ELENA] }, 'en')).heading).toBe(
      'From the team',
    );
  });
});

describe('the questions before a link changes', () => {
  it('asks before an account becomes the record’s, and says what it costs them', () => {
    const words = linkWordsOf(catalogueTranslate('bg'));
    expect(
      linkQuestionVm('Георги Иванов', NIKOLAY_RECORD, words, Locale.Bg),
    ).toEqual({
      title: 'Да свържа ли Георги Иванов с Николай?',
      message: 'Георги ще трябва да влезе отново в приложението.',
      actions: [
        {
          id: LinkAnswer.Confirm,
          label: 'Свържи',
          role: 'default',
          testId: 'member-link-confirm',
        },
        {
          id: LinkAnswer.Cancel,
          label: 'Отказ',
          role: 'cancel',
          testId: 'member-link-cancel',
        },
      ],
    });
  });

  it('asks the same in English, and before an account is released', () => {
    const words = linkWordsOf(catalogueTranslate('en'));
    const link = linkQuestionVm(
      'Georgi Ivanov',
      NIKOLAY_RECORD,
      words,
      Locale.En,
    );
    expect(link.title).toBe('Link Georgi Ivanov to Nikolay?');
    expect(link.message).toBe('Georgi will have to sign in to the app again.');
    expect(link.actions.map((action) => action.label)).toEqual([
      'Link',
      'Cancel',
    ]);
    const release = releaseQuestionVm('Georgi Ivanov', words);
    expect(release.title).toBe('Unlink Georgi Ivanov’s account?');
    expect(release.actions.map((action) => action.label)).toEqual([
      'Unlink',
      'Cancel',
    ]);
  });
});

describe('linkVm — purity', () => {
  it('same input → same output, the input untouched', () => {
    const input = inputOf({ asked: true, found: [GEORGI] });
    expect(linkVm(input)).toEqual(linkVm(input));
  });
});
