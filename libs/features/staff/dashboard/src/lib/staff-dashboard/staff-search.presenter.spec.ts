import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BookingContact,
  Seat,
  E164,
  Email,
  SearchFilter,
  SearchFilterField,
  SearchQuery,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  BarberId,
  BookingStatus,
  LocalDate,
  ServiceId,
} from '@core/primitives';
import { SearchIndexSystem, ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  SEARCH_LABELS,
  appointmentFixture,
  deepFreeze,
  minute,
  searchWindowFixture,
  seatFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  visitWordsOf,
  type VisitLookup,
} from '@creativo/features/shared/visits';
import { VisitPerspective } from '@creativo/features/shared/visits';
import { type SearchSheetInput, searchSheetVm } from './staff-search.presenter';
import {
  CalendarMode,
  DropdownAction,
  DropdownMode,
  type SearchSheetVm,
  SearchSheetState,
} from './staff-search.vm';
import { staffSearchWordsOf } from './staff-search.words';

// The sheet is worded from the app's own catalogue, so a key the words name
// and the catalogue lacks fails here, not on a screen.
type Catalogue = Record<string, unknown>;
function catalogue(lang: 'bg' | 'en'): Catalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Catalogue;
}
function translator(tree: Catalogue) {
  return (
    key: string,
    params: Readonly<Record<string, string | number>> = {},
  ) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? new Map(Object.entries(node)).get(part)
            : undefined,
        tree,
      );
    if (typeof value !== 'string') throw new Error(`missing word ${key}`);
    const filled = new Map(Object.entries(params));
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(filled.get(name) ?? ''),
    );
  };
}

const IVAN = BarberId.of('b-ivan');
const NIKO = BarberId.of('b-niko');
const FADE = ServiceId.of('svc-fade');
const CUT = ServiceId.of('svc-classic-cut');

const LOOKUP: VisitLookup = {
  serviceName: (id) =>
    id === FADE ? 'Фейд' : id === CUT ? 'Класическо' : null,
  barberName: (id) => (id === IVAN ? 'Иван' : id === NIKO ? 'Нико' : null),
  barberAvatarSrc: () => null,
  locationName: () => null,
  locationCount: 1,
};

const day = (offset: number): LocalDate =>
  LocalDate.addDays(FIXTURE_TODAY, offset);

function visit(
  id: string,
  offset: number,
  overrides: Parameters<typeof appointmentFixture>[0] = {},
  barber = IVAN,
  service = CUT,
): Appointment {
  return appointmentFixture({
    ...BookingContact.NONE,
    id: id as Appointment['id'],
    localDate: day(offset),
    startMinutes: minute(600),
    barberIds: [barber],
    seats: [seatFixture({ barberId: barber, serviceId: service })],
    contactName: 'Иван Петров',
    ...overrides,
  });
}

const POOL: readonly Appointment[] = [
  visit('today', 0, { contactPhone: unwrapOk(E164.parse('+359887778899')) }),
  visit('tomorrow', 1, { contactName: 'Георги Иванов' }, NIKO, FADE),
  visit('later', 5, {
    contactName: 'Мартин',
    contactEmail: Email.of('иван.м@mail.bg'),
    contactNote: 'Иван го води',
  }),
  visit('gone', -3, { contactName: 'Кирил' }),
  visit('cancelled', 2, {
    contactName: 'Стоян',
    lifecycle: undefined,
  }),
];

const LABELS = SEARCH_LABELS;
const INDEX = SearchIndexSystem.build(POOL, {
  ...LABELS,
  clientNames: (v) => (v.contactName === null ? [] : [v.contactName]),
  serviceName: LOOKUP.serviceName.bind(LOOKUP),
  barberName: LOOKUP.barberName.bind(LOOKUP),
});

