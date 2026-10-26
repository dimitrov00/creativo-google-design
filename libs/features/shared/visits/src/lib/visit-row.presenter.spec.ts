import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Appointment, WaitlistRequest } from '@core/entities';
import {
  CancellationReason,
  CancelledBy,
  CancelledSide,
  Daypart,
  type Seat,
  SeatOutcome,
  VisitGrain,
  VisitPerspective,
  VisitRowOutcome,
  VoucherCode,
  type VoucherRedemption,
} from '@core/components';
import {
  AppointmentId,
  BookingStatus,
  GiftVoucherId,
  type LocalDate,
  type MinuteOfDay,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { EUR, cents, localDate } from '@core/testing';
import { dayRange } from './day-range';
import {
  type SeatSpec,
  VISITS_TIME_ZONE,
  type VisitStatusSpec,
  sofia,
  sofiaWall,
  visitOf,
  visitSeat,
  waitlistOf,
} from './testing/visit-fixtures';
import {
  type VisitRowOptions,
  type VisitBuilderWords,
  type VisitTranslate,
  visitClockOf,
  visitRowOf,
  visitWaitlistWordsOf,
  visitWordsOf,
  waitlistRowOf,
} from './visit-row.presenter';
import type { VisitLookup } from './visit-lookup.contracts';
import { TrailingFactFace, VisitRowEntry } from './visit-row.vm';
import { sectionVisits } from './visit-sections';

// ── The app's own words ──────────────────────────────────────────────────
//
// The rows are worded from the real catalogue, so a key the builders name
// and the catalogue lacks fails here, not on a screen.

type Catalogue = Record<string, unknown>;

function catalogue(lang: 'bg' | 'en'): Catalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Catalogue;
}

