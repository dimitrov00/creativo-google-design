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
  SuggestAction,
  SuggestMode,
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
    typedText: '',
    draft: null,
    calendarMode: null,
    rangeStart: null,
    ...overrides,
  };
}

const text = (searchText: string) =>
  SearchQuery.withText(SearchQuery.empty(), searchText);
const rowIds = (vm: ReturnType<typeof searchSheetVm>) =>
  vm.groups.flatMap((group) => group.rows.map((row) => row.id as string));
const suggestionRows = (vm: SearchSheetVm) =>
  vm.suggestions.sections.flatMap((section) => section.rows);
const suggestionLabels = (vm: SearchSheetVm) =>
  suggestionRows(vm).map((row) => row.label);
const keyIds = (vm: SearchSheetVm) => vm.suggestions.keys.map((row) => row.id);

describe('searchSheetVm — idle', () => {
  it('shows the starters, the recents and, over the field, the keys a filter is made of — no cards', () => {
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
    expect(vm.suggestions.suggestMode).toBe(SuggestMode.Fields);
    // Mail's «Suggestions» before anything is typed — today, tomorrow, the
    // barbers — under the key each belongs to.
    expect(
      vm.suggestions.sections.map((s) => [
        s.heading,
        s.rows.map((r) => r.label),
      ]),
    ).toEqual([
      ['Кога', ['Днес', 'Утре']],
      ['Бръснар', ['Иван', 'Нико']],
    ]);
    expect(suggestionRows(vm).map((r) => [r.detail, r.suggestAction])).toEqual(
      Array(4).fill([null, SuggestAction.AddValue]),
    );
    // Nothing typed, nothing marked.
    expect(suggestionRows(vm)[0]?.parts).toEqual([
      { text: 'Днес', hit: false },
    ]);
    expect(suggestionRows(vm)[2]?.face).toEqual({ src: null, name: 'Иван' });
    expect(vm.filters).toEqual([]);
    expect(vm.suggestions.keys.map((row) => [row.id, row.label])).toEqual([
      ['FIELD:WHEN', 'Кога'],
      ['FIELD:BARBER', 'Бръснар'],
      ['FIELD:SERVICE', 'Услуга'],
      ['FIELD:STATUS', 'Статус'],
      ['FIELD:NOTE', 'С бележка'],
    ]);
    // A note has no values: its key adds the filter itself.
    expect(vm.suggestions.keys.at(-1)?.suggestAction).toBe(
      SuggestAction.AddValue,
    );
    expect(vm.suggestions.keys.at(-1)?.filter).toEqual(SearchFilter.note());
    expect(vm.placeholder).toBe('Име, телефон, имейл, услуга…');
  });

  it('says the same in English', () => {
    const vm = searchSheetVm(input('en', SearchQuery.empty()));
    expect(vm.suggestions.keys.map((row) => row.label)).toEqual([
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

describe('searchSheetVm — the chosen filters over the field', () => {
  const withBarber = SearchQuery.withFilter(
    text('иван'),
    SearchFilter.barber([IVAN, NIKO]),
  );

  it('draws one selected chip per chosen kind, saying its value, faces leading a barber’s', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(withBarber, SearchFilter.when(day(0), day(6))),
      ),
    );
    expect(vm.filters.map((c) => [c.id, c.label, c.glyph])).toEqual([
      ['BARBER', 'Иван, Нико', 'contact.person'],
      ['WHEN', 'Тази седмица', 'visit.calendar'],
    ]);
    expect(vm.filters[0]?.faces).toEqual([
      { src: null, name: 'Иван' },
      { src: null, name: 'Нико' },
    ]);
    expect(vm.filters[0]?.facesOverflow).toBe(0);
    expect(vm.filters[0]?.accessibleLabel).toBe(
      'Бръснар: Иван, Нико. Промени филтъра',
    );
    expect(vm.filters.some((c) => c.active)).toBe(false);
    expect(vm.placeholder).toBe('Търси…');
  });

  it('leaves a chosen key out of the free keys', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(
          SearchQuery.empty(),
          SearchFilter.barber([NIKO]),
        ),
      ),
    );
    expect(keyIds(vm)).not.toContain('FIELD:BARBER');
    expect(keyIds(vm)[0]).toBe('FIELD:WHEN');
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
    expect(vm.filters[0]?.label).toBe('Потвърдени, Отказани +1');
  });

  it('says «С бележка» for the note filter, never its bare value', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.note()),
      ),
    );
    expect(vm.filters[0]?.label).toBe('С бележка');
  });

  it('stands the key being picked last, saying its key, ringed, and scopes the placeholder to it', () => {
    const vm = searchSheetVm(
      input('bg', withBarber, { openField: SearchFilterField.Service }),
    );
    expect(vm.filters.map((c) => [c.id, c.label, c.active])).toEqual([
      ['BARBER', 'Иван, Нико', false],
      ['SERVICE', 'Услуга', true],
    ]);
    expect(vm.filters[1]?.accessibleLabel).toBe('Услуга: избери стойност');
    expect(vm.placeholder).toBe('Търси в „Услуга“…');
    expect(keyIds(vm)).toEqual([]);
    expect(
      searchSheetVm(
        input('en', SearchQuery.empty(), { openField: SearchFilterField.When }),
      ).placeholder,
    ).toBe('Search in “When”…');
  });

  it('rings a chosen filter while its values are open', () => {
    const vm = searchSheetVm(
      input('bg', withBarber, { openField: SearchFilterField.Barber }),
    );
    expect(vm.filters.map((c) => [c.id, c.active])).toEqual([['BARBER', true]]);
    expect(vm.placeholder).toBe('Търси в „Бръснар“…');
  });

  it('stands the chips in the order their filters were added', () => {
    const query = SearchQuery.withFilter(
      SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.note()),
      SearchFilter.barber([IVAN]),
    );
    expect(searchSheetVm(input('bg', query)).filters.map((c) => c.id)).toEqual([
      SearchFilterField.Note,
      SearchFilterField.Barber,
    ]);
  });

  it('offers no starters once a filter is chosen', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.note()),
      ),
    );
    expect(vm.suggestions.sections).toEqual([]);
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
      ).filters[0]?.label;
    expect(one(day(0), day(0))).toBe('Днес');
    expect(one(day(-1), day(-1))).toBe('Вчера');
    expect(one(day(-6), day(0))).toBe('Последните 7 дни');
    expect(one(day(-9), day(-3), 'en')).toMatch(/–/);
  });
});