function input(
  lang: 'bg' | 'en',
  query: SearchQuery,
  overrides: Partial<SearchSheetInput> = {},
): SearchSheetInput {
  const translate = translator(catalogue(lang));
  return {
    query,
    pool: POOL,
    index: INDEX,
    recents: [],
    shopNow: FIXTURE_NOW,
    timeZone: FIXTURE_TIME_ZONE,
    shopNowAt: () => FIXTURE_NOW,
    locale: lang === 'bg' ? 'bg-BG' : 'en-GB',
    callingCode: '359',
    lookup: LOOKUP,
    rowWords: visitWordsOf(translate, lang, VisitPerspective.Staff),
    words: staffSearchWordsOf(translate),
    clientNames: (v) => (v.contactName === null ? [] : [v.contactName]),
    unnamedClient: lang === 'bg' ? 'Клиент без име' : 'Unnamed client',
    capped: false,
    stale: false,
    openField: null,
    dropdownText: '',
    calendarMode: null,
    rangeStart: null,
    ...overrides,
  };
}

const text = (searchText: string) =>
  SearchQuery.withText(SearchQuery.empty(), searchText);
const rowIds = (vm: ReturnType<typeof searchSheetVm>) =>
  vm.groups.flatMap((group) => group.rows.map((row) => row.id as string));
const dropdownRows = (vm: SearchSheetVm) =>
  vm.dropdown.sections.flatMap((section) => section.rows);
const dropdownLabels = (vm: SearchSheetVm) =>
  dropdownRows(vm).map((row) => row.label);

describe('searchSheetVm — idle', () => {
  it('shows the recents and, in the dropdown, the keys a filter is made of — no cards', () => {
    const recents = [
      text('петър'),
      SearchQuery.withFilter(text('фейд'), SearchFilter.note()),
    ];
    const vm = searchSheetVm(input('bg', SearchQuery.empty(), { recents }));
    expect(vm.searchSheetState).toBe(SearchSheetState.Idle);
    expect(vm.groups).toEqual([]);
    expect(vm.recents.map((r) => r.label)).toEqual([
      'петър',
      'фейд · С бележка',
    ]);
    expect(vm.dropdown.dropdownMode).toBe(DropdownMode.Fields);
    expect(vm.dropdown.sections.map((s) => s.heading)).toEqual([
      'Филтрирай по',
    ]);
    expect(dropdownRows(vm).map((row) => [row.id, row.label])).toEqual([
      ['FIELD:WHEN', 'Кога'],
      ['FIELD:BARBER', 'Бръснар'],
      ['FIELD:SERVICE', 'Услуга'],
      ['FIELD:STATUS', 'Статус'],
      ['FIELD:NOTE', 'С бележка'],
    ]);
    // A note has no values: its key adds the filter itself.
    expect(dropdownRows(vm).at(-1)?.dropdownAction).toBe(
      DropdownAction.AddValue,
    );
    expect(dropdownRows(vm).at(-1)?.filter).toEqual(SearchFilter.note());
    expect(vm.placeholder).toBe('Име, телефон, имейл, услуга…');
  });

  it('says the same in English', () => {
    const vm = searchSheetVm(input('en', SearchQuery.empty()));
    expect(vm.dropdown.sections[0]?.heading).toBe('Filter by');
    expect(dropdownLabels(vm)).toEqual([
      'When',
      'Barber',
      'Service',
      'Status',
      'With a note',
    ]);
  });

  it('carries the recent’s query, so pressing it runs it as it was', () => {
    const saved = SearchQuery.withFilter(text('фейд'), SearchFilter.note());
    const vm = searchSheetVm(
      input('bg', SearchQuery.empty(), { recents: [saved] }),
    );
    expect(vm.recents[0]?.query).toBe(saved);
  });
});

