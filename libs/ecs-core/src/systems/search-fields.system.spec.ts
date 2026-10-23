import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { E164 } from '@core/components';
import { deepFreeze } from '@core/testing';
import { PhoneSystem } from './phone.system';
import { SearchFieldsSystem } from './search-fields.system';

/*
 * The search-prefix cases of the two hand-kept copies, COPIED and
 * re-targeted to the one system both now call:
 * libs/infrastructure/firestore/src/lib/profile.adapter.spec.ts (`saveProfile`
 * rebuilds the keys from the edited name and the STORED contact channels)
 * and apps/functions/src/adapters/firestore-user-repository.spec.ts (the
 * registered document's denormalized search fields). The adapter specs ran
 * against the shimmed adapters until their flips deleted them.
 */

describe('SearchFieldsSystem.fromForms (profile.adapter.spec.ts › saveProfile)', () => {
  it('updates only the owner-editable keys — the search name is the edited full name, lower-cased', () => {
    expect(
      SearchFieldsSystem.fromForms(
        'Georgi Petrov',
        ['+359888123456', '088 812 3456'],
        'ivan@example.com',
      ).searchName,
    ).toBe('georgi petrov');
  });

  it('rebuilds the search keys from the edited name and the STORED contact channels', () => {
    // A local part too short to index, so every "ivan" left would be the
    // old name's.
    const { searchPrefixes } = SearchFieldsSystem.fromForms(
      'Georgi Petrov',
      ['+359888123456', '0888 123 456'],
      'ip@abv.bg',
    );
    expect(searchPrefixes).toEqual(
      expect.arrayContaining([
        'g',
        'georgi',
        'petrov',
        // The stored number in both forms, from the 3rd digit…
        '359888123456',
        '0888123456',
        // …and the stored e-mail.
        'ip@',
        'ip@abv.bg',
      ]),
    );
    // The caller's number and e-mail are not the forms handed in, so they
    // are not indexed either.
    expect(searchPrefixes).not.toContain('359877000111');
    expect(searchPrefixes).not.toContain('someone-else');
    // The old first name is gone from the index.
    expect(searchPrefixes).not.toContain('ivan');
  });
});

describe('SearchFieldsSystem.fromForms (firestore-user-repository.spec.ts › saveRegistered)', () => {
  it('persists a registered user in the accounts-adapter document shape — the denormalized search fields', () => {
    const fields = SearchFieldsSystem.fromForms(
      'Ada Lovelace',
      ['+14155552671', '(415) 555-2671'],
      'client@example.com',
    );
    expect(fields.searchName).toBe('ada lovelace');
    expect(fields.searchPrefixes).toEqual(
      expect.arrayContaining([
        'a',
        'ad',
        'ada',
        'l',
        'lo',
        'lov',
        'love',
        'lovel',
        'lovela',
        'lovelac',
        'lovelace',
      ]),
    );
  });
});

describe('SearchFieldsSystem.fromForms — the exact array', () => {
  it('lists name prefixes, then phone digits, then the e-mail and its local part — each once, first seen first', () => {
    expect(
      SearchFieldsSystem.fromForms('  Ana  Ana ', ['+3598812'], 'An@X.bg')
        .searchPrefixes,
    ).toEqual([
      'a',
      'an',
      'ana',
      '359',
      '3598',
      '35988',
      '359881',
      '3598812',
      'an@',
      'an@x',
      'an@x.',
      'an@x.b',
      'an@x.bg',
    ]);
  });

  it('indexes nothing but the name without contact channels, and nothing at all for a blank name', () => {
    expect(SearchFieldsSystem.fromForms('Bo', [], null)).toEqual({
      searchName: 'bo',
      searchPrefixes: ['b', 'bo'],
    });
    expect(SearchFieldsSystem.fromForms('   ', [], null)).toEqual({
      searchName: '',
      searchPrefixes: [],
    });
  });
});

