import { describe, expect, it } from 'vitest';
import {
  ArrivalVerb,
  GridEvent as GridEventTag,
  MinuteRange,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  Currency,
  EndMinute,
  LocationId,
  MinuteOfDay,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  appointmentFixture,
  cents,
  deepFreeze,
  seatFixture,
  utcMs,
} from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import {
  type AgendaFlags,
  agendaCardVm,
  allDayMoreEntry,
  blockName,
  bookClientOption,
  daySummaryWords,
  dayTipsWords,
  editorVerb,
  exceptionWord,
  footShown,
  gridBlockEvent,
  gridVisitEvent,
  occupantNeighbours,
  occupyingRows,
  offChairEntry,
  offDateEntry,
  peerRowOf,
  recentClientOption,
  restingChairs,
  rowMarks,
  rowName,
  staffDayWordsOf,
  stateIcon,
  stateLabel,
  verbKeyOf,
  visitEditorWords,
  whenWords,
} from './staff-day.presenter';
import { AgendaRow, type DayRowVm } from './staff-day.vm';

/*
 * THE STAFF DAY'S WORDS, from the app's REAL catalogue in both languages — a
 * key the presenter names and the catalogue lacks fails here, not on a screen.
 * Every input is fixed; nothing reads the wall clock.
 */

const BG = staffDayWordsOf(catalogueTranslate('bg'), '{{minutes}} мин');
const EN = staffDayWordsOf(catalogueTranslate('en'), '{{minutes}} min');

const IVAN = BarberId.of('ivan');
const NOW = utcMs('2026-09-28T06:00:00Z');

const FLAGS: AgendaFlags = {
  avatar: true,
  barberAvatar: true,
  email: true,
  phone: true,
  service: true,
  note: true,
  timeStart: true,
  timeEnd: true,
  timeRelative: true,
  price: false,
  party: true,
  freeTime: false,
};
const NOTHING_ON = Object.fromEntries(
  Object.keys(FLAGS).map((id) => [id, false]),
) as AgendaFlags;

/** A plain confirmed row: Ivan's 10:00–10:30, with nothing marked on it. */
function row(overrides: Partial<DayRowVm> = {}): DayRowVm {
  return {
    agendaRow: AgendaRow.Visit,
    id: 'a#ivan',
    appointmentId: AppointmentId.of('a'),
    revision: 1,
    locationId: LocationId.of('center'),
    seatId: SeatId.of('s'),
    seatIds: [SeatId.of('s')],
    selfSeat: true,
    ownerUserId: UserId.of('u'),
    ownerCustomerId: null,
    partySize: 1,
    seatsHere: 1,
    localDate: FIXTURE_TODAY,
    startMinute: MinuteOfDay.ofProven(600),
    endMinute: EndMinute.ofProven(630),
    startUtcMs: UtcEpochMs.plusMs(NOW, 3_600_000),
    endUtcMs: UtcEpochMs.plusMs(NOW, 5_400_000),
    startLabel: '10:00',
    endLabel: '10:30',
    tag: null,
    priceLabel: null,
    priceCents: null,
    currency: Currency.EUR,
    barberName: 'Иван Колев',
    barberAvatarSrc: null,
    barberTone: 2,
    crossesMidnight: false,
    serviceLabel: 'Фейд',
    clientLabel: 'Георги',
    phone: null,
    phoneHref: null,
    email: null,
    rebooked: false,
    hasNote: false,
    note: null,
    partyLabel: null,
    tipLabel: null,
    tipCents: null,
    discounts: [],
    vouchers: [],
    resolution: null,
    legs: [],
    people: [],
    bookingStatus: BookingStatus.Confirmed,
    rootBookingStatus: BookingStatus.Confirmed,
    arrived: false,
    arrivedAtUtcMs: null,
    primary: null,
    overflow: [],
    terminal: false,
    past: false,
    isNext: false,
    live: false,
    ...overrides,
  };
}

const CARD = { flags: FLAGS, words: BG, nowUtcMs: NOW, lang: 'bg' };