describe('searchSheetVm — results', () => {
  it('files the cards under Today, Tomorrow, a weekday each and Earlier, in that order', () => {
    const vm = searchSheetVm(input('bg', text('и')));
    expect(vm.searchSheetState).toBe(SearchSheetState.Results);
    expect(vm.groups.map((g) => g.key)).toEqual([
      day(0),
      day(1),
      day(2),
      day(5),
      'past',
    ]);
    expect(vm.groups[0]?.label).toBe('Днес');
    expect(vm.groups[1]?.label).toBe('Утре');
    expect(vm.groups[2]?.label).toMatch(/\d/);
    expect(vm.groups[4]?.label).toBe('По-рано');
    expect(vm.groups[0]?.rows.map((r) => r.id)).toEqual(['today']);
    expect(vm.groups[4]?.rows.map((r) => r.id)).toEqual(['gone']);
  });

  it('words the headings in English', () => {
    const vm = searchSheetVm(input('en', text('и')));
    expect(
      vm.groups
        .map((g) => g.label)
        .filter((l) => ['Today', 'Tomorrow', 'Earlier'].includes(l)),
    ).toEqual(['Today', 'Tomorrow', 'Earlier']);
  });

  it('names the client on every card, marked where the typed word found them', () => {
    const vm = searchSheetVm(input('bg', text('иван')));
    const today = vm.groups[0]?.rows[0];
    const client = today?.lines.find(
      (l) => l.testId === 'staff-search-line-client',
    );
    expect(client?.text).toBe('Иван Петров');
    expect(client?.parts).toEqual([
      { text: 'Иван', hit: true },
      { text: ' Петров', hit: false },
    ]);
  });

  it('names the client even when only a filter was chosen (nothing typed)', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(
          SearchQuery.empty(),
          SearchFilter.barber([NIKO]),
        ),
      ),
    );
    expect(rowIds(vm)).toEqual(['tomorrow']);
    expect(
      vm.groups[0]?.rows[0]?.lines.find(
        (l) => l.testId === 'staff-search-line-client',
      )?.text,
    ).toBe('Георги Иванов');
  });

  it('adds a phone line, the matched digits washed through the spaces, when a number was typed', () => {
    const vm = searchSheetVm(input('bg', text('088 777')));
    expect(vm.phoneRow).toBe('Телефон +359 88 777');
    const phone = vm.groups[0]?.rows[0]?.lines.find(
      (l) => l.testId === 'staff-search-line-phone',
    );
    expect(phone?.text).toBe('+359 88 777 8899');
    expect(phone?.parts?.filter((p) => p.hit).map((p) => p.text)).toEqual([
      '359 88 777',
    ]);
  });

  it('reads the phone row in English', () => {
    expect(searchSheetVm(input('en', text('088 777'))).phoneRow).toBe(
      'Phone +359 88 777',
    );
  });

  it('reads a name beside a number as both: the word marks the name, the number the phone', () => {
    const vm = searchSheetVm(input('bg', text('Иван 088 777')));
    expect(rowIds(vm)).toEqual(['today']);
    const lines = vm.groups[0]?.rows[0]?.lines.map((l) => l.testId);
    expect(lines).toContain('staff-search-line-client');
    expect(lines).toContain('staff-search-line-phone');
  });

  it('shows an e-mail line and a note line only for a card that matched on them', () => {
    const vm = searchSheetVm(input('bg', text('иван')));
    const later = vm.groups
      .flatMap((g) => g.rows)
      .find((r) => r.id === 'later');
    const ids = later?.lines.map((l) => l.testId);
    expect(ids).toContain('staff-search-line-email');
    expect(ids).toContain('staff-search-line-note');
    const today = vm.groups
      .flatMap((g) => g.rows)
      .find((r) => r.id === 'today');
    expect(today?.lines.map((l) => l.testId)).not.toContain(
      'staff-search-line-email',
    );
  });

  it('marks a service name that matched in the title', () => {
    const vm = searchSheetVm(input('bg', text('фейд')));
    const row = vm.groups[0]?.rows[0];
    expect(row?.titleParts).toEqual([{ text: 'Фейд', hit: true }]);
  });

  it('keeps the glyph for what the text was taken for', () => {
    expect(searchSheetVm(input('bg', text('иван'))).glyph).toBe(
      'action.search',
    );
    expect(searchSheetVm(input('bg', text('088 777'))).glyph).toBe(
      'contact.phone',
    );
    expect(searchSheetVm(input('bg', text('ivan@'))).glyph).toBe(
      'contact.email',
    );
  });
});

