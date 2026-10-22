import { describe, expect, it } from 'vitest';
import type { Appointment } from '@core/entities';
import { type Seat, SeatOutcome } from '@core/components';
import { FIXTURE_TODAY } from '@core/testing';
import { appCatalogue } from '../testing/app-catalogue';
import {
  GEORGI_PHOTOS,
  GEORGI_UID,
  GEORGI_VISITS,
  IVO_UID,
  VISITS_LOOKUP,
  catalogueTranslator,
  type VisitStatusSpec,
  georgiWaitlistRequest,
  sofia,
  visitOf,
  visitSeat,
  visitsNowMs,
} from '../testing/visit-fixtures';
import {
  visitRowOf,
  visitWaitlistWordsOf,
  visitWordsOf,
  waitlistRowOf,
} from '../visit-row.presenter';
import type { VisitLookup, VisitWords } from '../visit-row.vm';
import { visitCardOf, waitlistCardOf } from './visit-card.presenter';
import type {
  VisitCardOptions,
  VisitCardVm,
  VisitCardWords,
} from './visit-card.vm';

/*
 * THE CARD BUILDERS, over Георги Петров's book as the lib's fixtures tell
 * it and the app's own catalogues: a key the builders name and a catalogue
 * lacks fails here, not on a screen.
 */

const BG = catalogueTranslator(appCatalogue('bg'));
const EN = catalogueTranslator(appCatalogue('en'));

/** The row's words, with the capsule's «Потвърден» whether or not the row's reader fills it yet (K3-5). */
function wordsOf(
  translate: typeof BG,
  lang: 'bg' | 'en',
  perspective: 'staff' | 'client',
): VisitWords {
  return {
    ...visitWordsOf(translate, lang, perspective),
    statusConfirmed: translate('appointments.status.confirmed'),
  };
}

function cardWordsOf(translate: typeof BG): VisitCardWords {
  return {
    last: translate('visits.card.last'),
    next: translate('visits.card.next'),
    name: (label, sentence) =>
      translate('visits.card.name', { label, sentence }),
  };
}

const STAFF_WORDS = wordsOf(BG, 'bg', 'staff');
const CLIENT_WORDS = wordsOf(BG, 'bg', 'client');
const CARD_WORDS = cardWordsOf(BG);
const NOW_MS = visitsNowMs(FIXTURE_TODAY);

/** `formatMoney`'s bg form keeps the sign on the figure's line: a no-break space. */
const EURO = (text: string) => text.replaceAll(' €', ' €');