describe('a state’s word and glyph', () => {
  it('says only an hour that did not happen', () => {
    expect(stateLabel(row(), BG)).toBeNull();
    expect(
      stateLabel(row({ bookingStatus: BookingStatus.Completed }), BG),
    ).toBeNull();
    expect(
      stateLabel(row({ bookingStatus: BookingStatus.Cancelled }), BG),
    ).toBe('Отказан');
    expect(
      stateLabel(row({ bookingStatus: BookingStatus.Cancelled }), EN),
    ).toBe('Cancelled');
    expect(stateLabel(row({ bookingStatus: BookingStatus.NoShow }), BG)).toBe(
      'Не дойде',
    );
    expect(stateLabel(row({ bookingStatus: BookingStatus.NoShow }), EN)).toBe(
      'No-show',
    );
  });

  it('draws the same two glyphs', () => {
    expect(stateIcon(row())).toBeNull();
    expect(stateIcon(row({ bookingStatus: BookingStatus.Cancelled }))).toBe(
      'visit.cancelled',
    );
    expect(stateIcon(row({ bookingStatus: BookingStatus.NoShow }))).toBe(
      'visit.noShow',
    );
  });

  it('keeps confirmed and completed silent in the row’s name', () => {
    expect(exceptionWord(BookingStatus.Confirmed, BG)).toBeNull();
    expect(exceptionWord(BookingStatus.Completed, BG)).toBeNull();
    expect(exceptionWord(BookingStatus.Pending, BG)).toBe('Заявен');
    expect(exceptionWord(BookingStatus.Pending, EN)).toBe('Requested');
    expect(rowName(row(), EN)).toBe('More actions — Георги, 10:00');
    expect(rowName(row({ bookingStatus: BookingStatus.Cancelled }), BG)).toBe(
      'Още действия — Георги, 10:00, Отказан',
    );
  });
});

describe('whenWords — the relative gloss, at the tick it is given', () => {
  it('counts a running chair down to its end', () => {
    const live = row({ live: true });
    expect(whenWords(live, NOW, 'bg', BG)).toBe('още 1 ч 30 мин');
    expect(whenWords(live, NOW, 'en', EN)).toBe('1 h 30 min left');
    // The tick reaches the words, and past the end there is no time left.
    expect(whenWords(live, UtcEpochMs.plusMs(NOW, 5_100_000), 'en', EN)).toBe(
      '5 min left',
    );
    expect(whenWords(live, UtcEpochMs.plusMs(NOW, 6_000_000), 'en', EN)).toBe(
      '0 min left',
    );
  });

  it('says they are here instead of counting down to them', () => {
    expect(whenWords(row({ arrived: true }), NOW, 'bg', BG)).toBe('Дошъл');
    expect(whenWords(row({ arrived: true }), NOW, 'en', EN)).toBe('Here');
  });

  it('counts anything else to its start, through `Intl`', () => {
    const later = whenWords(row(), NOW, 'en', EN);
    expect(later).toMatch(/1/);
    const closer = whenWords(
      row(),
      UtcEpochMs.plusMs(NOW, 3_000_000),
      'en',
      EN,
    );
    expect(closer).not.toBe(later);
  });
});

describe('the card’s marks and its foot', () => {
  it('moves the state’s glyph to the foot only when faces are off', () => {
    const cancelled = row({ bookingStatus: BookingStatus.Cancelled });
    expect(rowMarks(cancelled, FLAGS)).toEqual([]);
    expect(rowMarks(cancelled, { ...FLAGS, avatar: false })).toEqual([
      'visit.cancelled',
    ]);
  });

  it('marks a repeat always and a note under its switch', () => {
    const marked = row({ rebooked: true, hasNote: true });
    expect(rowMarks(marked, FLAGS)).toEqual(['visit.repeat', 'visit.note']);
    expect(rowMarks(marked, { ...FLAGS, note: false })).toEqual([
      'visit.repeat',
    ]);
  });

  it('holds a foot only for something to put on it', () => {
    expect(footShown(row(), NOTHING_ON)).toBe(false);
    expect(footShown(row(), { ...NOTHING_ON, barberAvatar: true })).toBe(true);
    expect(footShown(row({ priceLabel: '28,00 €' }), NOTHING_ON)).toBe(false);
    expect(
      footShown(row({ priceLabel: '28,00 €' }), { ...NOTHING_ON, price: true }),
    ).toBe(true);
    expect(footShown(row({ tag: '−5 мин' }), NOTHING_ON)).toBe(true);
    expect(footShown(row({ partyLabel: '1/2' }), NOTHING_ON)).toBe(false);
    expect(
      footShown(row({ partyLabel: '1/2' }), { ...NOTHING_ON, party: true }),
    ).toBe(true);
    expect(footShown(row({ rebooked: true }), NOTHING_ON)).toBe(true);
  });
});