describe('searchSheetVm — each visit on its own shop’s clock (DEP-6)', () => {
  // Sofia 09:00 is London 07:00. A London cut at 08:30 on ITS clock has not
  // begun there: it is not past, and it stands ahead of Sofia's 10:00 cut —
  // judged by the Sofia reading of its end it would be past, and last.
  const LONDON_ZONE = unwrapOk(ZonedTimeSystem.checkZone('Europe/London'));
  const londonNow = ZonedTimeSystem.shopNow(
    utcMs('2026-09-28T09:00:00+03:00'),
    LONDON_ZONE,
  );
  const seatAt = (start: number) =>
    seatFixture({ startMinutes: minute(start) });
  const at = (id: string, start: number) => {
    const seat = seatAt(start);
    return visit(id, 0, {
      seats: [seat],
      startMinutes: minute(start),
      endMinutes: Seat.endMinutes(seat),
      contactName: 'Мира',
    });
  };
  const pool = [at('sofia-visit', 600), at('london-visit', 510)];
  const clock = (v: Appointment) =>
    v.id === 'london-visit' ? londonNow : FIXTURE_NOW;

  it('orders the London cut ahead of the Sofia cut on their own clocks', () => {
    const vm = searchSheetVm(
      input('bg', text('мира'), {
        pool,
        index: SearchIndexSystem.build(pool, {
          ...SEARCH_LABELS,
          clientNames: (v) => (v.contactName === null ? [] : [v.contactName]),
        }),
        shopNowAt: clock,
      }),
    );
    expect(rowIds(vm)).toEqual(['london-visit', 'sofia-visit']);
  });

  it('would put it last on the Sofia reading — the clock is what orders it', () => {
    const vm = searchSheetVm(
      input('bg', text('мира'), {
        pool,
        index: SearchIndexSystem.build(pool, {
          ...SEARCH_LABELS,
          clientNames: (v) => (v.contactName === null ? [] : [v.contactName]),
        }),
        shopNowAt: () => FIXTURE_NOW,
      }),
    );
    expect(rowIds(vm)).toEqual(['sofia-visit', 'london-visit']);
  });
});

describe('searchSheetVm — tokens', () => {
  const withBarber = SearchQuery.withFilter(
    text('иван'),
    SearchFilter.barber([IVAN, NIKO]),
  );

  it('draws one key │ value token per held kind, faces leading a barber’s', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(withBarber, SearchFilter.when(day(0), day(6))),
      ),
    );
    expect(vm.tokens.map((t) => [t.id, t.key, t.value])).toEqual([
      ['BARBER', 'Бръснар', 'Иван, Нико'],
      ['WHEN', 'Кога', 'Тази седмица'],
    ]);
    expect(vm.tokens[0]?.faces).toEqual([
      { src: null, name: 'Иван' },
      { src: null, name: 'Нико' },
    ]);
    expect(vm.tokens[0]?.label).toBe('Бръснар: Иван, Нико. Промени филтъра');
    expect(vm.tokens[0]?.removeLabel).toBe('Махни филтъра Бръснар');
    expect(vm.placeholder).toBe('Търси…');
  });

  it('names two values and counts the rest', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(
          SearchQuery.empty(),
          SearchFilter.bookingStatuses([
            BookingStatus.Confirmed,
            BookingStatus.Cancelled,
            BookingStatus.Completed,
          ]),
        ),
      ),
    );
    expect(vm.tokens[0]?.value).toBe('Потвърдени, Отказани +1');
  });

  it('draws the token being built last, its value waiting on the placeholder, the text quiet', () => {
    const vm = searchSheetVm(
      input('bg', withBarber, { openField: SearchFilterField.Service }),
    );
    expect(vm.tokens.map((t) => [t.id, t.value])).toEqual([
      ['BARBER', 'Иван, Нико'],
      ['SERVICE', ''],
    ]);
    expect(vm.tokens[1]?.label).toBe('Услуга: избери стойност');
    expect(vm.tokenPlaceholder).toBe('избери…');
    expect(vm.placeholder).toBe('');
    expect(
      searchSheetVm(
        input('en', SearchQuery.empty(), { openField: SearchFilterField.When }),
      ).tokenPlaceholder,
    ).toBe('choose…');
  });

  it('stands the tokens in the order their filters were added', () => {
    const query = SearchQuery.withFilter(
      SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.note()),
      SearchFilter.barber([IVAN]),
    );
    expect(searchSheetVm(input('bg', query)).tokens.map((t) => t.id)).toEqual([
      SearchFilterField.Note,
      SearchFilterField.Barber,
    ]);
  });

  it('says Today for the span that is today, Yesterday for yesterday, and the dates for any other', () => {
    const one = (from: LocalDate, to: LocalDate, lang: 'bg' | 'en' = 'bg') =>
      searchSheetVm(
        input(
          lang,
          SearchQuery.withFilter(
            SearchQuery.empty(),
            SearchFilter.when(from, to),
          ),
        ),
      ).tokens[0]?.value;
    expect(one(day(0), day(0))).toBe('Днес');
    expect(one(day(-1), day(-1))).toBe('Вчера');
    expect(one(day(-6), day(0))).toBe('Последните 7 дни');
    expect(one(day(-9), day(-3), 'en')).toMatch(/–/);
  });
});

