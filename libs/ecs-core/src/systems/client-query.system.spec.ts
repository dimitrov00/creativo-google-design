import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SeatOccupant, SeatLabel, SubjectRelationship } from '@core/components';
import { AppointmentId, SeatId, UserId } from '@core/primitives';
import {
  appointmentFixture,
  customerOf,
  deepFreeze,
  seatFixture,
  utcMs,
} from '@core/testing';
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
 * properties of the ranking. Flatten pass: the leading part is the field
 * `clientQueryShape` (N15), its values SCREAMING (`'name'` → `'NAME'`).
 *
 * Pass C (S-20, E-21): the add-client page's account lists — the staff
 * dashboard's `browseClients` (staff-dashboard.spec.ts :4561, the window's
 * one recent visitor; :4739, the book by the booking's contact) as picks —
 * with DEP-5's booker identity (a party whose first account seat is a
 * companion files the BOOKER, never the companion under the booker's
 * contact); and the new-client form's phone prefill threshold
 * (staff-visit-editor.ts `openNewClient`; staff-visit-editor.spec.ts
 * :3507, :5812).
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
    expect(parseClientQuery('   ').clientQueryShape).toBe('EMPTY');
  });

  it('reads words as a name, lowercased for matching and kept as typed for the form', () => {
    const parsed = parseClientQuery('  Мария  Иванова ');
    expect(parsed.clientQueryShape).toBe('NAME');
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
      expect(parsed.clientQueryShape, typed).toBe('PHONE');
      expect(parsed.phoneDigits, typed).toBe(digits);
      expect(parsed.phoneInternational, typed).toBe(international);
    }
  });

  it('reads a mail, or the beginning of one, lowercased', () => {
    expect(parseClientQuery('Maria@Mail.BG').email).toBe('maria@mail.bg');
    expect(parseClientQuery('maria@').clientQueryShape).toBe('EMAIL');
  });

  it('finds every part of a pasted line at once, the mail leading', () => {
    const parsed = parseClientQuery(
      'Мария Иванова 088 765 4321 <maria@mail.bg>,',
    );
    expect(parsed.clientQueryShape).toBe('EMAIL');
    expect(parsed.name).toBe('Мария Иванова');
    expect(parsed.phoneTyped).toBe('088 765 4321');
    expect(parsed.email).toBe('maria@mail.bg');
  });

  it('keeps a stray figure in the name — «Мария 2» is not a number', () => {
    const parsed = parseClientQuery('Мария 2');
    expect(parsed.clientQueryShape).toBe('NAME');
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

/* ── Pass C: the new-client prefill and the account lists ─────────────── */

describe('ClientQuerySystem.prefillsPhone — the new-client form’s number', () => {
  it('prefills from five typed digits on, never four', () => {
    expect(S.PREFILL_PHONE_DIGITS).toBe(5);
    expect(S.prefillsPhone(S.parse('0887'))).toBe(false);
    expect(S.prefillsPhone(S.parse('08876'))).toBe(true);
    expect(S.prefillsPhone(S.parse('Мария 088 765 4321 maria@mail.bg'))).toBe(
      true,
    );
  });

  it('counts the digits the parse kept — a name with a figure has none', () => {
    // «Мария 2» is a name with a figure in it, not a number.
    expect(S.prefillsPhone(S.parse('Мария 2'))).toBe(false);
    // An international `00` is dropped before counting: 0035 is two digits.
    expect(S.prefillsPhone(S.parse('00359'))).toBe(false);
    expect(S.prefillsPhone(S.parse('003598'))).toBe(false);
    expect(S.prefillsPhone(S.parse('0035988'))).toBe(true);
  });
});

const IVAN = UserId.of('u-ivan');
const PETAR = UserId.of('u-petar');
const SON = UserId.of('u-son');

/** A visit booked by `owner` (its SELF seat), with the booker's contact. */
function visitOf(
  id: string,
  owner: UserId | null,
  contactName: string | null,
  occupants: readonly SeatOccupant[] = owner === null
    ? []
    : [
        SeatOccupant.account(
          owner,
          customerOf(owner),
          SubjectRelationship.Self,
        ),
      ],
) {
  return appointmentFixture({
    id: AppointmentId.of(id),
    ownerUserId: owner,
    contactName,
    seats: occupants.map((occupant, index) =>
      seatFixture({ seatId: SeatId.of(`${id}-s${index}`), occupant }),
    ),
  });
}

const guest = (label: string): SeatOccupant =>
  SeatOccupant.anonymous(SeatLabel.of(label));
const companion = (userId: UserId): SeatOccupant =>
  SeatOccupant.account(
    userId,
    customerOf(userId),
    SubjectRelationship.Companion,
  );
const self = (userId: UserId): SeatOccupant =>
  SeatOccupant.account(userId, customerOf(userId), SubjectRelationship.Self);

describe('ClientQuerySystem.recentAccounts — «Скорошни»', () => {
  it('reads the one recent visitor off the window, with the visit it came from', () => {
    const visit = visitOf('a1', IVAN, 'Георги Петров');
    const picks = S.recentAccounts([visit], 8);
    expect(picks).toEqual([{ userId: IVAN, visit }]);
    expect(picks[0]?.visit.contactName).toBe('Георги Петров');
  });

  it('keeps the order handed in, each account once — its first visit in that order', () => {
    const newest = visitOf('a3', PETAR, 'Петър');
    const middle = visitOf('a2', IVAN, 'Иван (нов номер)');
    const oldest = visitOf('a1', IVAN, 'Иван');
    const picks = S.recentAccounts([newest, middle, oldest], 8);
    expect(picks.map((pick) => pick.userId)).toEqual([PETAR, IVAN]);
    expect(picks[1]?.visit).toBe(middle);
    // The caller's order is the order: handed oldest first, read oldest first.
    expect(
      S.recentAccounts([oldest, middle, newest], 8).map((pick) => pick.visit),
    ).toEqual([oldest, newest]);
  });

  it('stops at the cap', () => {
    const visits = Array.from({ length: 12 }, (_, index) =>
      visitOf(`a${index}`, UserId.of(`u-${index}`), `Клиент ${index}`),
    );
    const picks = S.recentAccounts(visits, 8);
    expect(picks).toHaveLength(8);
    expect(picks.map((pick) => pick.userId)).toEqual(
      visits.slice(0, 8).map((visit) => visit.ownerUserId),
    );
    expect(S.recentAccounts(visits, 0)).toEqual([]);
  });

  it('lists a visit with no name all the same — the page words it «unnamed»', () => {
    const visit = visitOf('a1', IVAN, null);
    expect(S.recentAccounts([visit], 8)).toEqual([{ userId: IVAN, visit }]);
  });

  it('skips a visit of guests only — nobody to add', () => {
    const walkIn = visitOf('a1', null, 'Случаен клиент', [guest('Случаен')]);
    expect(S.recentAccounts([walkIn], 8)).toEqual([]);
  });

  it('files a companion-first party under its BOOKER, never the companion (DEP-5)', () => {
    // The father booked his son's cut and his own; the son's seat comes first.
    const party = visitOf('a1', IVAN, 'Иван Баща', [
      companion(SON),
      self(IVAN),
    ]);
    expect(S.recentAccounts([party], 8)).toEqual([
      { userId: IVAN, visit: party },
    ]);
  });

  it('reads the SELF account seat when the owner mirror is empty, and nobody from companions alone', () => {
    const unmirrored = visitOf('a1', null, 'Иван', [
      companion(SON),
      self(IVAN),
    ]);
    expect(S.recentAccounts([unmirrored], 8)).toEqual([
      { userId: IVAN, visit: unmirrored },
    ]);
    const companionsOnly = visitOf('a2', null, 'Иван', [companion(SON)]);
    expect(S.recentAccounts([companionsOnly], 8)).toEqual([]);
  });
});

describe('ClientQuerySystem.bookAccounts — the omnibox’s local book', () => {
  it('hands the window’s one visitor by the contact the booking was made with', () => {
    const visit = visitOf('a1', IVAN, 'Георги Петров');
    expect(S.bookAccounts([visit])).toEqual([
      { userId: IVAN, visit, contactName: 'Георги Петров' },
    ]);
  });

  it('keeps the order handed in at one instant, each NAMED account once — a nameless visit gives way to an older named one', () => {
    const nameless = visitOf('a3', IVAN, null);
    const renamed = visitOf('a2', IVAN, 'Иван (нов номер)');
    const first = visitOf('a1', IVAN, 'Иван');
    const petar = visitOf('a0', PETAR, 'Петър');
    expect(S.bookAccounts([nameless, renamed, first, petar])).toEqual([
      { userId: IVAN, visit: renamed, contactName: 'Иван (нов номер)' },
      { userId: PETAR, visit: petar, contactName: 'Петър' },
    ]);
  });

  it('orders the visits newest contact first itself — a shuffled window still files each account by its newest named visit', () => {
    const at = <V extends object>(visit: V, iso: string) => ({
      ...visit,
      utcEpochMs: utcMs(iso),
    });
    const nameless = at(visitOf('a3', IVAN, null), '2026-10-09T10:00:00Z');
    const renamed = at(
      visitOf('a2', IVAN, 'Иван (нов номер)'),
      '2026-10-08T10:00:00Z',
    );
    const first = at(visitOf('a1', IVAN, 'Иван'), '2026-10-01T10:00:00Z');
    const petar = at(visitOf('a0', PETAR, 'Петър'), '2026-09-30T10:00:00Z');
    expect(S.bookAccounts([first, petar, nameless, renamed])).toEqual([
      { userId: IVAN, visit: renamed, contactName: 'Иван (нов номер)' },
      { userId: PETAR, visit: petar, contactName: 'Петър' },
    ]);
    expect(S.bookAccounts([petar, first, renamed, nameless])).toEqual([
      { userId: IVAN, visit: renamed, contactName: 'Иван (нов номер)' },
      { userId: PETAR, visit: petar, contactName: 'Петър' },
    ]);
  });

  it('keeps the order handed in for visits at the same instant', () => {
    const when = '2026-10-08T10:00:00Z';
    const older = { ...visitOf('a1', IVAN, 'Иван'), utcEpochMs: utcMs(when) };
    const newer = {
      ...visitOf('a2', IVAN, 'Иван (нов номер)'),
      utcEpochMs: utcMs(when),
    };
    expect(S.bookAccounts([newer, older])).toEqual([
      { userId: IVAN, visit: newer, contactName: 'Иван (нов номер)' },
    ]);
    expect(S.bookAccounts([older, newer])).toEqual([
      { userId: IVAN, visit: older, contactName: 'Иван' },
    ]);
  });

  it('files the booker of a companion-first party, and skips guests (DEP-5)', () => {
    const party = visitOf('a1', IVAN, 'Иван Баща', [
      companion(SON),
      self(IVAN),
    ]);
    const walkIn = visitOf('a2', null, 'Случаен', [guest('Случаен')]);
    expect(S.bookAccounts([walkIn, party])).toEqual([
      { userId: IVAN, visit: party, contactName: 'Иван Баща' },
    ]);
  });
});

describe('ClientQuerySystem — pass C purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const visits = deepFreeze([
      visitOf('a2', PETAR, 'Петър'),
      visitOf('a1', IVAN, 'Иван', [companion(SON), self(IVAN)]),
    ]);
    const snapshot = structuredClone(visits);
    expect(S.recentAccounts(visits, 8)).toEqual(S.recentAccounts(visits, 8));
    expect(S.bookAccounts(visits)).toEqual(S.bookAccounts(visits));
    expect(visits).toEqual(snapshot);
    const parsed = deepFreeze(S.parse('088 765 4321'));
    expect(S.prefillsPhone(parsed)).toBe(S.prefillsPhone(parsed));
  });
});