describe('searchSheetVm — the suggestions', () => {
  it('lists an open key’s values for a key being picked, the typed text narrowing them', () => {
    const open = searchSheetVm(
      input('bg', SearchQuery.empty(), { openField: SearchFilterField.Barber }),
    );
    expect(open.suggestions.suggestMode).toBe(SuggestMode.Values);
    expect(open.suggestions.sections.map((s) => s.heading)).toEqual([
      'Бръснар',
    ]);
    // A barber key is picked as a set: every value a tick, none ticked yet,
    // «Приложи» in the bar.
    expect(suggestionRows(open).map((r) => [r.id, r.checked])).toEqual([
      ['BARBER:b-ivan', false],
      ['BARBER:b-niko', false],
    ]);
    expect(suggestionRows(open)[0]?.suggestAction).toBe(
      SuggestAction.ToggleValue,
    );
    expect(open.suggestions.apply).toEqual({ label: 'Приложи' });
    expect(suggestionRows(open)[0]?.face).toEqual({ src: null, name: 'Иван' });
    const narrowed = searchSheetVm(
      input('bg', SearchQuery.empty(), {
        openField: SearchFilterField.Barber,
        typedText: 'ни',
      }),
    );
    expect(suggestionLabels(narrowed)).toEqual(['Нико']);
  });

  it('ticks the set being picked, offers «Приложи» with its count, and removing the filter last', () => {
    const held = SearchQuery.withFilter(
      SearchQuery.empty(),
      SearchFilter.barber([NIKO]),
    );
    const vm = searchSheetVm(
      input('bg', held, {
        openField: SearchFilterField.Barber,
        draft: SearchFilter.barber([NIKO]),
      }),
    );
    // The window's own order: a held value keeps its place. The ticks are
    // the set being picked (opened from what is held).
    expect(suggestionRows(vm).map((r) => [r.id, r.checked])).toEqual([
      ['BARBER:b-ivan', false],
      ['BARBER:b-niko', true],
      ['REMOVE:BARBER', null],
    ]);
    expect(suggestionRows(vm)[1]?.suggestAction).toBe(
      SuggestAction.ToggleValue,
    );
    const remove = suggestionRows(vm).at(-1);
    expect(remove?.label).toBe('Махни филтъра');
    expect(remove?.destructive).toBe(true);
    expect(remove?.suggestAction).toBe(SuggestAction.RemoveFilter);
    expect(vm.suggestions.apply).toEqual({ label: 'Приложи (1)' });
    // Ticked but not applied: the chip still says what is held.
    const ticked = searchSheetVm(
      input('en', held, {
        openField: SearchFilterField.Barber,
        draft: SearchFilter.barber([NIKO, IVAN]),
      }),
    );
    expect(suggestionRows(ticked).map((r) => r.checked)).toEqual([
      true,
      true,
      null,
    ]);
    expect(ticked.suggestions.apply).toEqual({ label: 'Apply (2)' });
    expect(ticked.filters[0]?.label).toBe('Нико');
  });

  it('keeps a held preset where it stands, and puts a held day the window does not offer after the presets', () => {
    const preset = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(
          SearchQuery.empty(),
          SearchFilter.when(day(1), day(1)),
        ),
        { openField: SearchFilterField.When },
      ),
    );
    expect(suggestionLabels(preset).slice(0, 2)).toEqual(['Днес', 'Утре']);
    const custom = searchSheetVm(
      input(
        'en',
        SearchQuery.withFilter(
          SearchQuery.empty(),
          SearchFilter.when(day(30), day(30)),
        ),
        { openField: SearchFilterField.When },
      ),
    );
    const labels = suggestionLabels(custom);
    expect(labels.slice(0, 4)).toEqual([
      'Today',
      'Tomorrow',
      'This week',
      'Past 7 days',
    ]);
    expect(suggestionRows(custom)[4]?.checked).toBe(true);
    expect(labels.slice(5)).toEqual([
      'A specific day…',
      'A date range…',
      'Remove filter',
    ]);
  });

  it('offers the date presets the window reaches, then a day and a span', () => {
    const vm = searchSheetVm(
      input('en', SearchQuery.empty(), { openField: SearchFilterField.When }),
    );
    expect(suggestionLabels(vm)).toEqual([
      'Today',
      'Tomorrow',
      'This week',
      'Past 7 days',
      'A specific day…',
      'A date range…',
    ]);
    expect(suggestionRows(vm).at(-1)?.suggestAction).toBe(
      SuggestAction.PickRange,
    );
  });

  it('opens the month for a span, asking for the first day and then the last', () => {
    const first = searchSheetVm(
      input('bg', SearchQuery.empty(), {
        openField: SearchFilterField.When,
        calendarMode: CalendarMode.Range,
      }),
    );
    expect(first.suggestions.sections).toEqual([]);
    expect(first.suggestions.calendar).toEqual({
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
    expect(last.suggestions.calendar?.selected).toBe(day(2));
    expect(last.suggestions.calendar?.caption).toMatch(
      /^От .+ · избери последния ден$/,
    );
  });

  it('under typed text suggests the values whose name holds it under their key, the run marked, and keeps only the keys it names', () => {
    const vm = searchSheetVm(input('bg', text('ни'), { typedText: 'ни' }));
    expect(vm.suggestions.suggestMode).toBe(SuggestMode.Matches);
    expect(vm.suggestions.sections.map((s) => s.heading)).toEqual(['Бръснар']);
    expect(vm.suggestions.sections[0]?.rows.map((r) => r.parts)).toEqual([
      [
        { text: 'Ни', hit: true },
        { text: 'ко', hit: false },
      ],
    ]);
    expect(keyIds(vm)).toEqual([]);
    const key = searchSheetVm(input('bg', text('бръ'), { typedText: 'бръ' }));
    expect(key.suggestions.sections).toEqual([]);
    expect(keyIds(key)).toEqual(['FIELD:BARBER']);
    expect(key.suggestions.keys[0]?.parts).toEqual([
      { text: 'Бръ', hit: true },
      { text: 'снар', hit: false },
    ]);
  });

  it('marks the typed run in an open key’s values, and says it in the open chip', () => {
    const vm = searchSheetVm(
      input('bg', SearchQuery.empty(), {
        openField: SearchFilterField.When,
        typedText: 'ут',
      }),
    );
    expect(suggestionRows(vm)[0]?.parts).toEqual([
      { text: 'Ут', hit: true },
      { text: 'ре', hit: false },
    ]);
    expect(vm.filters.map((c) => [c.label, c.active])).toEqual([
      ['Кога: „ут“', true],
    ]);
    expect(
      searchSheetVm(
        input('en', SearchQuery.empty(), {
          openField: SearchFilterField.When,
          typedText: 'to',
        }),
      ).filters[0]?.label,
    ).toBe('When: “to”');
  });

  it('lists nothing when the typed text names no value and no key', () => {
    const vm = searchSheetVm(
      input('bg', text('zzzz-no-such'), { typedText: 'zzzz-no-such' }),
    );
    expect(vm.suggestions.sections).toEqual([]);
    expect(keyIds(vm)).toEqual([]);
  });

  it('does not offer a value that is already held', () => {
    const vm = searchSheetVm(
      input(
        'bg',
        SearchQuery.withFilter(text('и'), SearchFilter.barber([IVAN])),
        { typedText: 'иван' },
      ),
    );
    expect(suggestionLabels(vm)).not.toContain('Иван');
  });

  it('offers no key whose values would keep no visit', () => {
    const vm = searchSheetVm(input('bg', text('zzzz-no-such')));
    expect(keyIds(vm)).toEqual(['FIELD:WHEN']);
  });
});

describe('searchSheetVm — the edges', () => {
  it('says nothing matches, and offers to clear the filters only when some are chosen', () => {
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