describe('SearchFieldsSystem.searchFields — one implementation for web, functions and seed', () => {
  it('indexes the E.164 in both forms — the national one as PhoneSystem formats it', () => {
    const phone = E164.of('+359888123456');
    const fields = SearchFieldsSystem.searchFields(
      'Ivan',
      'Petrov',
      phone,
      'ivan@example.com',
    );
    expect(fields).toEqual(
      SearchFieldsSystem.fromForms(
        'Ivan Petrov',
        [phone, PhoneSystem.formatNational(phone)],
        'ivan@example.com',
      ),
    );
    expect(fields.searchPrefixes).toContain('0888123456');
    expect(fields.searchPrefixes).toContain('359888123456');
  });

  it('a provisioned stub with no names and no phone indexes only the e-mail', () => {
    expect(
      SearchFieldsSystem.searchFields(null, null, null, 'ab@cd.ef'),
    ).toEqual({
      searchName: '',
      searchPrefixes: ['ab@', 'ab@c', 'ab@cd', 'ab@cd.', 'ab@cd.e', 'ab@cd.ef'],
    });
  });
});

describe('SearchFieldsSystem — the query side (user-search.port.ts)', () => {
  it('turns a phone-shaped query into its digits, dropping an international 00', () => {
    expect(SearchFieldsSystem.normalizeQuery(' +359 88 812-3456 ')).toBe(
      '359888123456',
    );
    expect(SearchFieldsSystem.normalizeQuery('00359 888')).toBe('359888');
    expect(SearchFieldsSystem.normalizeQuery('088 (812) 34')).toBe('08881234');
    // A number must START like one: a leading bracket reads as text.
    expect(SearchFieldsSystem.normalizeQuery('(088) 812')).toBe('(088) 812');
  });

  it('lower-cases and trims anything else', () => {
    expect(SearchFieldsSystem.normalizeQuery('  Ivan P ')).toBe('ivan p');
    expect(SearchFieldsSystem.normalizeQuery('A@B.bg')).toBe('a@b.bg');
  });

  it('reads a query as a phone number only with the shape and five digits', () => {
    expect(SearchFieldsSystem.looksLikePhone('+359 88')).toBe(true);
    expect(SearchFieldsSystem.looksLikePhone('0888')).toBe(false);
    expect(SearchFieldsSystem.looksLikePhone('ivan 08881')).toBe(false);
  });

  it('a normalized query finds the prefix the index holds', () => {
    const { searchPrefixes } = SearchFieldsSystem.searchFields(
      'Ivan',
      'Petrov',
      E164.of('+359888123456'),
      null,
    );
    expect(searchPrefixes).toContain(
      SearchFieldsSystem.normalizeQuery('0888 12'),
    );
    expect(searchPrefixes).toContain(SearchFieldsSystem.normalizeQuery('PET'));
  });
});

describe('SearchFieldsSystem properties', () => {
  const word = fc.stringMatching(/^[a-zA-Z]{1,8}$/);

  it('every prefix of every name token is indexed, each exactly once', () => {
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 4 }), (tokens) => {
        const { searchName, searchPrefixes } = SearchFieldsSystem.fromForms(
          tokens.join(' '),
          [],
          null,
        );
        expect(searchName).toBe(tokens.join(' ').toLowerCase());
        expect(new Set(searchPrefixes).size).toBe(searchPrefixes.length);
        for (const token of tokens) {
          const lower = token.toLowerCase();
          for (let i = 1; i <= lower.length; i++) {
            expect(searchPrefixes).toContain(lower.slice(0, i));
          }
        }
      }),
    );
  });

  it('contact prefixes start at the third character', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\+\d{4,12}$/), (phone) => {
        const { searchPrefixes } = SearchFieldsSystem.fromForms(
          '',
          [phone],
          null,
        );
        const digits = phone.slice(1);
        expect(searchPrefixes).toEqual(
          Array.from({ length: digits.length - 2 }, (_, i) =>
            digits.slice(0, i + 3),
          ),
        );
      }),
    );
  });
});

describe('SearchFieldsSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const forms = deepFreeze(['+359888123456', '0888 123 456']);
    const run = () =>
      SearchFieldsSystem.fromForms('Ivan Petrov', forms, 'i@x.bg');
    expect(run()).toEqual(run());
    expect(forms).toEqual(['+359888123456', '0888 123 456']);
  });
});
