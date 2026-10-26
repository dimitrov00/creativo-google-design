import { describe, expect, it } from 'vitest';
import { CustomerOrigin, E164, Email } from '@core/components';
import { RepositoryError } from '@core/errors';
import { CustomerId, Result, UserId } from '@core/primitives';
import { customerFixture, registeredUserFixture } from '@core/testing';
import {
  accountOption,
  clientSearchOptions,
  recordOption,
} from './client-search';

/** Мартин, an account: his name as written, his number and his mail. */
const MARTIN = registeredUserFixture({
  id: UserId.of('u-martin'),
  firstName: 'Мартин',
  lastName: 'Илиев',
  phone: E164.of('+359887654321'),
  email: Email.of('martin@example.test'),
  searchName: 'мартин илиев',
});

/** Мартин's own record — the shop's copy of him, linked to his account. */
const MARTIN_RECORD = customerFixture({
  id: CustomerId.of('cus_martin'),
  userId: UserId.of('u-martin'),
  displayName: 'Мартин от салона',
  phone: E164.of('+359887654321'),
  email: null,
});

/** Иван, a walk-in the desk entered once: a record and no account. */
const IVAN_WALK_IN = customerFixture({
  id: CustomerId.of('cus_walkin_ivan'),
  userId: null,
  displayName: 'Иван',
  phone: E164.of('+359888123123'),
  email: Email.of('ivan@mail.bg'),
  customerOrigin: CustomerOrigin.StaffWalkIn,
});

/** Another Иван, another walk-in: the same name, his own number. */
const OTHER_IVAN = customerFixture({
  id: CustomerId.of('cus_walkin_other'),
  userId: null,
  displayName: 'Иван',
  phone: E164.of('+359888999000'),
  email: null,
  customerOrigin: CustomerOrigin.StaffWalkIn,
});

const nobody = Result.ok([]);

describe('accountOption', () => {
  it('keys an account by its uid and prints its contact the profile way', () => {
    expect(accountOption(MARTIN)).toEqual({
      id: 'u-martin',
      label: 'Мартин Илиев',
      phone: '+359 88 765 4321',
      phoneHref: '+359887654321',
      meta: 'martin@example.test',
      email: 'martin@example.test',
    });
  });

  it('labels an account with no name written by its search key', () => {
    const keyed = registeredUserFixture({
      id: UserId.of('u-keyed'),
      firstName: null,
      lastName: null,
      phone: null,
      searchName: 'мартин петров',
    });
    expect(accountOption(keyed)).toMatchObject({
      id: 'u-keyed',
      label: 'мартин петров',
      phone: null,
      phoneHref: null,
    });
  });
});

describe('recordOption', () => {
  it("keys a walk-in's record by the record, never by the name, and marks it as having no profile", () => {
    expect(recordOption(IVAN_WALK_IN)).toEqual({
      id: 'guest-cus_walkin_ivan',
      label: 'Иван',
      phone: '+359 88 812 3123',
      phoneHref: '+359888123123',
      meta: 'ivan@mail.bg',
      email: 'ivan@mail.bg',
      noAccount: true,
    });
  });

  it("reads an account's record as that account — unmarked", () => {
    const option = recordOption(MARTIN_RECORD);
    expect(option).toEqual({
      id: 'u-martin',
      label: 'Мартин от салона',
      phone: '+359 88 765 4321',
      phoneHref: '+359887654321',
      meta: null,
      email: null,
    });
    expect('noAccount' in option).toBe(false);
  });
});

describe('clientSearchOptions', () => {
  it('lists every key’s accounts first, then the records, each person once', () => {
    const options = clientSearchOptions([
      { accounts: nobody, records: Result.ok([MARTIN_RECORD, IVAN_WALK_IN]) },
      null,
      { accounts: Result.ok([MARTIN]), records: Result.ok([IVAN_WALK_IN]) },
    ]);
    // The account's own answer wins over his record, found by an earlier
    // key; the walk-in, answered twice, is one row.
    expect(options.map((option) => [option.id, option.label])).toEqual([
      ['u-martin', 'Мартин Илиев'],
      ['guest-cus_walkin_ivan', 'Иван'],
    ]);
  });

  it('keeps two walk-ins of one name apart — two people, two numbers', () => {
    const options = clientSearchOptions([
      { accounts: nobody, records: Result.ok([IVAN_WALK_IN, OTHER_IVAN]) },
    ]);
    expect(options.map((option) => [option.id, option.phone])).toEqual([
      ['guest-cus_walkin_ivan', '+359 88 812 3123'],
      ['guest-cus_walkin_other', '+359 88 899 9000'],
    ]);
  });

  it('lets one index fail without silencing the other', () => {
    const refused = Result.err(RepositoryError.unavailable());
    expect(
      clientSearchOptions([
        { accounts: refused, records: Result.ok([IVAN_WALK_IN]) },
      ]).map((option) => option.id),
    ).toEqual(['guest-cus_walkin_ivan']);
    expect(
      clientSearchOptions([
        { accounts: Result.ok([MARTIN]), records: refused },
      ]).map((option) => option.id),
    ).toEqual(['u-martin']);
  });

  it('answers nobody for no answers, and leaves its input as it was', () => {
    expect(clientSearchOptions([])).toEqual([]);
    const answers = [
      { accounts: Result.ok([MARTIN]), records: Result.ok([IVAN_WALK_IN]) },
    ] as const;
    const before = JSON.stringify(answers);
    expect(clientSearchOptions(answers)).toEqual(clientSearchOptions(answers));
    expect(JSON.stringify(answers)).toBe(before);
  });
});