describe('agendaCardVm — what a card prints', () => {
  it('prints the interval under its three switches', () => {
    const card = agendaCardVm(row(), CARD);
    expect(card.start).toBe('10:00');
    expect(card.end).toBe('10:30');
    expect(card.gloss).toBe(whenWords(row(), NOW, 'bg', BG));
    expect(card.glossState).toBe(false);
    const off = agendaCardVm(row(), {
      ...CARD,
      flags: {
        ...FLAGS,
        timeStart: false,
        timeEnd: false,
        timeRelative: false,
      },
    });
    expect([off.start, off.end, off.gloss]).toEqual([null, null, null]);
  });

  it('marks an end on the next day', () => {
    expect(
      agendaCardVm(row({ crossesMidnight: true, endLabel: '00:15' }), CARD).end,
    ).toBe('00:15⁺¹');
  });

  it('says a state where the countdown stood, whatever the switch', () => {
    const card = agendaCardVm(row({ bookingStatus: BookingStatus.NoShow }), {
      ...CARD,
      flags: { ...FLAGS, timeRelative: false },
    });
    expect(card.gloss).toBe('Не дойде');
    expect(card.glossState).toBe(true);
    expect(card.struck).toBe(true);
    expect(card.stateIcon).toBe('visit.noShow');
  });

  it('keeps the tag off an hour that did not happen', () => {
    expect(agendaCardVm(row({ tag: '−5 мин' }), CARD).tag).toBe('−5 мин');
    expect(
      agendaCardVm(
        row({ tag: '−5 мин', bookingStatus: BookingStatus.Cancelled }),
        CARD,
      ).tag,
    ).toBeNull();
  });

  it('lists the facts in the card’s order, each under its switch', () => {
    const full = row({
      email: 'g@x.bg' as DayRowVm['email'],
      phone: '+359 88',
    });
    expect(agendaCardVm(full, CARD).lines).toEqual([
      { text: 'g@x.bg', icon: 'contact.email', testId: 'staff-visit-email' },
      { text: '+359 88', icon: 'contact.phone', testId: 'staff-visit-phone' },
      { text: 'Фейд' },
    ]);
    expect(
      agendaCardVm(full, {
        ...CARD,
        flags: { ...FLAGS, email: false, phone: false, service: false },
      }).lines,
    ).toEqual([]);
  });

  it('prints the price and the share under their switches', () => {
    const priced = row({ priceLabel: '28,00 €', partyLabel: '1/2' });
    expect(agendaCardVm(priced, CARD).price).toBeNull();
    expect(agendaCardVm(priced, CARD).partyShare).toBe('1/2');
    expect(
      agendaCardVm(priced, { ...CARD, flags: { ...FLAGS, price: true } }).price,
    ).toBe('28,00 €');
    expect(
      agendaCardVm(priced, { ...CARD, flags: { ...FLAGS, party: false } })
        .partyShare,
    ).toBeNull();
  });

  it('counts the rest of the chair on the face’s badge', () => {
    expect(agendaCardVm(row({ seatsHere: 3 }), CARD).guestsMark).toBe('+2');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(row());
    expect(agendaCardVm(frozen, CARD)).toEqual(agendaCardVm(frozen, CARD));
  });
});