describe('searchSheetVm — the dropdown', () => {
  it('lists an open key’s values for a token being built, the typed text narrowing them', () => {
    const open = searchSheetVm(
      input('bg', SearchQuery.empty(), { openField: SearchFilterField.Barber }),
    );
    expect(open.dropdown.dropdownMode).toBe(DropdownMode.Values);
    expect(open.dropdown.sections.map((s) => s.heading)).toEqual(['Бръснар']);
    expect(dropdownRows(open).map((r) => [r.id, r.checked])).toEqual([
      ['BARBER:b-ivan', null],
      ['BARBER:b-niko', null],
    ]);
    expect(dropdownRows(open)[0]?.dropdownAction).toBe(DropdownAction.AddValue);
    expect(dropdownRows(open)[0]?.face).toEqual({ src: null, name: 'Иван' });
    const narrowed = searchSheetVm(
      input('bg', SearchQuery.empty(), {
        openField: SearchFilterField.Barber,
        dropdownText: 'ни',
      }),
    );
    expect(dropdownLabels(narrowed)).toEqual(['Нико']);
  });

  it('marks a pressed token’s held values, toggles them, and offers to remove the filter last', () => {
    const held = SearchQuery.withFilter(
      SearchQuery.empty(),
      SearchFilter.barber([NIKO]),
    );
    const vm = searchSheetVm(
      input('bg', held, { openField: SearchFilterField.Barber }),
    );
    expect(dropdownRows(vm).map((r) => [r.id, r.checked])).toEqual([
      ['BARBER:b-niko', true],
      ['BARBER:b-ivan', false],
      ['REMOVE:BARBER', null],
    ]);
    expect(dropdownRows(vm)[0]?.dropdownAction).toBe(
      DropdownAction.ToggleValue,
    );
    const remove = dropdownRows(vm).at(-1);
    expect(remove?.label).toBe('Махни филтъра');
    expect(remove?.destructive).toBe(true);
    expect(remove?.dropdownAction).toBe(DropdownAction.RemoveFilter);
  });

  it('offers the date presets the window reaches, then a day and a span', () => {
    const vm = searchSheetVm(
      input('en', SearchQuery.empty(), { openField: SearchFilterField.When }),
    );
    expect(dropdownLabels(vm)).toEqual([
      'Today',
      'Tomorrow',
      'This week',
      'Past 7 days',
      'A specific day…',
      'A date range…',
    ]);
    expect(dropdownRows(vm).at(-1)?.dropdownAction).toBe(
      DropdownAction.PickRange,
    );
  });

  it('opens the month for a span, asking for the first day and then the last', () => {
    const first = searchSheetVm(
      input('bg', SearchQuery.empty(), {
        openField: SearchFilterField.When,
        calendarMode: CalendarMode.Range,
      }),
    );
    expect(first.dropdown.sections).toEqual([]);
    expect(first.dropdown.calendar).toEqual({
      calendarMode: CalendarMode.Range,
      selected: null,
      today: FIXTURE_TODAY,
      caption: 'Избери първия ден',
    });
    const last = searchSheetVm(
      input('bg', SearchQuery.empty(), {
        openField: SearchFilterField.When,
        calendarMode: CalendarMode.Range,
        rangeStart: day(2),
      }),
    );
    expect(last.dropdown.calendar?.selected).toBe(day(2));
    expect(last.dropdown.calendar?.caption).toMatch(
      /^От .+ · избери последния ден$/,
    );
  });

  it('under typed text lists the values whose name holds it with their key, and only the keys it names', () => {
    const vm = searchSheetVm(input('bg', text('ни'), { dropdownText: 'ни' }));
    expect(vm.dropdown.dropdownMode).toBe(DropdownMode.Matches);
    expect(vm.dropdown.sections.map((s) => s.heading)).toEqual(['Предложения']);
    expect(
      vm.dropdown.sections[0]?.rows.map((r) => [r.label, r.detail]),
    ).toEqual([['Нико', 'Бръснар']]);
    const key = searchSheetVm(
      input('bg', text('бръ'), { dropdownText: 'бръ' }),
    );
    expect(key.dropdown.sections.map((s) => s.heading)).toEqual([
      'Филтрирай по',
    ]);
    expect(dropdownRows(key).map((r) => r.id)).toEqual(['FIELD:BARBER']);
  });

  it('lists nothing when the typed text names no value and no key', () => {
    const vm = searchSheetVm(
      input('bg', text('zzzz-no-such'), { dropdownText: 'zzzz-no-such' }),
    );
    expect(vm.dropdown.sections).toEqual([]);
  });

  it('does not offer a value that is already held', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(text('и'), SearchFilter.barber([IVAN])),
        { dropdownText: 'иван' },
      ),
    );
    expect(dropdownLabels(vm)).not.toContain('Иван');
  });

  it('offers no key whose values would keep no visit', () => {
    const vm = searchSheetVm(input('bg', text('zzzz-no-such')));
    expect(dropdownRows(vm).map((r) => r.id)).toEqual(['FIELD:WHEN']);
  });
});