/** Transloco's reading, in miniature: a dotted key, `{{param}}` filled in. */
function translator(tree: Catalogue): VisitTranslate {
  return (key, params = {}) => {
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

const BG = translator(catalogue('bg'));
const STAFF_WORDS = visitWordsOf(BG, 'bg', VisitPerspective.Staff);
const CLIENT_WORDS = visitWordsOf(BG, 'bg', VisitPerspective.Client);
const WAITLIST_WORDS = visitWaitlistWordsOf(BG);

// ── The shop ─────────────────────────────────────────────────────────────

const GEORGI = UserId.of('client-georgi');
const IVO = UserId.of('client-ivo');

const SERVICES = new Map([
  ['svc-fade', 'Фейд'],
  ['svc-beard', 'Брада'],
]);
const BARBERS = new Map([
  ['barber-ivan', 'Иван'],
  ['barber-petar', 'Петър'],
]);

/** Two shops, so a worked visit names its own. */
const LOOKUP: VisitLookup = {
  serviceName: (id) => SERVICES.get(id) ?? null,
  barberName: (id) => BARBERS.get(id) ?? null,
  barberAvatarSrc: (id) =>
    id === 'barber-ivan' ? 'https://example.test/ivan.jpg' : null,
  locationName: (id) => (id === 'loc-center' ? 'Център' : null),
  locationCount: 2,
};

/** Monday 28 September 2026, 09:00 in Sofia. */
const NOW_MS = sofia('2026-09-28T09:00:00');
/** The same reading as the shop's "now", derived once as a host derives it. */
const NOW = ZonedTimeSystem.shopNow(NOW_MS, VISITS_TIME_ZONE);

/** A wall-clock reading in Sofia as the row carries its start: the shop day and minute. */
function wall(iso: string): {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
} {
  const start = sofiaWall(iso);
  return { localDate: start.localDate, startMinutes: start.minute };
}

/** Each seat's own start, so a visit knows its shop day (a seat holds only its minute). */
const SEAT_START = new WeakMap<Seat, string>();

/** One seat of Георги's book (`visitSeat`), a guest named «Гост» when the spec gives none. */
function seat(startIso: string, spec: SeatSpec = {}): Seat {
  const built = visitSeat(startIso, {
    ...spec,
    who: spec.who ?? (spec.guest ? 'Гост' : GEORGI),
  });
  SEAT_START.set(built, startIso);
  return built;
}

const seatWorked = (at: UtcEpochMs): SeatOutcome => SeatOutcome.worked(at);
const seatNoShow = (at: UtcEpochMs): SeatOutcome => SeatOutcome.noShow(at);

/** A seat called off — by whom, for which reason. */
function seatCancelled(
  at: UtcEpochMs,
  by: 'client' | 'staff',
  reason: CancellationReason,
  window: null,
): SeatOutcome {
  return SeatOutcome.cancelled(
    at,
    by === 'client' ? CancelledBy.Client : CancelledBy.Staff,
    reason,
    window,
  );
}

/**
 * A flat visit at the centre (`visitOf`), on its first seat's day, in
 * `status.bookingStatus`. A cancelled visit's `cancellationReason` is the
 * legacy whole-visit word: the flat document keeps the reason on each SEAT
 * (`seat()`'s outcome), so the word here only names the case.
 */
function visit(
  id: string,
  seats: readonly Seat[],
  status: {
    readonly bookingStatus: VisitStatusSpec;
    readonly cancellationReason?: string;
  },
  extras: {
    readonly note?: string;
    readonly discounted?: boolean;
    readonly vouchers?: readonly VoucherRedemption[];
  } = {},
): Appointment {
  const first = seats[0];
  const built = visitOf(
    id,
    'loc-center',
    seats,
    status.bookingStatus,
    (first === undefined ? null : SEAT_START.get(first)) ??
      '2026-09-04T10:00:00',
    {
      note: extras.note,
      discountAtIso: extras.discounted ? '2026-09-04T10:40:00' : undefined,
    },
  );
  return extras.vouchers === undefined
    ? built
    : { ...built, voucherRedemptions: extras.vouchers };
}

const WORKED_AT = sofia('2026-09-04T10:40:00');

/** Георги's last visit: a fade with Иван at the centre, in his own words. */
const LAST_VISIT = visit(
  'appt-sep',
  [seat('2026-09-04T10:00:00', { outcome: seatWorked(WORKED_AT) })],
  { bookingStatus: 'completed' },
  { note: 'Къса отстрани, по-дълго отгоре' },
);

function staffOptions(
  overrides: Partial<VisitRowOptions> = {},
): VisitRowOptions {
  return {
    perspective: VisitPerspective.Staff,
    grain: VisitGrain.Year,
    subjectUserId: GEORGI,
    currentAppointmentId: null,
    now: NOW,
    timeZone: VISITS_TIME_ZONE,
    locale: 'bg',
    words: STAFF_WORDS,
    ...overrides,
  };
}

/** `formatCents`'s bg form keeps the sign on the figure's line: a no-break space. */
const EURO = (text: string) => text.replaceAll(' €', ' €');

describe('visitRowOf · the staff card', () => {
  it('tells a worked visit by who and where, with what was paid, its photos and the client’s own words', () => {
    const row = visitRowOf(LAST_VISIT, staffOptions({ photoCount: 1 }), LOOKUP);

    expect(row).toEqual({
      id: 'appt-sep',
      visitRowEntry: VisitRowEntry.Visit,
      ...wall('2026-09-04T10:00:00'),
      sectionKey: '2026',
      upcoming: false,
      // Under a year the tile says the month, from the catalogue's table
      // (LR4): `Intl`'s short month is numeric in bg («09»), and a caption
      // is a label, not a fact line.
      tile: { caption: 'септ.', day: 4, tone: 'past' },
      leadingIcon: null,
      title: 'Фейд',
      struck: false,
      // Never the date: the tile and the section own it. The shop only
      // because the lookup knows two. The barber is the run the ellipsis
      // never takes.
      lines: [{ text: 'Център · Иван', hold: ' · Иван' }],
      quote: '„Къса отстрани, по-дълго отгоре“',
      // The trailing edge is the barber's face, as on the client's own
      // list (revision 3 §2.5)…
      trailing: {
        avatarSrc: 'https://example.test/ivan.jpg',
        name: 'Иван',
        several: false,
      },
      // …and what was paid ends the second line, the staff's fact.
      trailingFact: {
        trailingFactFace: TrailingFactFace.Amount,
        text: EURO('27,50 €'),
        emphasis: 'primary',
        struck: false,
      },
      marks: [{ icon: 'client.photos', label: '1 снимка', count: 1 }],
      outcome: VisitRowOutcome.Worked,
      bookingStatus: BookingStatus.Completed,
      accessibleName: EURO(
        'Фейд, 4 септември в 10:00, Иван, Център, 27,50 €, 1 снимка, от клиента: „Къса отстрани, по-дълго отгоре“',
      ),
      testId: 'history-row-appt-sep',
    });
  });

  it('names the shop only when there is more than one', () => {
    const row = visitRowOf(LAST_VISIT, staffOptions(), {
      ...LOOKUP,
      locationCount: 1,
    });
    expect(row.lines).toEqual([{ text: 'Иван' }]);
    expect(row.accessibleName).toBe(
      EURO(
        'Фейд, 4 септември в 10:00, Иван, 27,50 €, от клиента: „Къса отстрани, по-дълго отгоре“',
      ),
    );
  });

  it('strikes a cancellation, says who called it off and what was booked', () => {
    const cancelled = visit(
      'appt-jul-cancelled',
      [
        seat('2026-07-16T10:00:00', {
          priceMinor: 1750,
          outcome: seatCancelled(
            sofia('2026-07-15T18:00:00'),
            'client',
            CancellationReason.ClientChangedPlans,
            null,
          ),
        }),
      ],
      {
        bookingStatus: 'cancelled',
        cancellationReason: 'client_changed_plans',
      },
    );
    const row = visitRowOf(cancelled, staffOptions(), LOOKUP);
    expect(row.tile).toEqual({ caption: 'юли', day: 16, tone: 'hollow' });
    expect(row.struck).toBe(true);
    // The word on a line of its own, first and whole, the barber under it
    // (review r5: on the line it shared with the barber, beside the struck
    // amount, the ellipsis took its tail — «Отказан от … · Иван» at 390).
    expect(row.lines).toEqual([
      { text: 'Отказан от клиента' },
      { text: 'Иван' },
    ]);
    expect(row.trailingFact).toEqual({
      trailingFactFace: TrailingFactFace.Amount,
      text: EURO('17,50 €'),
      emphasis: 'secondary',
      struck: true,
    });
    expect(row.trailing).toMatchObject({ name: 'Иван' });
    expect(row.marks).toEqual([]);
    expect(row.outcome).toBe(VisitRowOutcome.Cancelled);
    expect(row.accessibleName).toBe(
      EURO('Фейд, 16 юли в 10:00, Иван, Отказан от клиента, 17,50 €'),
    );

    // The shop's own cancellation is the shop's.
    const byShop = visit(
      'appt-jul-closed',
      [
        seat('2026-07-18T10:00:00', {
          outcome: seatCancelled(
            sofia('2026-07-17T09:00:00'),
            'staff',
            CancellationReason.StaffShopClosure,
            null,
          ),
        }),
      ],
      { bookingStatus: 'cancelled', cancellationReason: 'staff_shop_closure' },
    );
    expect(visitRowOf(byShop, staffOptions(), LOOKUP).lines).toEqual([
      { text: 'Отказан от салона' },
      { text: 'Иван' },
    ]);

    // With company, the party and the barber share the line under the
    // word, the barber still held against the ellipsis.
    const withCompany = visit(
      'appt-jul-party-cancelled',
      [
        seat('2026-07-16T10:00:00', {
          id: 'seat-georgi-cancelled',
          outcome: seatCancelled(
            sofia('2026-07-15T18:00:00'),
            'client',
            CancellationReason.ClientChangedPlans,
            null,
          ),
        }),
        seat('2026-07-16T10:00:00', {
          id: 'seat-ivo-cancelled',
          who: IVO,
          relationship: 'companion',
          service: 'svc-beard',
          barber: 'barber-petar',
          outcome: seatCancelled(
            sofia('2026-07-15T18:00:00'),
            'client',
            CancellationReason.ClientChangedPlans,
            null,
          ),
        }),
      ],
      {
        bookingStatus: 'cancelled',
        cancellationReason: 'client_changed_plans',
      },
    );
    expect(visitRowOf(withCompany, staffOptions(), LOOKUP).lines).toEqual([
      { text: 'Отказан от клиента' },
      { text: 'с още 1 · Иван', hold: ' · Иван' },
    ]);
  });

  it('strikes a no-show in full ink, the warning on the glyph, and prices nothing', () => {
    const noShow = visit(
      'appt-jul-no-show',
      [
        seat('2026-07-07T10:00:00', {
          outcome: seatNoShow(sofia('2026-07-07T10:20:00')),
        }),
      ],
      { bookingStatus: 'no_show' },
    );
    const row = visitRowOf(noShow, staffOptions(), LOOKUP);
    expect(row.tile?.tone).toBe('hollow');
    expect(row.struck).toBe(true);
    expect(row.lines).toEqual([{ text: 'Иван' }]);
    expect(row.trailingFact).toEqual({
      trailingFactFace: TrailingFactFace.Status,
      icon: 'visit.noShow',
      text: 'Не дойде',
      tone: 'warning',
    });
    expect(row.trailing).toMatchObject({ name: 'Иван' });
    expect(row.accessibleName).toBe('Фейд, 7 юли в 10:00, Иван, Не дойде');
  });

  it('files an hour still to come under «Предстоящи», saying when in the day — nothing paid yet', () => {
    const ahead = visit('appt-oct', [seat('2026-10-02T10:00:00')], {
      bookingStatus: 'confirmed',
    });
    const row = visitRowOf(ahead, staffOptions(), LOOKUP);
    expect(row.upcoming).toBe(true);
    expect(row.sectionKey).toBe('upcoming');
    expect(row.tile).toEqual({ caption: 'окт.', day: 2, tone: 'upcoming' });
    expect(row.lines).toEqual([{ text: 'пт, 10:00 · Иван', hold: ' · Иван' }]);
    // No fact to state: nothing is paid and nothing is pending. The face
    // still stands on the trailing edge.
    expect(row.trailingFact).toBeNull();
    expect(row.trailing).toEqual({
      avatarSrc: 'https://example.test/ivan.jpg',
      name: 'Иван',
      several: false,
    });
    expect(row.marks).toEqual([]);
    expect(row.accessibleName).toBe('Фейд, 2 октомври в 10:00, Иван');
  });

  it('names the month on an upcoming row’s tile by month too — the weekday already leads its line (OR-56 b)', () => {
    const options = staffOptions({ grain: VisitGrain.Month });
    const near = visitRowOf(
      visit('appt-oct', [seat('2026-10-02T10:00:00')], {
        bookingStatus: 'confirmed',
      }),
      options,
      LOOKUP,
    );
    expect(near.tile).toEqual({ caption: 'окт.', day: 2, tone: 'upcoming' });
    expect(near.lines).toEqual([{ text: 'пт, 10:00 · Иван', hold: ' · Иван' }]);
    const far = visitRowOf(
      visit('appt-far', [seat('2030-06-01T10:00:00')], {
        bookingStatus: 'confirmed',
      }),
      options,
      LOOKUP,
    );
    expect(far.tile?.caption).toBe('юни');
    expect(far.lines).toEqual([{ text: 'сб, 10:00 · Иван', hold: ' · Иван' }]);
    // A dated row by month keeps the weekday on its tile.
    expect(visitRowOf(LAST_VISIT, options, LOOKUP).tile?.caption).toBe('пт');
  });

  it('says a request the shop has not confirmed is «Заявен»', () => {
    const pending = visit('appt-pending', [seat('2026-10-02T10:00:00')], {
      bookingStatus: 'pending',
    });
    const row = visitRowOf(pending, staffOptions(), LOOKUP);
    expect(row.trailingFact).toEqual({
      trailingFactFace: TrailingFactFace.Status,
      icon: 'visit.pending',
      text: 'Заявен',
      tone: 'neutral',
    });
    expect(row.accessibleName).toBe('Фейд, 2 октомври в 10:00, Иван, Заявен');
  });

  it('marks the visit on screen «Този час» wherever its date files it, and leads with its time alone', () => {
    const today = visit('appt-today', [seat('2026-09-28T10:00:00')], {
      bookingStatus: 'confirmed',
    });
    const row = visitRowOf(
      today,
      staffOptions({ currentAppointmentId: AppointmentId.of('appt-today') }),
      LOOKUP,
    );
    expect(row.upcoming).toBe(true);
    // No day word: the tile and the capsule own the day, and the line must
    // leave the capsule (and a settled visit's marks) room on the second
    // line at 390 (review 2, fix-visits-r1). The sentence still says it.
    expect(row.lines).toEqual([{ text: '10:00 · Иван', hold: ' · Иван' }]);
    expect(row.trailingFact).toEqual({
      trailingFactFace: TrailingFactFace.Badge,
      text: 'Този час',
    });
    expect(row.trailing).toMatchObject({ name: 'Иван' });
    expect(row.accessibleName).toBe('Фейд, днес, 10:00, Иван, Този час');

    // Settled, it is still the visit on screen — and no longer ahead.
    const settled = visit(
      'appt-today',
      [seat('2026-09-28T08:00:00', { outcome: seatWorked(NOW_MS) })],
      { bookingStatus: 'completed' },
    );
    const worked = visitRowOf(
      settled,
      staffOptions({ currentAppointmentId: AppointmentId.of('appt-today') }),
      LOOKUP,
    );
    expect(worked.upcoming).toBe(false);
    expect(worked.sectionKey).toBe('2026');
    expect(worked.trailingFact).toEqual({
      trailingFactFace: TrailingFactFace.Badge,
      text: 'Този час',
    });
    // Settled and on screen: the time, never the shop (the location's own
    // rule), and the photos' mark beside the capsule is what the shorter
    // line makes room for.
    expect(worked.lines).toEqual([{ text: '08:00 · Иван', hold: ' · Иван' }]);
  });

  describe('a party', () => {
    // Георги booked for himself and Иво: Иво's beard with Петър, and Иво
    // did not come while Георги had his fade.
    const party = visit(
      'appt-party',
      [
        seat('2026-09-04T10:00:00', {
          id: 'seat-georgi',
          outcome: seatWorked(WORKED_AT),
        }),
        seat('2026-09-04T10:00:00', {
          id: 'seat-ivo',
          who: IVO,
          relationship: 'companion',
          service: 'svc-beard',
          barber: 'barber-petar',
          priceMinor: 1200,
          outcome: seatNoShow(WORKED_AT),
        }),
      ],
      { bookingStatus: 'completed' },
      { note: 'Ще дойдем двамата', discounted: true },
    );

    it('tells the subject’s own story — their seats, their outcome, their share, the others counted', () => {
      const georgi = visitRowOf(party, staffOptions(), LOOKUP);
      // A companion's no-show says nothing about the booker.
      expect(georgi.outcome).toBe(VisitRowOutcome.Worked);
      expect(georgi.struck).toBe(false);
      expect(georgi.title).toBe('Фейд');
      expect(georgi.lines).toEqual([
        { text: 'Център · с още 1 · Иван', hold: ' · Иван' },
      ]);
      // His seat's own price: a root discount is not pro-rated (Q2), so the
      // row carries no discount mark beside an undiscounted figure.
      expect(georgi.trailingFact).toEqual({
        trailingFactFace: TrailingFactFace.Amount,
        text: EURO('27,50 €'),
        emphasis: 'primary',
        struck: false,
      });
      // The face is of who cut HIS seat, not the companion's.
      expect(georgi.trailing).toMatchObject({ name: 'Иван' });
      expect(georgi.marks).toEqual([]);
      // He booked it: the words are his.
      expect(georgi.quote).toBe('„Ще дойдем двамата“');

      const ivo = visitRowOf(
        party,
        staffOptions({ subjectUserId: IVO }),
        LOOKUP,
      );
      expect(ivo.outcome).toBe(VisitRowOutcome.NoShow);
      expect(ivo.struck).toBe(true);
      expect(ivo.title).toBe('Брада');
      expect(ivo.lines).toEqual([
        { text: 'с още 1 · Петър', hold: ' · Петър' },
      ]);
      expect(ivo.trailingFact).toMatchObject({
        trailingFactFace: TrailingFactFace.Status,
        text: 'Не дойде',
      });
      expect(ivo.trailing).toEqual({
        avatarSrc: null,
        name: 'Петър',
        several: false,
      });
      // Someone else booked it: the words are the booker's, not Иво's.
      expect(ivo.quote).toBeNull();
      expect(ivo.accessibleName).toBe(
        'Брада, 4 септември в 10:00, Петър, с още 1, Не дойде',
      );
    });

    it('counts a guest by the seat’s name, once however many services they had', () => {
      const withGuest = visit(
        'appt-guest-party',
        [
          seat('2026-09-04T10:00:00', {
            id: 'seat-georgi',
            outcome: seatWorked(WORKED_AT),
          }),
          seat('2026-09-04T10:00:00', {
            id: 'seat-guest-cut',
            guest: true,
            who: 'Син',
            barber: 'barber-petar',
            outcome: seatWorked(WORKED_AT),
          }),
          seat('2026-09-04T10:30:00', {
            id: 'seat-guest-beard',
            guest: true,
            who: 'Син',
            service: 'svc-beard',
            barber: 'barber-petar',
            outcome: seatWorked(WORKED_AT),
          }),
        ],
        { bookingStatus: 'completed' },
      );
      expect(visitRowOf(withGuest, staffOptions(), LOOKUP).lines).toEqual([
        { text: 'Център · с още 1 · Иван', hold: ' · Иван' },
      ]);
    });
  });

  it('marks a discount where the figure is the discounted bill', () => {
    const discounted = visit(
      'appt-discounted',
      [seat('2026-09-04T10:00:00', { outcome: seatWorked(WORKED_AT) })],
      { bookingStatus: 'completed' },
      { discounted: true },
    );
    const row = visitRowOf(discounted, staffOptions(), LOOKUP);
    expect(row.trailingFact).toMatchObject({ text: EURO('24,75 €') });
    expect(row.marks).toEqual([
      { icon: 'promo.coupon', label: 'с отстъпка', count: null },
    ]);
    expect(row.accessibleName).toBe(
      EURO('Фейд, 4 септември в 10:00, Иван, Център, 24,75 €, с отстъпка'),
    );
  });

  it('withholds the client’s words from a viewer who may not read free text', () => {
    const row = visitRowOf(
      LAST_VISIT,
      staffOptions({ clientWords: false }),
      LOOKUP,
    );
    expect(row.quote).toBeNull();
    expect(row.accessibleName).not.toContain('Къса');
  });

  it('adds the year to a date outside the current one, and says a barber the catalogue lost is «Бръснар»', () => {
    const old = visit(
      'appt-2025',
      [
        seat('2025-03-06T10:00:00', {
          barber: 'barber-gone',
          service: 'svc-gone',
          outcome: seatWorked(sofia('2025-03-06T10:40:00')),
        }),
      ],
      { bookingStatus: 'completed' },
    );
    const row = visitRowOf(old, staffOptions(), LOOKUP);
    expect(row.sectionKey).toBe('2025');
    expect(row.title).toBe('Посещение');
    expect(row.lines).toEqual([
      { text: 'Център · Бръснар', hold: ' · Бръснар' },
    ]);
    expect(row.accessibleName).toBe(
      EURO('Посещение, 6 март 2025 г. в 10:00, Бръснар, Център, 27,50 €'),
    );
  });

  it('lists every barber of the subject’s seats by name', () => {
    const two = visit(
      'appt-two-barbers',
      [
        seat('2026-09-04T10:00:00', {
          id: 'seat-cut',
          outcome: seatWorked(WORKED_AT),
        }),
        seat('2026-09-04T10:30:00', {
          id: 'seat-beard',
          service: 'svc-beard',
          barber: 'barber-petar',
          priceMinor: 1200,
          outcome: seatWorked(WORKED_AT),
        }),
      ],
      { bookingStatus: 'completed' },
    );
    const row = visitRowOf(two, staffOptions(), LOOKUP);
    expect(row.title).toBe('Фейд · Брада');
    expect(row.lines).toEqual([
      { text: 'Център · Иван и Петър', hold: ' · Иван и Петър' },
    ]);
    // Both seats are his: the figure is the bill.
    expect(row.trailingFact).toMatchObject({ text: EURO('39,50 €') });
    // Cut by several: no one face, the group by its count. The row draws
    // none and keeps the face's column (revision 3 §2.5).
    expect(row.trailing).toEqual({
      avatarSrc: null,
      name: '2 бръснари',
      several: true,
    });
  });

  it('puts the face of who cut on the trailing edge, by the name the shop knows them by', () => {
    // The line goes by first name; the face is named whole, for its
    // monogram and for whoever reads the picture's name.
    const lookup: VisitLookup = {
      ...LOOKUP,
      barberName: (id) => (id === 'barber-ivan' ? 'Иван Колев' : null),
    };
    expect(visitRowOf(LAST_VISIT, staffOptions(), lookup).trailing).toEqual({
      avatarSrc: 'https://example.test/ivan.jpg',
      name: 'Иван Колев',
      several: false,
    });

    // A barber the catalogue lost is still one barber: «Бръснар», no picture.
    const gone = visit(
      'appt-gone',
      [
        seat('2026-09-04T10:00:00', {
          barber: 'barber-gone',
          outcome: seatWorked(WORKED_AT),
        }),
      ],
      { bookingStatus: 'completed' },
    );
    expect(visitRowOf(gone, staffOptions(), LOOKUP).trailing).toEqual({
      avatarSrc: null,
      name: 'Бръснар',
      several: false,
    });
  });

  describe('a voucher', () => {
    const redemption = (reversed: boolean): VoucherRedemption => ({
      voucherId: GiftVoucherId.of('voucher-1'),
      code: VoucherCode.of('GIFT-50'),
      amountCents: cents(2750),
      balanceAfterCents: cents(2250),
      currency: EUR,
      appliedAtUtcMs: sofia('2026-09-04T10:40:00'),
      reversedAtUtcMs: reversed ? sofia('2026-09-04T10:45:00') : null,
    });

    it('marks a visit a voucher paid for, after its photos and its discount', () => {
      const paid = visit(
        'appt-voucher',
        [seat('2026-09-04T10:00:00', { outcome: seatWorked(WORKED_AT) })],
        { bookingStatus: 'completed' },
        { discounted: true, vouchers: [redemption(false)] },
      );
      const row = visitRowOf(paid, staffOptions({ photoCount: 2 }), LOOKUP);
      expect(row.marks).toEqual([
        { icon: 'client.photos', label: '2 снимки', count: 2 },
        { icon: 'promo.coupon', label: 'с отстъпка', count: null },
        { icon: 'promo.voucher', label: 'платено с ваучер', count: null },
      ]);
      // The figure is the bill, as it was: how it was settled is the mark's.
      expect(row.trailingFact).toMatchObject({ text: EURO('24,75 €') });
      expect(row.accessibleName).toBe(
        EURO(
          'Фейд, 4 септември в 10:00, Иван, Център, 24,75 €, 2 снимки, с отстъпка, платено с ваучер',
        ),
      );
    });

    it('marks nothing for a draw that was taken back, or on a visit that did not happen', () => {
      const reversed = visit(
        'appt-voucher-reversed',
        [seat('2026-09-04T10:00:00', { outcome: seatWorked(WORKED_AT) })],
        { bookingStatus: 'completed' },
        { vouchers: [redemption(true)] },
      );
      expect(visitRowOf(reversed, staffOptions(), LOOKUP).marks).toEqual([]);

      const missed = visit(
        'appt-voucher-missed',
        [
          seat('2026-09-04T10:00:00', {
            outcome: seatNoShow(sofia('2026-09-04T10:20:00')),
          }),
        ],
        { bookingStatus: 'no_show' },
        { vouchers: [redemption(false)] },
      );
      expect(visitRowOf(missed, staffOptions(), LOOKUP).marks).toEqual([]);
    });

    it('marks the bill, never a companion’s share of it', () => {
      const party = visit(
        'appt-voucher-party',
        [
          seat('2026-09-04T10:00:00', {
            id: 'seat-georgi',
            outcome: seatWorked(WORKED_AT),
          }),
          seat('2026-09-04T10:00:00', {
            id: 'seat-ivo',
            who: IVO,
            relationship: 'companion',
            barber: 'barber-petar',
            outcome: seatWorked(WORKED_AT),
          }),
        ],
        { bookingStatus: 'completed' },
        { vouchers: [redemption(false)] },
      );
      expect(
        visitRowOf(party, staffOptions({ subjectUserId: IVO }), LOOKUP).marks,
      ).toEqual([]);
    });

    it('draws no mark from words that do not carry its word', () => {
      // A hand-built table from before revision 3: the mark needs its
      // label, since a glyph alone names nothing.
      const older: VisitBuilderWords = { ...STAFF_WORDS, voucher: undefined };
      const paid = visit(
        'appt-voucher-older',
        [seat('2026-09-04T10:00:00', { outcome: seatWorked(WORKED_AT) })],
        { bookingStatus: 'completed' },
        { vouchers: [redemption(false)] },
      );
      expect(
        visitRowOf(paid, staffOptions({ words: older }), LOOKUP).marks,
      ).toEqual([]);
    });
  });

  it('names the barber by first name, last on the line, and keeps the whole name in the sentence', () => {
    // The dashboard's catalogue hands the whole name; the shop arrives
    // short (`Location.shortName`), without the brand every shop shares.
    const lookup: VisitLookup = {
      ...LOOKUP,
      barberName: (id) => (id === 'barber-ivan' ? 'Иван Колев' : null),
    };
    const row = visitRowOf(LAST_VISIT, staffOptions(), lookup);
    expect(row.lines).toEqual([{ text: 'Център · Иван', hold: ' · Иван' }]);
    expect(row.accessibleName).toContain('в 10:00, Иван Колев, Център,');
  });

  it('holds the barber against the ellipsis, so a shop without a short name cannot push out who cut (wave D r2)', () => {
    // A shop with no `shortName` falls back to its whole name, brand and
    // all. The line still ends on the barber, and that run is held.
    const lookup: VisitLookup = {
      ...LOOKUP,
      locationName: (id) => (id === 'loc-center' ? 'Креативо · Център' : null),
    };
    const row = visitRowOf(LAST_VISIT, staffOptions(), lookup);
    expect(row.lines).toEqual([
      { text: 'Креативо · Център · Иван', hold: ' · Иван' },
    ]);
    // A line that is only the barber has nothing before it to give way.
    const alone = visitRowOf(LAST_VISIT, staffOptions(), {
      ...LOOKUP,
      locationCount: 1,
    });
    expect(alone.lines).toEqual([{ text: 'Иван' }]);
  });

  it('tells a guest’s visit as the appointment’s own, and quotes nobody', () => {
    const row = visitRowOf(
      LAST_VISIT,
      staffOptions({ subjectUserId: null }),
      LOOKUP,
    );
    expect(row.outcome).toBe(VisitRowOutcome.Worked);
    expect(row.quote).toBeNull();
  });
});

describe('visitRowOf · the client’s own list', () => {
  const clientOptions = (
    overrides: Partial<VisitRowOptions> = {},
  ): VisitRowOptions => ({
    perspective: VisitPerspective.Client,
    grain: VisitGrain.Month,
    subjectUserId: GEORGI,
    currentAppointmentId: null,
    now: NOW,
    timeZone: VISITS_TIME_ZONE,
    locale: 'bg',
    words: CLIENT_WORDS,
    ...overrides,
  });

  it('keeps «Моите часове»: the weekday on the tile, «Иван · 10:00», the barber’s face trailing', () => {
    const row = visitRowOf(LAST_VISIT, clientOptions(), LOOKUP);
    expect(row).toEqual({
      id: 'appt-sep',
      visitRowEntry: VisitRowEntry.Visit,
      ...wall('2026-09-04T10:00:00'),
      sectionKey: '2026-09',
      upcoming: false,
      tile: { caption: 'пт', day: 4, tone: 'past' },
      leadingIcon: null,
      title: 'Фейд',
      struck: false,
      lines: [{ text: 'Иван · 10:00' }],
      // The client's own words are their own: the list never quotes them back.
      quote: null,
      trailing: {
        avatarSrc: 'https://example.test/ivan.jpg',
        name: 'Иван',
        several: false,
      },
      // Money and status words are the staff's: a client's row states none.
      trailingFact: null,
      marks: [],
      outcome: VisitRowOutcome.Worked,
      bookingStatus: BookingStatus.Completed,
      accessibleName: 'Фейд, 4 септември в 10:00, Иван',
      // The id every client spec and e2e reads (§5.3.5).
      testId: 'appointment-row',
    });
  });

  it('strikes a cancelled or missed hour and names it in the client’s own status word', () => {
    const cancelled = visit(
      'appt-cancelled',
      [
        seat('2026-07-16T10:00:00', {
          outcome: seatCancelled(
            sofia('2026-07-15T18:00:00'),
            'client',
            CancellationReason.Unspecified,
            null,
          ),
        }),
      ],
      { bookingStatus: 'cancelled', cancellationReason: 'unspecified' },
    );
    const row = visitRowOf(cancelled, clientOptions(), LOOKUP);
    expect(row.struck).toBe(true);
    expect(row.bookingStatus).toBe(BookingStatus.Cancelled);
    expect(row.lines).toEqual([{ text: 'Иван · 10:00' }]);
    expect(row.accessibleName).toBe('Фейд, 16 юли в 10:00, Иван, Отказан');

    const missed = visit(
      'appt-missed',
      [
        seat('2026-07-07T10:00:00', {
          outcome: seatNoShow(sofia('2026-07-07T10:20:00')),
        }),
      ],
      { bookingStatus: 'no_show' },
    );
    expect(visitRowOf(missed, clientOptions(), LOOKUP).accessibleName).toBe(
      'Фейд, 7 юли в 10:00, Иван, Пропуснат',
    );
  });

  it('names a party cut by several barbers as the group, with no face', () => {
    const party = visit(
      'appt-party',
      [
        seat('2026-10-02T10:00:00', { id: 'seat-a' }),
        seat('2026-10-02T10:00:00', {
          id: 'seat-b',
          who: IVO,
          relationship: 'companion',
          barber: 'barber-petar',
        }),
      ],
      { bookingStatus: 'confirmed' },
    );
    const row = visitRowOf(party, clientOptions(), LOOKUP);
    // Deduplicated: a party having the same cut is one thing, twice.
    expect(row.title).toBe('Фейд');
    expect(row.upcoming).toBe(true);
    // Upcoming: the tile names the month, the line the weekday (OR-56 b).
    expect(row.tile).toEqual({ caption: 'окт.', day: 2, tone: 'upcoming' });
    expect(row.lines).toEqual([{ text: '2 бръснари · пт, 10:00' }]);
    expect(row.trailing).toEqual({
      avatarSrc: null,
      name: '2 бръснари',
      several: true,
    });
  });

  it('words the row in English from the same keys', () => {
    const en = translator(catalogue('en'));
    const row = visitRowOf(
      LAST_VISIT,
      clientOptions({
        locale: 'en',
        words: visitWordsOf(en, 'en', VisitPerspective.Client),
      }),
      LOOKUP,
    );
    expect(row.tile?.caption).toBe('Fri');
    expect(row.lines).toEqual([{ text: 'Иван · 10:00 AM' }]);
    expect(row.accessibleName).toBe('Фейд, September 4 at 10:00 AM, Иван');
  });

  it('captions a year’s tile with the English month from the same table', () => {
    const en = translator(catalogue('en'));
    const row = visitRowOf(
      LAST_VISIT,
      staffOptions({
        locale: 'en',
        words: visitWordsOf(en, 'en', VisitPerspective.Staff),
      }),
      LOOKUP,
    );
    expect(row.tile).toEqual({ caption: 'Sep', day: 4, tone: 'past' });
  });

  describe('an hour still to come (OR-56 b): the tile names the month, the line the weekday', () => {
    const ahead = (id: string, iso: string) =>
      visit(id, [seat(iso)], { bookingStatus: 'confirmed' });

    it('names the month — «юни» over «1», «Иван · сб, 10:00» — and keeps the year for the ear alone (DEP-F39)', () => {
      const row = visitRowOf(
        ahead('appt-far', '2030-06-01T10:00:00'),
        clientOptions(),
        LOOKUP,
      );
      // «Предстоящи» names no period: the tile names what it does not.
      expect(row.sectionKey).toBe('upcoming');
      // Never the year: the 44 pt square cannot hold «юни 2030 г.»; the
      // accessible name keeps it (R59).
      expect(row.tile).toEqual({ caption: 'юни', day: 1, tone: 'upcoming' });
      // The weekday the tile gave up, joined to the time — one «·».
      expect(row.lines).toEqual([{ text: 'Иван · сб, 10:00' }]);
      expect(row.accessibleName).toBe('Фейд, 1 юни 2030 г. в 10:00, Иван');
    });

    it('names the month inside the current year too', () => {
      const row = visitRowOf(
        ahead('appt-oct', '2026-10-03T10:00:00'),
        clientOptions(),
        LOOKUP,
      );
      expect(row.tile).toEqual({ caption: 'окт.', day: 3, tone: 'upcoming' });
      expect(row.lines).toEqual([{ text: 'Иван · сб, 10:00' }]);
    });

    it('says «днес» for the weekday on the shop’s today', () => {
      const row = visitRowOf(
        ahead('appt-today', '2026-09-28T11:00:00'),
        clientOptions(),
        LOOKUP,
      );
      expect(row.upcoming).toBe(true);
      expect(row.tile).toEqual({
        caption: 'септ.',
        day: 28,
        tone: 'upcoming',
      });
      expect(row.lines).toEqual([{ text: 'Иван · днес, 11:00' }]);
    });

    it('words both in English from the same keys — «Jun», «Иван · Sat, 10:00 AM»', () => {
      const en = translator(catalogue('en'));
      const options = clientOptions({
        locale: 'en',
        words: visitWordsOf(en, 'en', VisitPerspective.Client),
      });
      const far = visitRowOf(
        ahead('appt-far', '2030-06-01T10:00:00'),
        options,
        LOOKUP,
      );
      expect(far.tile).toEqual({ caption: 'Jun', day: 1, tone: 'upcoming' });
      expect(far.lines).toEqual([{ text: 'Иван · Sat, 10:00 AM' }]);
      const near = visitRowOf(
        ahead('appt-oct', '2026-10-03T10:00:00'),
        options,
        LOOKUP,
      );
      expect(near.tile?.caption).toBe('Oct');
      const today = visitRowOf(
        ahead('appt-today', '2026-09-28T11:00:00'),
        options,
        LOOKUP,
      );
      expect(today.lines).toEqual([{ text: 'Иван · today, 11:00 AM' }]);
    });

    it('keeps a past row as it was: the weekday on the tile, the time alone in the line', () => {
      const row = visitRowOf(LAST_VISIT, clientOptions(), LOOKUP);
      expect(row.tile?.caption).toBe('пт');
      expect(row.lines).toEqual([{ text: 'Иван · 10:00' }]);
    });
  });
});

describe('visitWordsOf', () => {
  it('reads every word from keys both catalogues carry, in both perspectives', () => {
    for (const lang of ['bg', 'en'] as const) {
      // The translator throws on a key its catalogue lacks.
      const translate = translator(catalogue(lang));
      for (const perspective of [
        VisitPerspective.Client,
        VisitPerspective.Staff,
      ]) {
        const words = visitWordsOf(translate, lang, perspective);
        const sentence = [
          words.today,
          words.thisVisit,
          ...Array.from({ length: 12 }, (_, index) =>
            words.tileMonth(index + 1),
          ),
          words.unknownService,
          words.barberRole,
          words.severalBarbers(2),
          words.photoName('4.09'),
          words.withPeers(1),
          words.withPeers(2),
          words.photos(1),
          words.photos(3),
          words.discount,
          words.voucher,
          words.statusPending,
          words.statusConfirmed,
          words.noShow,
          words.cancelledBy(CancelledSide.Client),
          words.cancelledBy(CancelledSide.Shop),
          words.quote('…'),
          words.quoteName('…'),
          words.rowName({
            title: 'T',
            when: 'W',
            barber: 'B',
            outcome: '',
            price: '',
            marks: '',
            quote: '',
          }),
        ];
        expect(sentence.every((word) => word.length > 0)).toBe(true);
      }
      const waiting = visitWaitlistWordsOf(translate);
      expect(
        [
          waiting.unknownService,
          waiting.waiting,
          waiting.name('S', 'W'),
          ...Daypart.ALL.map((part) => waiting.daypart(part)),
          waiting.moreDays(2),
          waiting.moreRequests(1),
        ].every((word) => word.length > 0),
      ).toBe(true);
    }
  });

  it('words the two outcomes that differ by who reads them', () => {
    expect(STAFF_WORDS.noShow).toBe('Не дойде');
    expect(CLIENT_WORDS.noShow).toBe('Пропуснат');
    expect(STAFF_WORDS.cancelledBy(CancelledSide.Client)).toBe(
      'Отказан от клиента',
    );
    expect(STAFF_WORDS.cancelledBy(CancelledSide.Shop)).toBe(
      'Отказан от салона',
    );
    // The client reads their own status, whoever called it off.
    expect(CLIENT_WORDS.cancelledBy(CancelledSide.Client)).toBe('Отказан');
    expect(CLIENT_WORDS.cancelledBy(CancelledSide.Shop)).toBe('Отказан');
    // Plurals by the language's own rule.
    expect(STAFF_WORDS.photos(1)).toBe('1 снимка');
    expect(STAFF_WORDS.photos(3)).toBe('3 снимки');
  });

  it('fills the two words revision 3 added, the same for whoever reads', () => {
    // «Потвърден» is the next visit's capsule on `lib-visit-card`; «платено
    // с ваучер» the row's voucher mark.
    for (const words of [STAFF_WORDS, CLIENT_WORDS]) {
      expect(words.statusConfirmed).toBe('Потвърден');
      expect(words.voucher).toBe('платено с ваучер');
    }
  });

  it('names a tile’s month from the catalogue’s table — a word, never `Intl`’s numeric «09»', () => {
    const months = Array.from({ length: 12 }, (_, index) =>
      STAFF_WORDS.tileMonth(index + 1),
    );
    expect(months).toEqual([
      'яну.',
      'фев.',
      'март',
      'апр.',
      'май',
      'юни',
      'юли',
      'авг.',
      'септ.',
      'окт.',
      'ноем.',
      'дек.',
    ]);
    // Both perspectives read the same table.
    expect(CLIENT_WORDS.tileMonth(9)).toBe('септ.');
  });
});

describe('waitlistRowOf', () => {
  function request(
    days: readonly {
      readonly dayKey: string;
      readonly windows?: readonly {
        readonly from: string;
        readonly to: string;
      }[];
    }[],
  ): WaitlistRequest {
    return waitlistOf(
      'waitlist-1',
      days,
      ['svc-fade', 'svc-fade'],
      '2026-09-20T12:00:00+03:00',
    );
  }

  const AFTERNOON = [{ from: '13:00', to: '17:00' }];
  const options = {
    words: WAITLIST_WORDS,
    today: localDate('2026-09-28'),
    locale: 'bg',
  };

  it('leads with the watching glyph and folds the days it still watches into one line', () => {
    const row = waitlistRowOf(
      request([
        { dayKey: '2026-10-01', windows: AFTERNOON },
        { dayKey: '2026-10-02', windows: AFTERNOON },
      ]),
      options,
      LOOKUP,
    );
    expect(row).toEqual({
      id: 'waitlist-1',
      visitRowEntry: VisitRowEntry.Waitlist,
      ...wall('2026-10-01T00:00:00'),
      sectionKey: 'upcoming',
      upcoming: true,
      tile: null,
      leadingIcon: 'calendar.watching',
      title: 'Фейд',
      struck: false,
      // The state on a line of its own, so no ellipsis can take it; the
      // days under it, the run in the house range's spaced dash.
      lines: [{ text: 'Чака свободен час' }, { text: 'чт – пт, следобед' }],
      quote: null,
      trailing: null,
      trailingFact: null,
      marks: [],
      outcome: null,
      bookingStatus: null,
      // Spelled out: a reader never hears «чт – пт».
      accessibleName: 'Фейд, чака свободен час: четвъртък и петък, следобед',
      testId: 'client-visit-waitlist',
    });
  });

  it('drops the days that have passed, dates the ones past a week, and counts past three', () => {
    const row = waitlistRowOf(
      request([
        { dayKey: '2026-09-20' },
        { dayKey: '2026-10-01' },
        { dayKey: '2026-10-12' },
        { dayKey: '2026-10-14' },
        { dayKey: '2026-10-20' },
        { dayKey: '2026-10-22' },
      ]),
      options,
      LOOKUP,
    );
    // Whole days: no part of the day to name.
    expect(row.lines).toEqual([
      { text: 'Чака свободен час' },
      { text: 'чт, 12.10, 14.10 и още 2' },
    ]);
    expect(row.accessibleName).toBe(
      'Фейд, чака свободен час: четвъртък, 12 октомври, 14 октомври, 20 октомври и 22 октомври',
    );
    expect({
      localDate: row.localDate,
      startMinutes: row.startMinutes,
    }).toEqual(wall('2026-10-01T00:00:00'));
  });

  it('prints a run of days through the house range, one face at both ends', () => {
    const range = (dayKeys: readonly string[], today = options.today) =>
      waitlistRowOf(
        request(dayKeys.map((dayKey) => ({ dayKey, windows: AFTERNOON }))),
        { ...options, today },
        LOOKUP,
      ).lines[1]?.text;
    // Past the week: the dates, «8.10 – 9.10» as the card's season window
    // prints «1.09 – 30.11» — `Intl`'s spaced dash, never a hand-built one.
    expect(range(['2026-10-08', '2026-10-09'])).toBe('8.10 – 9.10, следобед');
    expect(range(['2026-10-08', '2026-10-09'])).toBe(
      dayRange(
        localDate('2026-10-08'),
        localDate('2026-10-09'),
        options.today,
        'bg',
      ) + ', следобед',
    );
    // A run that leaves the week is dated at both ends, never «сб – 6.10».
    expect(
      range(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']),
    ).toBe('3.10 – 6.10, следобед');
    // Across the new year each end names its year.
    expect(range(['2026-12-31', '2027-01-01'])).toBe(
      '31.12.2026\u202fг. – 1.01.2027\u202fг., следобед',
    );
    // English: the numeric house date at both ends and on a lone day.
    const english = waitlistRowOf(
      request(
        ['2026-10-01', '2026-10-08', '2026-10-09'].map((dayKey) => ({
          dayKey,
          windows: AFTERNOON,
        })),
      ),
      { ...options, locale: 'en' },
      LOOKUP,
    );
    expect(english.lines[1]?.text).toBe('Thu, 10/8\u2009–\u200910/9, следобед');
  });

  it('names every part of the day the windows touch, and none when a day is offered whole', () => {
    const spanning = waitlistRowOf(
      request([
        { dayKey: '2026-10-01', windows: [{ from: '11:00', to: '13:00' }] },
      ]),
      options,
      LOOKUP,
    );
    expect(spanning.lines).toEqual([
      { text: 'Чака свободен час' },
      { text: 'чт, сутрин и следобед' },
    ]);

    const mixed = waitlistRowOf(
      request([
        { dayKey: '2026-10-01', windows: AFTERNOON },
        { dayKey: '2026-10-02' },
      ]),
      options,
      LOOKUP,
    );
    // «чт – пт, следобед» would be untrue of a Friday that works at any hour.
    expect(mixed.lines).toEqual([
      { text: 'Чака свободен час' },
      { text: 'чт – пт' },
    ]);
  });

  it('names the newest request and counts the others', () => {
    const row = waitlistRowOf(
      request([{ dayKey: '2026-10-01', windows: AFTERNOON }]),
      { ...options, otherRequests: 1 },
      LOOKUP,
    );
    // The others close the state's line, which has the room.
    expect(row.lines).toEqual([
      { text: 'Чака свободен час · още 1' },
      { text: 'чт, следобед' },
    ]);
    expect(row.accessibleName).toBe(
      'Фейд, чака свободен час: четвъртък, следобед · още 1',
    );
  });

  it('files a request that watches no day first in the upcoming run, without throwing', () => {
    // Every watched day spent: the row still draws, at the first day of the
    // civil axis and its first minute (§9 R-4), so it orders before every
    // real row, as the legacy instant 0 did — whatever the ids say.
    const undated = waitlistRowOf(
      waitlistOf(
        'waitlist-undated',
        [],
        ['svc-fade'],
        '2026-09-20T12:00:00+03:00',
      ),
      options,
      LOOKUP,
    );
    expect(undated.localDate).toBe('1970-01-01');
    expect(undated.startMinutes).toBe(0);
    expect(undated.lines).toEqual([{ text: 'Чака свободен час' }]);

    const dated = waitlistRowOf(
      request([{ dayKey: '2026-10-01', windows: AFTERNOON }]),
      options,
      LOOKUP,
    );
    const ahead = visitRowOf(
      visit('appt-oct', [seat('2026-10-02T10:00:00')], {
        bookingStatus: 'confirmed',
      }),
      staffOptions(),
      LOOKUP,
    );
    const [upcoming] = sectionVisits([ahead, dated, undated], {
      grain: VisitGrain.Month,
      labels: { upcoming: 'Предстоящи', section: (key) => key },
    });
    expect(upcoming?.key).toBe('upcoming');
    expect(upcoming?.rows.map((row) => row.id)).toEqual([
      'waitlist-undated',
      'waitlist-1',
      'appt-oct',
    ]);
  });
});

describe('visitClockOf · one clock for rows and cards', () => {
  const FRIDAY = wall('2026-09-04T10:00:00');
  const LAST_YEAR = wall('2025-12-05T11:30:00');
  const clock = (
    start: {
      readonly localDate: LocalDate;
      readonly startMinutes: MinuteOfDay;
    },
    locale: string,
    now = NOW,
  ) =>
    visitClockOf(
      start.localDate,
      start.startMinutes,
      now,
      locale,
      VISITS_TIME_ZONE,
    );

  it('prints the card’s own date faces as the card always has, the year only outside the current one', () => {
    const bg = clock(FRIDAY, 'bg');
    expect(bg.dayShort()).toBe('4.09');
    expect(bg.weekdayAndDay()).toBe('пт, 4.09');
    expect(bg.whenHeard('днес')).toBe('петък, 4 септември в 10:00');

    const bgElsewhere = clock(LAST_YEAR, 'bg');
    expect(bgElsewhere.dayShort()).toBe('5.12.2025 г.');
    expect(bgElsewhere.weekdayAndDay()).toBe('пт, 5.12.2025 г.');
    expect(bgElsewhere.whenHeard('днес')).toBe(
      'петък, 5 декември 2025 г. в 11:30',
    );

    const en = clock(FRIDAY, 'en');
    expect(en.dayShort()).toBe('Sep 4');
    expect(en.weekdayAndDay()).toBe('Fri, Sep 4');
    expect(en.whenHeard('today')).toBe('Friday, September 4 at 10:00 AM');

    const enElsewhere = clock(LAST_YEAR, 'en');
    expect(enElsewhere.dayShort()).toBe('Dec 5, 2025');
    expect(enElsewhere.weekdayAndDay()).toBe('Fri, Dec 5, 2025');
    expect(enElsewhere.whenHeard('today')).toBe(
      'Friday, December 5, 2025 at 11:30 AM',
    );
  });

  it('keeps the row’s long form without a weekday beside the card’s heard one', () => {
    const bg = clock(FRIDAY, 'bg');
    expect(bg.whenLong('днес')).toBe('4 септември в 10:00');
    expect(bg.whenHeard('днес')).toBe('петък, 4 септември в 10:00');
    // On the visit's own day both say «днес» and the time.
    const sameDay = clock(
      FRIDAY,
      'bg',
      ZonedTimeSystem.shopNow(sofia('2026-09-04T09:00:00'), VISITS_TIME_ZONE),
    );
    expect(sameDay.isToday()).toBe(true);
    expect(sameDay.whenLong('днес')).toBe('днес, 10:00');
    expect(sameDay.whenHeard('днес')).toBe('днес, 10:00');
    expect(sameDay.whenShort('днес')).toBe('днес, 10:00');
  });
});