describe('the grid’s blocks', () => {
  it('tells a block’s whole story to a screen reader', () => {
    expect(blockName(row(), EN)).toBe(
      'Георги, Фейд, 10:00–10:30, Иван Колев, Confirmed',
    );
    expect(blockName(row({ partySize: 2 }), BG)).toBe(
      'Георги, Фейд, 10:00–10:30, Иван Колев, Потвърден, Група от 2',
    );
  });

  it('says a hollow hour under the name, and the service otherwise', () => {
    expect(gridVisitEvent(row(), false, BG).detail).toBe('Фейд');
    expect(
      gridVisitEvent(row({ bookingStatus: BookingStatus.NoShow }), false, BG)
        .detail,
    ).toBe('Не дойде');
  });

  it('attributes a block only in a merged column', () => {
    expect(gridVisitEvent(row(), true, BG).attribution).toBe('Иван Колев');
    expect(gridVisitEvent(row(), false, BG).attribution).toBeNull();
  });

  it('shares the sheet’s glyph while they are here, the outcome’s after', () => {
    expect(gridVisitEvent(row(), false, BG).statusIcon).toBeNull();
    expect(gridVisitEvent(row({ arrived: true }), false, BG).statusIcon).toBe(
      'visit.arrived',
    );
    expect(
      gridVisitEvent(
        row({ arrived: true, bookingStatus: BookingStatus.Completed }),
        false,
        BG,
      ).statusIcon,
    ).toBe('checklist.done');
  });

  it('names a carve-out by what and when, on a key the page resolves', () => {
    const interval = MinuteRange.of(
      MinuteOfDay.ofProven(780),
      EndMinute.ofProven(840),
    );
    const facts = {
      barberId: IVAN,
      barberName: 'Иван Колев',
      localDate: FIXTURE_TODAY,
      shopNow: null,
      attribute: false,
    };
    const block = gridBlockEvent(interval, facts, BG);
    expect(block).toMatchObject({
      id: `block:ivan:${FIXTURE_TODAY}:780`,
      gridEvent: GridEventTag.Block,
      title: 'Блокирано',
      accessibleName: 'Блокирано, 13:00–14:00',
      barberTone: null,
      attribution: null,
      past: false,
      statusIcon: 'booking.blocked',
    });
    expect(gridBlockEvent(interval, facts, EN).accessibleName).toBe(
      'Blocked, 13:00–14:00',
    );
    expect(
      gridBlockEvent(interval, { ...facts, attribute: true }, BG).attribution,
    ).toBe('Иван Колев');
    const after = ZonedTimeSystem.shopNow(
      utcMs('2026-09-28T12:00:00Z'),
      FIXTURE_TIME_ZONE,
    );
    expect(
      gridBlockEvent(interval, { ...facts, shopNow: after }, BG).past,
    ).toBe(true);
  });
});

describe('the all-day band', () => {
  it('names the fact in a chair’s own column', () => {
    expect(offChairEntry(IVAN, 'Иван Колев', 3, BG)).toEqual({
      key: IVAN,
      label: 'Почивен ден',
      shortLabel: 'Почивен ден',
      initial: 'И',
      tone: 3,
      accessibleName: 'Почивен ден',
    });
  });

  it('names the person in a date’s column', () => {
    expect(offDateEntry(IVAN, 'Иван Колев', 3, BG)).toEqual({
      key: IVAN,
      label: 'Иван почива',
      shortLabel: 'Иван',
      initial: 'И',
      tone: 3,
      accessibleName: 'Иван Колев почива',
    });
    expect(offDateEntry(IVAN, 'Ivan Kolev', 3, EN).accessibleName).toBe(
      'Ivan Kolev off',
    );
  });

  it('says how many more, about no one', () => {
    expect(allDayMoreEntry(2, BG)).toEqual({
      key: 'more',
      label: '+2',
      shortLabel: '+2',
      initial: '+2',
      tone: null,
      accessibleName: 'още 2',
    });
    expect(allDayMoreEntry(2, EN).accessibleName).toBe('2 more');
  });

  it('names a resting chair by the catalogue, by its id when it has none', () => {
    const niko = BarberId.of('niko');
    expect(
      restingChairs(
        [IVAN, niko],
        [{ id: IVAN, name: { bg: 'Иван', en: 'Ivan' } }],
        { text: (localized) => localized.bg },
        () => 4,
      ),
    ).toEqual([
      { id: IVAN, name: 'Иван', tone: 4 },
      { id: niko, name: 'niko', tone: 4 },
    ]);
  });
});

describe('the day’s line', () => {
  it('words the unsold minutes', () => {
    expect(daySummaryWords(150, BG)).toBe('2 ч 30 мин свободни');
    expect(daySummaryWords(45, EN)).toBe('45 min free');
  });

  it('words the day’s tips in their currency', () => {
    const total = { amountCents: cents(1250), currency: Currency.EUR };
    expect(dayTipsWords(total, 'bg', BG)).toContain('бакшиши');
    expect(dayTipsWords(total, 'bg', BG)).toContain('12,50');
    expect(dayTipsWords(total, 'en', EN)).toContain('in tips');
  });
});