describe('searchSheetVm — the edges', () => {
  it('says nothing matches, and offers to clear the filters only when there are chips', () => {
    const plain = searchSheetVm(input('bg', text('zzzz-no-such')));
    expect(plain.searchSheetState).toBe(SearchSheetState.Empty);
    expect(plain.clearFilters).toBeNull();
    const chipped = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(text('zzzz-no-such'), SearchFilter.note()),
      ),
    );
    expect(chipped.clearFilters).toBe('Махни филтрите');
  });

  it('adds the capped and out-of-date footnotes, in the reader’s words', () => {
    const vm = searchSheetVm(
      input('en', text('иван'), { capped: true, stale: true }),
    );
    expect(vm.footnotes).toEqual([
      'Showing the nearest 3,000 visits on each side.',
      'Results may be out of date.',
    ]);
  });

  it('shows at most the result limit of cards, and says so', () => {
    const big = searchWindowFixture(600, 5);
    const vm = searchSheetVm(
      input(
        'en',
        SearchQuery.withFilter(
          SearchQuery.empty(),
          SearchFilter.bookingStatuses([BookingStatus.Confirmed]),
        ),
        {
          pool: big.visits,
          index: SearchIndexSystem.build(big.visits, big.labels),
          lookup: {
            ...LOOKUP,
            serviceName: big.labels.serviceName,
            barberName: big.labels.barberName,
          },
          clientNames: big.labels.clientNames,
        },
      ),
    );
    expect(vm.groups.flatMap((g) => g.rows)).toHaveLength(200);
    expect(vm.footnotes.at(-1)).toBe(
      'Showing the first 200 results. Narrow the search.',
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(input('bg', text('иван 088')));
    expect(searchSheetVm(frozen)).toEqual(searchSheetVm(frozen));
  });
});
