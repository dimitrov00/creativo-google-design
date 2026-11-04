import { describe, expect, it } from 'vitest';
import {
  BookingContact,
  E164,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import {
  BookingStatus,
  LocalDate,
  MinuteOfDay,
  UserId,
} from '@core/primitives';
import {
  FIXTURE_IDS,
  FIXTURE_TODAY,
  appointmentFixture,
  deepFreeze,
  seatFixture,
  serviceFixture,
} from '@core/testing';
import type { StaffCatalogNames } from './staff-day-chrome.presenter';
import { searchHits, searchableFields } from './staff-search.presenter';
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
  callingCode: '359',
  companionNames: {},
  unnamedClient: 'Клиент без име',
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

  describe('the title is the client (B7)', () => {
    const titled = (
      overrides: Parameters<typeof appointmentFixture>[0],
      names: Readonly<Record<string, string>> = {},
    ) => {
      const [hit] = searchHits({
        ...input('Класическо', [visit({ contactName: null, ...overrides })]),
        companionNames: names,
      });
      return hit?.titleParts.map((part) => part.text).join('');
    };
    const son = UserId.of('u-son');
    const companionSeat = seatFixture({
      occupant: SeatOccupant.account(
        son,
        FIXTURE_IDS.customer,
        SubjectRelationship.Companion,
      ),
    });
    const guestSeat = seatFixture({
      occupant: SeatOccupant.anonymous('Ани' as never),
    });

    it('never makes a service the title of an account seat with no contact', () => {
      expect(titled({ seats: [seatFixture()] })).toBe('Клиент без име');
    });

    it('names a companion by his read profile', () => {
      expect(titled({ seats: [companionSeat] }, { [son]: 'Иво Колев' })).toBe(
        'Иво Колев',
      );
      expect(titled({ seats: [companionSeat] })).toBe('Клиент без име');
    });

    it('takes the first seat that holds a name, past an account seat with none', () => {
      expect(titled({ seats: [seatFixture(), guestSeat] })).toBe('Ани');
    });

    it('lists the service that matched beneath the person', () => {
      const [hit] = searchHits(
        input('Класическо', [
          visit({ contactName: null, seats: [seatFixture()] }),
        ]),
      );
      expect(hit?.matches.map((match) => match.label)).toEqual([
        SearchField.Service,
      ]);
    });

    it('falls to the service only with no person at all', () => {
      const [hit] = searchHits(
        input('Алергия', [
          visit({ contactName: null, contactNote: 'Алергия', seats: [] }),
        ]),
      );
      expect(hit?.titleParts.map((part) => part.text).join('')).toBe('Алергия');
    });

    it('keeps the contact when there is one', () => {
      expect(titled({ contactName: 'Георги', seats: [guestSeat] })).toBe(
        'Георги',
      );
    });
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

  describe('a phone, however it is typed', () => {
    const phoned = (term: string) =>
      searchHits(
        input(term, [visit({ contactPhone: E164.of('+359887778899') })]),
      );
    const marked = (term: string) =>
      phoned(term)[0]?.matches[0]?.parts.filter((part) => part.hit)[0]?.text;

    it.each(['088 777', '0887', '088 (777)-88', '+359 88 777', '359 88 777'])(
      'finds %s',
      (term) => {
        expect(phoned(term)).toHaveLength(1);
      },
    );

    it('marks the run through the spaces, the trunk 0 read as +359', () => {
      expect(marked('088 777')).toBe('359 88 777');
    });

    it('finds nothing in a number that does not begin so, nor in too few digits', () => {
      expect(phoned('099 777')).toEqual([]);
      expect(phoned('0088 777')).toEqual([]);
      expect(phoned('08')).toEqual([]);
    });

    it('keeps a mixed term to the text fields', () => {
      expect(phoned('Иван 088')).toEqual([]);
    });
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