describe('the sheet’s words', () => {
  it('words a reopening for what it undoes', () => {
    expect(verbKeyOf(BookingStatus.NoShow, BookingStatus.Confirmed)).toBe(
      'staff.day.act.reopen',
    );
    expect(verbKeyOf(BookingStatus.Completed, BookingStatus.Confirmed)).toBe(
      'staff.day.act.reopenCompleted',
    );
    expect(verbKeyOf(BookingStatus.Cancelled, BookingStatus.Confirmed)).toBe(
      'staff.day.act.reinstate',
    );
    expect(verbKeyOf(BookingStatus.Confirmed, ArrivalVerb.Arrived)).toBe(
      'staff.day.act.arrived',
    );
  });

  it('has one red in the menu', () => {
    const on = { bookingStatus: BookingStatus.Confirmed };
    expect(editorVerb(on, BookingStatus.Cancelled, BG).destructive).toBe(true);
    expect(editorVerb(on, BookingStatus.NoShow, BG).destructive).toBe(false);
    expect(
      editorVerb(
        { bookingStatus: BookingStatus.NoShow },
        BookingStatus.Confirmed,
        BG,
      ).label,
    ).toBe('Върни часа');
    expect(
      editorVerb(
        { bookingStatus: BookingStatus.NoShow },
        BookingStatus.Confirmed,
        EN,
      ).label,
    ).toBe('Undo no-show');
  });

  it('words the head and the verbs of a row', () => {
    const words = visitEditorWords(
      row({
        rebooked: true,
        primary: BookingStatus.Completed,
        overflow: [BookingStatus.Cancelled],
      }),
      BG,
    );
    expect(words.clientMeta).toBe('Редовен');
    expect(words.statusLabel).toBe('Потвърден');
    expect(words.primaryVerb?.label).toBe('Готово');
    expect(words.overflowVerbs.map((verb) => verb.rowVerb)).toEqual([
      BookingStatus.Cancelled,
    ]);
    expect(visitEditorWords(row(), EN).clientMeta).toBeNull();
    expect(visitEditorWords(row(), EN).primaryVerb).toBeNull();
  });

  it('lists a peer by its chair and its span', () => {
    expect(peerRowOf(row())).toEqual({
      rowId: 'a#ivan',
      clientLabel: 'Георги',
      chairName: 'Иван Колев',
      chairTone: 2,
      timeLabel: '10:00 – 10:30',
    });
  });
});

describe('the frame’s neighbours', () => {
  const beside = appointmentFixture({ id: AppointmentId.of('beside') });
  const chair = seatFixture().barberId;

  it('reads a day’s documents, one per seat, by the booking’s name', () => {
    const named = appointmentFixture({
      id: AppointmentId.of('named'),
      contactName: 'Стоян',
    });
    const [neighbour] = occupantNeighbours([named], chair, null, 4, BG);
    expect(neighbour?.name).toBe('Стоян');
    expect(neighbour?.tone).toBe(4);
    expect(neighbour?.startMinute).toBe(seatFixture().startMinutes);
    expect(occupantNeighbours([beside], chair, null, 4, BG)[0]?.name).toBe(
      'Клиент без име',
    );
    expect(occupantNeighbours([beside], chair, null, 4, EN)[0]?.name).toBe(
      'Unnamed client',
    );
    expect(occupantNeighbours([beside], chair, beside.id, 4, BG)).toEqual([]);
  });

  it('reads the shown day’s rows, the system saying which occupy', () => {
    const lane = {
      barberId: chair,
      barberName: 'Иван',
      avatarSrc: null,
      entries: [
        row({ appointmentId: beside.id, clientLabel: 'Георги' }),
        row({ appointmentId: AppointmentId.of('gone') }),
      ],
      rostered: true,
      failed: false,
    };
    expect(occupyingRows(undefined, [beside], null)).toEqual([]);
    expect(occupyingRows(lane, [beside], null).map((n) => n.name)).toEqual([
      'Георги',
    ]);
    expect(occupyingRows(lane, [beside], beside.id)).toEqual([]);
  });
});

describe('the add-client page’s rows', () => {
  const userId = UserId.of('u');
  const visit = appointmentFixture({ contactName: 'Георги' });

  it('dates a recent client’s last visit', () => {
    const option = recentClientOption(userId, visit, {
      words: BG,
      zoneKnown: true,
      locale: 'en',
    });
    expect(option.label).toBe('Георги');
    expect(option.meta).toBe('посл. Sep 28');
    expect(
      recentClientOption(userId, appointmentFixture(), {
        words: EN,
        zoneKnown: false,
        locale: 'en',
      }),
    ).toMatchObject({ label: 'Unnamed client', meta: 'last ' });
  });

  it('carries the book’s contact as stored', () => {
    expect(bookClientOption(userId, visit, 'Георги')).toMatchObject({
      label: 'Георги',
      meta: null,
      phone: null,
      phoneHref: null,
    });
  });
});
