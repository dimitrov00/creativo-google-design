import { describe, expect, it } from 'vitest';
import { E164, Role } from '@core/components';
import { UserId } from '@core/primitives';
import { deepFreeze, userFixture } from '@core/testing';
import { catalogueTranslate } from '../catalogue.spec-support';
import { teamWordsOf } from '../team.words';
import { type SupportLookupInput, supportLookupVm } from './support.presenter';
import { supportWordsOf } from './support.words';

/*
 * The accounts support may read as (OR-24), as the one lookup sheet prints
 * them — worded from the catalogue, deciding nothing.
 */

const NBSP = ' ';
const read = (line: string | null): string | null =>
  line === null ? null : line.replaceAll(NBSP, ' ');

/** The owner, found by phone. */
const OWNER = userFixture({
  id: UserId.of('u-owner'),
  firstName: 'Александър',
  lastName: 'Тодоров',
  phone: E164.of('+359881112233'),
  roles: [Role.Client, Role.Barber, Role.Admin],
});

function inputOf(
  over: Partial<SupportLookupInput> = {},
  lang: 'bg' | 'en' = 'bg',
): SupportLookupInput {
  const translate = catalogueTranslate(lang);
  return deepFreeze({
    found: [],
    asked: false,
    searching: false,
    failed: false,
    words: teamWordsOf(translate),
    supportWords: supportWordsOf(translate),
    ...over,
  });
}

describe('supportLookupVm', () => {
  it('asks for a name, a phone or an e-mail before anything is typed', () => {
    expect(supportLookupVm(inputOf())).toEqual({
      lede: 'Потърси по име, телефон или имейл.',
      heading: null,
      rows: [],
      emptyTitle: '',
      emptyBody: 'Напиши име, телефон или имейл.',
    });
  });

  it('prints each found account as the Team’s lookup rows are worded — name, then contact and staff roles', () => {
    const vm = supportLookupVm(inputOf({ asked: true, found: [OWNER] }));
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0]?.userId).toBe('u-owner');
    expect(vm.rows[0]?.name).toBe('Александър Тодоров');
    expect(vm.rows[0]?.testId).toBe('support-account-u-owner');
    expect(read(vm.rows[0]?.line ?? null)).toContain('+359 88 111 2233');
    expect(vm.emptyBody).toBeNull();
  });

  it('says so when a lookup finds no one, and when it could not be read — and nothing while it is still out', () => {
    expect(supportLookupVm(inputOf({ asked: true }))).toMatchObject({
      emptyTitle: 'Няма такъв профил',
      emptyBody: 'Провери написаното и потърси пак.',
    });
    expect(
      supportLookupVm(inputOf({ asked: true, failed: true })),
    ).toMatchObject({
      emptyTitle: '',
      emptyBody: 'Търсенето не се зареди. Опитай пак.',
    });
    expect(
      supportLookupVm(inputOf({ asked: true, searching: true })),
    ).toMatchObject({ emptyTitle: '', emptyBody: null });
  });

  it('words the same in English', () => {
    expect(supportLookupVm(inputOf({}, 'en')).lede).toBe(
      'Search by name, phone or e-mail.',
    );
  });
});
