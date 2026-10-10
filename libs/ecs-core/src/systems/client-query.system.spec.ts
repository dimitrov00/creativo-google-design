import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../testing';
import {
  ClientQuerySystem,
  type ParsedClientQuery,
  type RankableClient,
} from './client-query.system';

/*
 * Every case of libs/features/staff/dashboard/src/lib/visit-editor/
 * client-query.spec.ts (17), COPIED and re-targeted: the legacy free
 * functions are thin local adapters over `ClientQuerySystem` (the calling
 * code passed explicitly, the ranked indexes mapped back onto the pool), so
 * the arrange/assert bodies are the legacy ones. Plus the purity case and
 * properties of the ranking.
 */

const S = ClientQuerySystem;
const CC = S.DEFAULT_CALLING_CODE;

const parseClientQuery = (raw: string): ParsedClientQuery => S.parse(raw);
const clientLookupKeys = (parsed: ParsedClientQuery) =>
  S.lookupKeys(parsed, CC);
const phoneLookupVariants = (parsed: ParsedClientQuery) =>
  S.phoneLookupVariants(parsed, CC);
function rankClients<T extends RankableClient>(
  clients: readonly T[],
  parsed: ParsedClientQuery,
): readonly { readonly client: T; readonly exact: boolean }[] {
  return S.rank(clients, parsed, CC).map((hit) => ({
    client: clients[hit.index] as T,
    exact: hit.exact,
  }));
}
const nameSegments = S.nameSegments;
const emailSegments = S.emailSegments;
const phoneSegments = (formatted: string, parsed: ParsedClientQuery) =>
  S.phoneSegments(formatted, parsed, CC);

const MARTIN = {
  label: 'Мартин Илиев',
  phone: '+359 88 765 4321',
  email: 'martin@test.local',
};
const ANNA = {
  label: 'Анна Костова',
  phone: '+359 88 500 0000',
  email: 'anna.k@mail.bg',
};
const MARIA = { label: 'Мария Мартинова', phone: null, email: null };
const PEOPLE = [ANNA, MARIA, MARTIN];

describe('parseClientQuery', () => {
  it('reads nothing as empty', () => {
    expect(parseClientQuery('   ').kind).toBe('empty');
  });

  it('reads words as a name, lowercased for matching and kept as typed for the form', () => {
    const parsed = parseClientQuery('  Мария  Иванова ');
    expect(parsed.kind).toBe('name');
    expect(parsed.name).toBe('Мария Иванова');
    expect(parsed.nameTokens).toEqual(['мария', 'иванова']);
  });

  it('reads a number however it is dialled, spaced or punctuated', () => {
    for (const [typed, digits, international] of [
      ['088 765 4321', '0887654321', false],
      ['+359 (88) 765-43-21', '359887654321', true],
      ['00359887654321', '359887654321', true],
      ['887654321', '887654321', false],
    ] as const) {
      const parsed = parseClientQuery(typed);
      expect(parsed.kind, typed).toBe('phone');
      expect(parsed.phoneDigits, typed).toBe(digits);
      expect(parsed.phoneInternational, typed).toBe(international);
    }
  });

  it('reads a mail, or the beginning of one, lowercased', () => {
    expect(parseClientQuery('Maria@Mail.BG').email).toBe('maria@mail.bg');
    expect(parseClientQuery('maria@').kind).toBe('email');
  });

  it('finds every part of a pasted line at once, the mail leading', () => {
    const parsed = parseClientQuery(
      'Мария Иванова 088 765 4321 <maria@mail.bg>,',
    );
    expect(parsed.kind).toBe('email');
    expect(parsed.name).toBe('Мария Иванова');
    expect(parsed.phoneTyped).toBe('088 765 4321');
    expect(parsed.email).toBe('maria@mail.bg');
  });

  it('keeps a stray figure in the name — «Мария 2» is not a number', () => {
    const parsed = parseClientQuery('Мария 2');
    expect(parsed.kind).toBe('name');
    expect(parsed.name).toBe('Мария 2');
    expect(parsed.phoneDigits).toBe('');
  });
});

describe('clientLookupKeys', () => {
  it('asks by the mail first, then the number in its forms, then the longest word', () => {
    expect(
      clientLookupKeys(parseClientQuery('Мария maria@mail.bg 0887')),
    ).toEqual(['maria@mail.bg']);
    expect(clientLookupKeys(parseClientQuery('Мария 088 765'))).toEqual([
      '088765',
      '35988765',
    ]);
    expect(clientLookupKeys(parseClientQuery('Ив Мартинова'))).toEqual([
      'мартинова',
    ]);
  });

  it('dials a bare number every way the index holds it', () => {
    expect(phoneLookupVariants(parseClientQuery('887654321'))).toEqual([
      '887654321',
      '0887654321',
      '359887654321',
    ]);
    expect(phoneLookupVariants(parseClientQuery('+359 88 765'))).toEqual([
      '35988765',
      '088765',
    ]);
    expect(phoneLookupVariants(parseClientQuery('359887'))).toEqual([
      '359887',
      '0887',
    ]);
  });

  it('asks nothing of one letter, two digits or a bare @', () => {
    expect(clientLookupKeys(parseClientQuery('м'))).toEqual([]);
    expect(clientLookupKeys(parseClientQuery('08'))).toEqual([]);
    expect(clientLookupKeys(parseClientQuery('@mail'))).toEqual([]);
  });
});

