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
 *
 * Pass C (S-17): the staff dashboard's book search thresholds and digit
 * rule (`staff-dashboard.ts` `searchResults` / `matches`, the template's
 * `term().trim().length >= 2`), as values — staff-dashboard.spec.ts :3480
 * («георги» searched; the text match stays the page's) and :3504
 * («359881234567» finds «+359 88 123 4567» across the formatter's spaces).
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

describe('SearchFieldsSystem — the book search (staff-dashboard.ts searchResults)', () => {
  it('searches a term from two characters on', () => {
    expect(SearchFieldsSystem.TERM_MIN).toBe(2);
    expect(SearchFieldsSystem.termSearchable('')).toBe(false);
    expect(SearchFieldsSystem.termSearchable('г')).toBe(false);
    expect(SearchFieldsSystem.termSearchable('ге')).toBe(true);
    expect(SearchFieldsSystem.termSearchable('георги')).toBe(true);
  });

  it('measures the operand it is handed, never re-trimming it', () => {
    // The template hands the trimmed text; a padded term is the caller's to trim.
    expect(SearchFieldsSystem.termSearchable(' г')).toBe(true);
    expect(SearchFieldsSystem.termSearchable(' г'.trim())).toBe(false);
  });

  it('reads four or more digits as a phone’s bare run, three or fewer as none', () => {
    expect(SearchFieldsSystem.DIGIT_QUERY_MIN).toBe(4);
    expect(SearchFieldsSystem.digitQuery('359881234567')).toBe('359881234567');
    expect(SearchFieldsSystem.digitQuery('8812')).toBe('8812');
    expect(SearchFieldsSystem.digitQuery('881')).toBeNull();
    expect(SearchFieldsSystem.digitQuery('георги')).toBeNull();
    expect(SearchFieldsSystem.digitQuery('')).toBeNull();
  });

  it('drops separators and letters from the typed term — the digits alone count', () => {
    expect(SearchFieldsSystem.digitQuery('+359 88 123')).toBe('35988123');
    expect(SearchFieldsSystem.digitQuery('88-1')).toBeNull();
    expect(SearchFieldsSystem.digitQuery('иван 0881')).toBe('0881');
    expect(SearchFieldsSystem.digitQuery('(088) 1')).toBe('0881');
  });

  it("finds a phone by its bare digits across the formatter's spaces", () => {
    const digits = SearchFieldsSystem.digitQuery('359881234567') as string;
    expect(SearchFieldsSystem.digitsMatch('+359 88 123 4567', digits)).toBe(
      true,
    );
    expect(
      SearchFieldsSystem.digitsMatch('+359 88 777 8899', '887778899'),
    ).toBe(true);
    expect(SearchFieldsSystem.digitsMatch('+359 88 777 8899', '8877799')).toBe(
      false,
    );
    expect(SearchFieldsSystem.digitsMatch('Георги Петров', '8877')).toBe(false);
  });

  it('a digit query always matches the field it was typed from (property)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\+?[\d ()-]{0,16}$/), (typed) => {
        const digits = SearchFieldsSystem.digitQuery(typed);
        const bare = typed.replace(/\D/g, '');
        expect(digits).toBe(bare.length >= 4 ? bare : null);
        if (digits !== null) {
          expect(SearchFieldsSystem.digitsMatch(typed, digits)).toBe(true);
        }
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

  it('the book search is pure: same input → same output', () => {
    const term = '+359 88 777 8899';
    expect(SearchFieldsSystem.digitQuery(term)).toBe(
      SearchFieldsSystem.digitQuery(term),
    );
    expect(SearchFieldsSystem.digitsMatch(term, '8877')).toBe(
      SearchFieldsSystem.digitsMatch(term, '8877'),
    );
    expect(SearchFieldsSystem.termSearchable(term)).toBe(
      SearchFieldsSystem.termSearchable(term),
    );
    expect(term).toBe('+359 88 777 8899');
  });
});