function visit(id: string): Appointment {
  const found = GEORGI_VISITS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no visit ${id}`);
  return found;
}

function staffCard(
  appointment: Appointment,
  kind: 'last' | 'next',
  overrides: Partial<VisitCardOptions> = {},
  lookup: VisitLookup = VISITS_LOOKUP,
): VisitCardVm {
  return visitCardOf(
    appointment,
    {
      kind,
      perspective: 'staff',
      subjectUserId: GEORGI_UID,
      nowMs: NOW_MS,
      locale: 'bg',
      words: STAFF_WORDS,
      cardWords: CARD_WORDS,
      testId: kind === 'last' ? 'client-visit-last' : 'client-visit-next',
      ...overrides,
    },
    lookup,
  );
}

const line = (card: VisitCardVm) =>
  card.facts.map((part) => part.text).join('');
const factsOf = (card: VisitCardVm) =>
  card.facts.filter((part) => part.fact).map((part) => part.text);

// ── Appointments the book does not hold ────────────────────────────────

/** Each seat's own start, so a visit knows its shop day (a seat holds only its minute). */
const SEAT_START = new WeakMap<Seat, string>();

function seatOf(
  id: string,
  startIso: string,
  spec: {
    readonly who?: string;
    readonly service?: string;
    readonly barber?: string;
    readonly priceMinor?: number;
    readonly outcome?: SeatOutcome;
  } = {},
): Seat {
  const seat = visitSeat(startIso, { id, ...spec });
  SEAT_START.set(seat, startIso);
  return seat;
}

function appointmentOf(
  id: string,
  seats: readonly Seat[],
  status: { readonly kind: VisitStatusSpec },
  locationId = 'loc-center',
): Appointment {
  const first = seats[0];
  return visitOf(
    id,
    locationId,
    seats,
    status.kind,
    (first === undefined ? null : SEAT_START.get(first)) ??
      '2026-10-09T10:00:00',
  );
}

const seatWorked = SeatOutcome.worked;

describe('visitCardOf · the last visit, on the staff glance', () => {
  it('leads with the services and sets the DATE apart in the quiet line', () => {
    const card = staffCard(visit('appt-sep'), 'last');

    expect(card.id).toBe('appt-sep');
    expect(card.kind).toBe('last');
    expect(card.label).toBe('Последно посещение');
    expect(card.services).toBe('Фейд');
    // date · who · where: the runs carry their own joints.
    expect(card.facts).toEqual([
      { text: '4.09', fact: true },
      { text: ' · Иван · Център', fact: false },
    ]);
    expect(card.testId).toBe('client-visit-last');
  });

  it('prints what the visit cost, as the row does', () => {
    expect(staffCard(visit('appt-sep'), 'last').figure).toBe(EURO('27,50 €'));
    // A cut and a beard with a first-visit code: the bill, discount taken off.
    const august = staffCard(visit('appt-aug'), 'last');
    expect(august.services).toBe('Фейд · Оформяне на брада');
    expect(august.figure).toBe(EURO('38,25 €'));
    // One figure in the lib: whatever the row prints, the card prints.
    const row = visitRowOf(
      visit('appt-aug'),
      {
        perspective: 'staff',
        grain: 'year',
        subjectUserId: GEORGI_UID,
        currentAppointmentId: null,
        nowMs: NOW_MS,
        locale: 'bg',
        words: STAFF_WORDS,
      },
      VISITS_LOOKUP,
    );
    const money = [row.trailingFact ?? null, row.trailing].find(
      (slot) => slot !== null && slot.kind === 'amount',
    );
    expect(money).toMatchObject({ text: august.figure });
    expect(august.services).toBe(row.title);
  });

  it('carries the client’s own words, already quoted', () => {
    const card = staffCard(visit('appt-sep'), 'last');
    expect(card.quote).toBe('„Къса отстрани, по-дълго отгоре“');
    // Withheld from a viewer who may not read free text (R15)…
    expect(
      staffCard(visit('appt-sep'), 'last', { clientWords: false }).quote,
    ).toBeNull();
    // …and never a companion's: the words belong to whoever booked.
    expect(
      staffCard(visit('appt-sep'), 'last', { subjectUserId: IVO_UID }).quote,
    ).toBeNull();
    // A visit booked without a note has none.
    expect(staffCard(visit('appt-aug'), 'last').quote).toBeNull();
  });

  it('shows who cut as a face, by the whole name', () => {
    expect(staffCard(visit('appt-sep'), 'last').barber).toEqual({
      name: 'Иван',
      avatarSrc: 'https://example.test/barbers/ivan.jpg',
    });
    const lookup: VisitLookup = {
      ...VISITS_LOOKUP,
      barberName: (id) => (id === 'barber-ivan' ? 'Иван Колев' : null),
    };
    const card = staffCard(visit('appt-sep'), 'last', {}, lookup);
    // The face and the sentence keep the whole name; the line goes by the first.
    expect(card.barber?.name).toBe('Иван Колев');
    expect(line(card)).toBe('4.09 · Иван · Център');
    expect(card.accessibleName).toContain('Иван Колев');
  });

  it('draws no status and no capsule: the label already says it happened', () => {
    for (const id of ['appt-sep', 'appt-aug', 'appt-dec-party']) {
      expect(staffCard(visit(id), 'last').capsule).toBeNull();
    }
  });

  it('draws at most three thumbs, each named by its own day', () => {
    const photos = GEORGI_PHOTOS.filter(
      (photo) => photo.appointmentId === 'appt-aug',
    ).map((photo) => ({
      id: photo.id as string,
      url: photo.url,
      takenAtUtcMs: photo.takenAtUtcMs,
    }));
    const card = staffCard(visit('appt-aug'), 'last', { photos });
    expect(card.photos).toEqual([
      {
        id: 'photo-aug-1',
        url: 'https://example.test/photos/photo-aug-1.jpg',
        alt: 'Снимка от 12 август',
      },
      {
        id: 'photo-aug-2',
        url: 'https://example.test/photos/photo-aug-2.jpg',
        alt: 'Снимка от 12 август',
      },
      {
        id: 'photo-aug-cover',
        url: 'https://example.test/photos/photo-aug-cover.jpg',
        alt: 'Снимка от 12 август',
      },
    ]);
    const many = [...photos, ...photos].map((photo, index) => ({
      ...photo,
      id: `photo-${index}`,
    }));
    expect(
      staffCard(visit('appt-aug'), 'last', { photos: many }).photos.map(
        (photo) => photo.id,
      ),
    ).toEqual(['photo-0', 'photo-1', 'photo-2']);
    // None listed, none drawn.
    expect(staffCard(visit('appt-aug'), 'last').photos).toEqual([]);
  });

  it('names the shop only where the tenant has more than one', () => {
    const oneShop: VisitLookup = { ...VISITS_LOOKUP, locationCount: 1 };
    expect(line(staffCard(visit('appt-sep'), 'last', {}, oneShop))).toBe(
      '4.09 · Иван',
    );
  });

  it('tells the SUBJECT’s story of a party: their seat, their barber, their share', () => {
    const card = staffCard(visit('appt-dec-party'), 'last');
    expect(card.services).toBe('Фейд');
    // Last December: the year, since it is not this one (R59).
    expect(card.facts).toEqual([
      { text: '5.12.2025 г.', fact: true },
      { text: ' · Петър · Младост', fact: false },
    ]);
    expect(card.figure).toBe(EURO('25,00 €'));
    expect(card.barber).toEqual({ name: 'Петър', avatarSrc: null });
    expect(card.accessibleName).toBe(
      `Последно посещение: Фейд, 5 декември 2025 г., Петър, Младост, ${EURO('25,00 €')}`,
    );
  });

  it('prints no figure for a visit that was not worked', () => {
    // A host hands the card a worked visit; one that is not keeps its money to itself.
    expect(staffCard(visit('appt-jul-cancelled'), 'last').figure).toBeNull();
    expect(staffCard(visit('appt-jul-no-show'), 'last').figure).toBeNull();
  });

  it('says the card in one sentence: the label, then every fact the eye reads', () => {
    expect(staffCard(visit('appt-sep'), 'last').accessibleName).toBe(
      `Последно посещение: Фейд, 4 септември, Иван, Център, ${EURO('27,50 €')}, от клиента: „Къса отстрани, по-дълго отгоре“`,
    );
    expect(staffCard(visit('appt-aug'), 'last').accessibleName).toBe(
      `Последно посещение: Фейд · Оформяне на брада, 12 август, Иван, Център, ${EURO('38,25 €')}`,
    );
  });
});

describe('visitCardOf · the next visit', () => {
  it('reads in the same order, the TIME set apart', () => {
    const card = staffCard(visit('appt-oct'), 'next');
    expect(card.kind).toBe('next');
    expect(card.label).toBe('Следващ час');
    expect(card.services).toBe('Фейд');
    expect(card.facts).toEqual([
      { text: 'пт, 2.10 · ', fact: false },
      { text: '10:00', fact: true },
      { text: ' · Иван', fact: false },
    ]);
    expect(factsOf(card)).toEqual(['10:00']);
    expect(card.testId).toBe('client-visit-next');
  });

  it('wears its status as a capsule: a status is news on a visit to come', () => {
    expect(staffCard(visit('appt-oct'), 'next').capsule).toEqual({
      text: 'Заявен',
      tone: 'accent',
    });
    expect(staffCard(visit('appt-today'), 'next').capsule).toEqual({
      text: 'Потвърден',
      tone: 'accent',
    });
  });

  it('draws no capsule for a confirmed visit while the words carry no «Потвърден»', () => {
    const words: VisitWords = { ...STAFF_WORDS, statusConfirmed: undefined };
    const card = staffCard(visit('appt-today'), 'next', { words });
    expect(card.capsule).toBeNull();
    expect(card.accessibleName).not.toContain('Потвърден');
    // «Заявен» has always been the row's.
    expect(staffCard(visit('appt-oct'), 'next', { words }).capsule?.text).toBe(
      'Заявен',
    );
  });

  it('prints no money, no shop, no quote: nothing has happened yet', () => {
    const card = staffCard(visit('appt-oct'), 'next');
    expect(card.figure).toBeNull();
    expect(card.quote).toBeNull();
    expect(line(card)).not.toContain('Център');
  });

  it('says «днес» for a visit later today', () => {
    const card = staffCard(visit('appt-today'), 'next');
    expect(card.facts).toEqual([
      { text: 'днес · ', fact: false },
      { text: '10:00', fact: true },
      { text: ' · Иван', fact: false },
    ]);
    expect(card.accessibleName).toBe(
      'Следващ час: Фейд, днес, 10:00, Иван, Потвърден',
    );
  });

  it('says the card in one sentence, the status word in it', () => {
    expect(staffCard(visit('appt-oct'), 'next').accessibleName).toBe(
      'Следващ час: Фейд, петък, 2 октомври в 10:00, Иван, Заявен',
    );
  });

  it('names a party cut by several in the line, and draws no face', () => {
    const party = appointmentOf(
      'appt-two-barbers',
      [
        seatOf('seat-cut', '2026-10-09T10:00:00'),
        seatOf('seat-beard', '2026-10-09T10:30:00', {
          service: 'svc-beard',
          barber: 'barber-petar',
        }),
      ],
      { kind: 'confirmed' },
    );
    const card = staffCard(party, 'next');
    expect(card.barber).toBeNull();
    expect(card.services).toBe('Фейд · Оформяне на брада');
    expect(line(card)).toBe('пт, 9.10 · 10:00 · Иван и Петър');
    expect(card.accessibleName).toBe(
      'Следващ час: Фейд · Оформяне на брада, петък, 9 октомври в 10:00, Иван и Петър, Потвърден',
    );
  });

  it('falls back to the catalogue’s own words for what it no longer lists', () => {
    const empty: VisitLookup = {
      serviceName: () => null,
      barberName: () => null,
      barberAvatarSrc: () => null,
      locationName: () => null,
      locationCount: 1,
    };
    const card = staffCard(visit('appt-oct'), 'next', {}, empty);
    expect(card.services).toBe('Посещение');
    expect(line(card)).toBe('пт, 2.10 · 10:00 · Бръснар');
    expect(card.barber).toEqual({ name: 'Бръснар', avatarSrc: null });
  });
});

describe('visitCardOf · `/account`’s «Предстоящ час»', () => {
  function accountCard(
    appointment: Appointment,
    overrides: Partial<VisitCardOptions> = {},
  ): VisitCardVm {
    return visitCardOf(
      appointment,
      {
        kind: 'next',
        perspective: 'client',
        subjectUserId: null,
        nowMs: NOW_MS,
        locale: 'bg',
        words: CLIENT_WORDS,
        cardWords: CARD_WORDS,
        label: BG('account.upcoming.title'),
        barber: false,
        testId: 'account-upcoming',
        ...overrides,
      },
      VISITS_LOOKUP,
    );
  }

  it('says exactly what the page says today: the day, the time, the status', () => {
    const card = accountCard(visit('appt-oct'));
    expect(card.label).toBe('Предстоящ час');
    expect(line(card)).toBe('пт, 2.10 · 10:00');
    expect(card.facts).toEqual([
      { text: 'пт, 2.10 · ', fact: false },
      { text: '10:00', fact: true },
    ]);
    expect(card.capsule).toEqual({ text: 'Заявен', tone: 'accent' });
    expect(card.barber).toBeNull();
    expect(card.figure).toBeNull();
    expect(card.quote).toBeNull();
    expect(card.photos).toEqual([]);
    expect(card.testId).toBe('account-upcoming');
  });

  it('leaves the barber out of the sentence too, and leaves no hole where he stood', () => {
    expect(accountCard(visit('appt-oct')).accessibleName).toBe(
      'Предстоящ час: Фейд, петък, 2 октомври в 10:00, Заявен',
    );
    const words: VisitWords = { ...CLIENT_WORDS, statusConfirmed: undefined };
    // Nothing after the day at all: the sentence ends on it.
    expect(accountCard(visit('appt-today'), { words }).accessibleName).toBe(
      'Предстоящ час: Фейд, днес, 10:00',
    );
  });

  it('joins the client’s words straight to the day when nothing stands between them', () => {
    // A staff card asked for no barber, in a tenant of one shop, of a
    // visit that was not worked: the day, then the quote.
    const card = visitCardOf(
      visit('appt-sep'),
      {
        kind: 'next',
        perspective: 'staff',
        subjectUserId: GEORGI_UID,
        nowMs: NOW_MS,
        locale: 'bg',
        words: STAFF_WORDS,
        cardWords: CARD_WORDS,
        barber: false,
        testId: 'client-visit-next',
      },
      { ...VISITS_LOOKUP, locationCount: 1 },
    );
    expect(card.accessibleName).toBe(
      'Следващ час: Фейд, петък, 4 септември в 10:00, от клиента: „Къса отстрани, по-дълго отгоре“',
    );
  });

  it('prints no money to the client, whatever the visit', () => {
    const card = accountCard(visit('appt-sep'), { kind: 'last' });
    expect(card.figure).toBeNull();
    expect(card.quote).toBeNull();
    expect(line(card)).toBe('4.09');
  });

  it('names who cuts as the client knows them, once the page asks for it (Q7)', () => {
    const card = accountCard(visit('appt-oct'), { barber: true });
    expect(line(card)).toBe('пт, 2.10 · 10:00 · Иван');
    expect(card.barber?.name).toBe('Иван');
    const party = appointmentOf(
      'appt-two-barbers',
      [
        seatOf('seat-cut', '2026-10-09T10:00:00'),
        seatOf('seat-ivo', '2026-10-09T10:00:00', {
          who: IVO_UID,
          barber: 'barber-petar',
        }),
      ],
      { kind: 'confirmed' },
    );
    const several = accountCard(party, { barber: true });
    expect(line(several)).toBe('пт, 9.10 · 10:00 · 2 бръснари');
    expect(several.barber).toBeNull();
  });
});

describe('visitCardOf · in English', () => {
  it('words the card from the English catalogue, on the shop’s calendar', () => {
    const card = visitCardOf(
      visit('appt-oct'),
      {
        kind: 'next',
        perspective: 'staff',
        subjectUserId: GEORGI_UID,
        nowMs: NOW_MS,
        locale: 'en',
        words: wordsOf(EN, 'en', 'staff'),
        cardWords: cardWordsOf(EN),
        testId: 'client-visit-next',
      },
      VISITS_LOOKUP,
    );
    expect(card.label).toBe('Next visit');
    expect(factsOf(card)).toHaveLength(1);
    expect(line(card)).toMatch(/^Fri, Oct 2 · 10:00\sAM · Иван$/);
    expect(card.capsule?.text).toBe(EN('appointments.status.pending'));
    expect(card.accessibleName.startsWith('Next visit: Фейд, Friday, ')).toBe(
      true,
    );
  });
});

describe('waitlistCardOf', () => {
  const WAITLIST_WORDS = visitWaitlistWordsOf(BG);

  function waiting(otherRequests?: number): VisitCardVm {
    return waitlistCardOf(
      georgiWaitlistRequest(),
      {
        words: WAITLIST_WORDS,
        today: FIXTURE_TODAY,
        locale: 'bg',
        otherRequests,
        testId: 'client-visit-waitlist',
      },
      VISITS_LOOKUP,
    );
  }

  it('is labelled by its state, leads with the services, and names the days it watches', () => {
    const card = waiting();
    expect(card.id).toBe('waitlist-georgi');
    expect(card.kind).toBe('waitlist');
    expect(card.label).toBe('Чака свободен час');
    expect(card.services).toBe('Фейд');
    expect(card.facts).toEqual([{ text: 'чт – пт, следобед', fact: false }]);
    expect(card.testId).toBe('client-visit-waitlist');
  });

  it('counts the person’s other requests at the end of the line', () => {
    expect(line(waiting(1))).toBe('чт – пт, следобед · още 1');
    expect(line(waiting(0))).toBe('чт – пт, следобед');
  });

  it('holds nothing a booked visit holds', () => {
    const card = waiting(2);
    expect(card.figure).toBeNull();
    expect(card.quote).toBeNull();
    expect(card.capsule).toBeNull();
    expect(card.barber).toBeNull();
    expect(card.photos).toEqual([]);
    expect(factsOf(card)).toEqual([]);
  });

  it('says what the row says: one request, one sentence in the lib', () => {
    const row = waitlistRowOf(
      georgiWaitlistRequest(),
      {
        words: WAITLIST_WORDS,
        today: FIXTURE_TODAY,
        locale: 'bg',
        otherRequests: 1,
      },
      VISITS_LOOKUP,
    );
    const card = waiting(1);
    expect(card.accessibleName).toBe(row.accessibleName);
    expect(card.accessibleName).toBe(
      'Фейд, чака свободен час: четвъртък и петък, следобед · още 1',
    );
    expect(card.services).toBe(row.title);
    // The days are the row's second line, word for word.
    expect(row.lines.map((each) => each.text)).toEqual([
      'Чака свободен час · още 1',
      'чт – пт, следобед',
    ]);
  });
});

describe('the card’s figures against a worked party the subject paid alone', () => {
  it('prints the bill when the seats are the whole visit', () => {
    const alone = appointmentOf(
      'appt-alone',
      [
        seatOf('seat-a', '2026-09-10T10:00:00', {
          priceMinor: 3000,
          outcome: seatWorked(sofia('2026-09-10T10:30:00')),
        }),
      ],
      { kind: 'completed' },
      'loc-mladost',
    );
    const card = staffCard(alone, 'last');
    expect(card.figure).toBe(EURO('30,00 €'));
    expect(line(card)).toBe('10.09 · Иван · Младост');
  });
});