describe('rankClients', () => {
  const labels = (query: string) =>
    rankClients(PEOPLE, parseClientQuery(query)).map(
      (ranked) => ranked.client.label,
    );

  it("keeps the owner's order while nothing is typed", () => {
    expect(labels('')).toEqual([
      'Анна Костова',
      'Мария Мартинова',
      'Мартин Илиев',
    ]);
  });

  it("matches every typed word against the beginnings of a name's words, first-name matches first", () => {
    expect(labels('март')).toEqual(['Мартин Илиев', 'Мария Мартинова']);
    expect(labels('мартин ил')).toEqual(['Мартин Илиев']);
    expect(labels('ил март')).toEqual(['Мартин Илиев']);
    expect(labels('петър')).toEqual([]);
  });

  it('matches a number by its beginning in any form, and says when it is exactly theirs', () => {
    expect(labels('088 765')).toEqual(['Мартин Илиев']);
    expect(labels('885')).toEqual(['Анна Костова']);
    const exact = rankClients(PEOPLE, parseClientQuery('0887654321'));
    expect(exact).toEqual([{ client: MARTIN, exact: true }]);
    expect(rankClients(PEOPLE, parseClientQuery('088765'))[0]?.exact).toBe(
      false,
    );
  });

  it("leads with the number and only ranks by the name beside it — a number that is somebody else's still shows", () => {
    expect(labels('Петър 0887654321')).toEqual(['Мартин Илиев']);
  });

  it('matches a mail by its beginning, its local part, or a fragment', () => {
    expect(labels('martin@')).toEqual(['Мартин Илиев']);
    expect(labels('anna.k@mail.bg')).toEqual(['Анна Костова']);
    expect(
      rankClients(PEOPLE, parseClientQuery('anna.k@mail.bg'))[0]?.exact,
    ).toBe(true);
  });
});

describe('segments', () => {
  it('marks the typed beginning of each matched word of a name', () => {
    expect(nameSegments('Мартин Илиев', parseClientQuery('ил март'))).toEqual([
      { text: 'Март', hit: true },
      { text: 'ин', hit: false },
      { text: ' ', hit: false },
      { text: 'Ил', hit: true },
      { text: 'иев', hit: false },
    ]);
    expect(nameSegments('Анна', parseClientQuery(''))).toEqual([
      { text: 'Анна', hit: false },
    ]);
  });

  it('marks the typed run of a printed number, spacing kept, however it was dialled', () => {
    expect(
      phoneSegments('+359 88 765 4321', parseClientQuery('088 765')),
    ).toEqual([
      { text: '+', hit: false },
      { text: '359 88 765', hit: true },
      { text: ' 4321', hit: false },
    ]);
    expect(phoneSegments('+359 88 765 4321', parseClientQuery('7654'))).toEqual(
      [
        { text: '+359 88 ', hit: false },
        { text: '765 4', hit: true },
        { text: '321', hit: false },
      ],
    );
  });

  it('marks the typed fragment of a mail', () => {
    expect(
      emailSegments('martin@test.local', parseClientQuery('MARTIN@')),
    ).toEqual([
      { text: 'martin@', hit: true },
      { text: 'test.local', hit: false },
    ]);
  });
});

describe('ClientQuerySystem — the ranking as a whole', () => {
  it('answers indexes into the pool, each once, every one a lead hit (property)', () => {
    const client = fc.record({
      label: fc.constantFrom(
        'Мартин Илиев',
        'Анна Костова',
        'Мария Мартинова',
        'Ив',
      ),
      phone: fc.constantFrom(null, '+359 88 765 4321', '+359 88 500 0000'),
      email: fc.constantFrom(null, 'martin@test.local', 'anna.k@mail.bg'),
    });
    fc.assert(
      fc.property(
        fc.array(client, { maxLength: 8 }),
        fc.constantFrom(
          '',
          'март',
          '088 765',
          'anna@',
          'Петър 0887654321',
          'ил март',
        ),
        (pool, typed) => {
          const hits = S.rank(pool, S.parse(typed), CC);
          const indexes = hits.map((hit) => hit.index);
          expect(new Set(indexes).size).toBe(indexes.length);
          for (const index of indexes) {
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(pool.length);
          }
          if (typed === '') expect(indexes).toEqual(pool.map((_, i) => i));
        },
      ),
    );
  });

  it('never asks for a one-letter word, nor a number variant under three digits (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), (typed) => {
        for (const key of S.lookupKeys(S.parse(typed), CC)) {
          expect(key.length).toBeGreaterThanOrEqual(2);
        }
        for (const variant of S.phoneLookupVariants(S.parse(typed), CC)) {
          expect(variant.length).toBeGreaterThanOrEqual(3);
        }
      }),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const pool = deepFreeze(PEOPLE.map((person) => ({ ...person })));
    const parsed = deepFreeze(
      S.parse('Мария Иванова 088 765 4321 <maria@mail.bg>,'),
    );
    const once = S.rank(pool, parsed, CC);
    const twice = S.rank(pool, parsed, CC);
    expect(twice).toEqual(once);
    expect(S.lookupKeys(parsed, CC)).toEqual(S.lookupKeys(parsed, CC));
    expect(S.nameSegments('Мартин Илиев', parsed)).toEqual(
      S.nameSegments('Мартин Илиев', parsed),
    );
    expect(pool).toEqual(PEOPLE);
  });
});
