import { describe, expect, it } from 'vitest';
import { BookingContact, E164 } from '@core/components';
import { BookingStatus, LocalDate, MinuteOfDay } from '@core/primitives';
import {
  FIXTURE_TODAY,
  appointmentFixture,
  deepFreeze,
  seatFixture,
  serviceFixture,
} from '@core/testing';
import type { StaffCatalogNames } from './staff-day-chrome.presenter';
import {
  searchHits,
  searchableFields,
  splitOnDigits,
  splitOnTerm,
} from './staff-search.presenter';
import { SearchField } from './staff-search.vm';

const NAMES: StaffCatalogNames = {
  findService: () => serviceFixture(),
  text: (localized) => localized.bg,
};

const visit = (
  overrides: Parameters<typeof appointmentFixture>[0] = {},
): ReturnType<typeof appointmentFixture> =>
  appointmentFixture({
    ...BookingContact.NONE,
    contactName: 'Георги Иванов',
    ...overrides,
  });

const input = (
  term: string,
  pool: readonly ReturnType<typeof visit>[],
  zoneKnown = true,
) => ({
  term,
  pool,
  shopNowAt: () => null,
  names: NAMES,
  zoneKnown,
  locale: 'bg',
});

describe('splitOnTerm — the runs a match marks', () => {
  it('marks every occurrence and returns the ORIGINAL slices', () => {
    expect(splitOnTerm('Георги и георги', 'георги')).toEqual([
      { text: 'Георги', hit: true },
      { text: ' и ', hit: false },
      { text: 'георги', hit: true },
    ]);
  });

  it('leaves a value the term does not hold whole', () => {
    expect(splitOnTerm('Иван', 'георги')).toEqual([
      { text: 'Иван', hit: false },
    ]);
  });
});

describe('splitOnDigits — one run through a formatted phone', () => {
  it('marks across the separators, never three runs for one match', () => {
    expect(splitOnDigits('+359 88 777 8899', '887778899')).toEqual([
      { text: '+359 ', hit: false },
      { text: '88 777 8899', hit: true },
    ]);
  });
});

describe('searchableFields — what a visit offers a search, in display order', () => {
  it('reads the contact, each seat, the phone, the mail and the note', () => {
    const fields = searchableFields(
      visit({
        contactPhone: E164.of('+359887778899'),
        contactNote: 'Алергия',
      }),
      NAMES,
    );
    expect(fields.map((field) => field.label)).toEqual([
      SearchField.Client,
      SearchField.Service,
      SearchField.Phone,
      SearchField.Note,
    ]);
    expect(fields[0]?.value).toBe('Георги Иванов');
    expect(fields[1]?.value).toBe('Класическо подстригване');
  });

  it('skips a service the catalogue no longer knows', () => {
    const fields = searchableFields(visit(), {
      ...NAMES,
      findService: () => undefined,
    });
    expect(fields.map((field) => field.label)).toEqual([SearchField.Client]);
  });
});

describe('searchHits — the hits as the sheet prints them', () => {
  it('answers nothing for a term too short to search', () => {
    expect(searchHits(input('г', [visit()]))).toEqual([]);
  });

  it('marks the title, and lists only the OTHER fields that matched', () => {
    const [hit] = searchHits(input('  ГЕОРГИ ', [visit()]));
    expect(hit?.titleParts).toEqual([
      { text: 'Георги', hit: true },
      { text: ' Иванов', hit: false },
    ]);
    expect(hit?.matches).toEqual([]);
    expect(hit?.bookingStatus).toBe(BookingStatus.Confirmed);
    expect(hit?.dayKey).toBe(FIXTURE_TODAY);
  });

  it('finds a phone by its bare digits and marks the run through its spaces', () => {
    const [hit] = searchHits(
      input('887778899', [visit({ contactPhone: E164.of('+359887778899') })]),
    );
    expect(hit?.titleParts).toEqual([{ text: 'Георги Иванов', hit: false }]);
    expect(hit?.matches[0]?.label).toBe(SearchField.Phone);
    expect(hit?.matches[0]?.parts.some((part) => part.hit)).toBe(true);
    expect(
      hit?.matches[0]?.parts
        .filter((part) => part.hit)
        .map((part) => part.text.replace(/\s/g, ''))
        .join(''),
    ).toBe('887778899');
  });

  it('prints the shop’s wall clock, nothing before the zone is known', () => {
    const later = visit({
      localDate: LocalDate.addDays(FIXTURE_TODAY, 1),
      startMinutes: MinuteOfDay.ofProven(600),
      seats: [seatFixture()],
    });
    expect(searchHits(input('георги', [later]))[0]?.whenLabel).toMatch(/10:00/);
    expect(searchHits(input('георги', [later], false))[0]?.whenLabel).toBe('');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const pool = deepFreeze([visit()]);
    expect(searchHits(input('георги', pool))).toEqual(
      searchHits(input('георги', pool)),
    );
  });
});
