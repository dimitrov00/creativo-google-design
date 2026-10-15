import type { Appointment, WaitlistRequest } from '@core/entities';
import {
  Daypart,
  DayWindows,
  type Seat,
  SeatSubject,
  type ShopNow,
  VoucherRedemption,
} from '@core/components';
import {
  BookingStatus,
  CustomerId,
  LocalDate,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';
import {
  BillingSystem,
  type PersonSubject,
  VisitStorySystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  LEGACY_CANCELLED_SIDE,
  LEGACY_VISIT_ROW_OUTCOME,
  VISITS_TIME_ZONE,
  VISIT_ROW_OUTCOME_OF,
  shopNowOf,
} from './visit-ecs.shim';
import { pluralForm } from '@creativo/infrastructure/i18n';
import { dayRange } from './day-range';
import type { StaffEventLine } from './event-head/staff-event-line';
import { firstNameOf } from './first-name';
import { UPCOMING_SECTION_KEY, visitSectionKey } from './visit-sections';
import { formatCents, formatMinute, formatWallClock } from './wall-clock';
import type {
  VisitGrain,
  VisitLookup,
  VisitPerspective,
  VisitRowMark,
  VisitRowOutcome,
  VisitRowVariant,
  VisitRowVm,
  VisitTrailing,
  VisitTrailingFact,
  VisitWaitlistWords,
  VisitWords,
} from './visit-row.vm';

/*
 * THE ROW BUILDERS (client-card redesign §5.3.2–§5.3.5) — an appointment,
 * or a waiting request, into the one row both lists draw.
 *
 * Pure on purpose: the words arrive translated (`VisitWords`), the
 * catalogue arrives as a lookup (`VisitLookup`), the clock arrives as a
 * number. So the staff sheet builds rows without injecting a catalogue
 * service into specs that never provided one (FE-7), and a row reads the
 * same in a spec, on the client's page and on the staff card.
 *
 * The visit is the FLAT entity straight from its document (flip 1, Law 5):
 * its day and hour are the shop's wall clock (`localDate` +
 * `startMinutes`, Law 7.3) and are printed as stored; only "now" — and a
 * photo's instant — is read on the shop's calendar, in the LOCATION's zone
 * (`VisitLookup.locationTimeZone`, the tenant's while the lookup names
 * none), never the device's.
 *
 * The story's math — whose seats, the root outcome, the decisive
 * cancellation and its side, the people counted, the upcoming rule, the
 * runs of watched days — is `VisitStorySystem` in `@core/systems`; the
 * bill is `BillingSystem`'s. The words, the clock's formatting and the
 * money's stay here.
 */

/** The catalogue's key segment of each part of the day (`*.daypart.morning`, …). */
const DAYPART_KEY = {
  [Daypart.Morning]: 'morning',
  [Daypart.Afternoon]: 'afternoon',
  [Daypart.Evening]: 'evening',
} as const satisfies Record<Daypart, string>;

/**
 * The row's words as the builders read them: `VisitWords`, and the one word
 * revision 3 adds for a row (§2.5, Fresha adopt-now N5). It stands HERE,
 * optional, until the view model's own table carries it (`visit-row.vm.ts`
 * is frozen between the contract wave and the cleanup): `visitWordsOf`
 * always fills it, so a host that hands its words on as plain `VisitWords`
 * still hands the word on, and a hand-built table without it draws no
 * voucher mark.
 */
export interface VisitBuilderWords extends VisitWords {
  /** «платено с ваучер» — the voucher mark's hidden word (`visits.marks.voucher`). */
  readonly voucher?: string;
}

/**
 * The words as the catalogue fills them (`visitWordsOf`): every word, the
 * two revision 3 added included, so a host that reads them from the
 * catalogue is never asked whether it has them.
 */
export type VisitCatalogueWords = VisitBuilderWords &
  Required<Pick<VisitBuilderWords, 'statusConfirmed' | 'voucher'>>;

/** A photo of the visit as the reader lists it: `lib-visit-card`'s thumbs (`VisitCardOptions.photos`). */
export interface VisitRowPhotoSource {
  readonly id: string;
  readonly url: string;
  /** When it was taken — read on the shop's calendar for the thumb's name. */
  readonly takenAtUtcMs: UtcEpochMs;
}

export interface VisitRowOptions {
  readonly perspective: VisitPerspective;
  /** The list's grain: which section the row files under, and so what its tile says. */
  readonly grain: VisitGrain;
  /**
   * Whose story the staff row tells — their seats, their outcome, their
   * share — by the ACCOUNT the seats name (`subjectUserId`), which also
   * decides whose own words a row quotes. Null (a guest) tells the
   * appointment's; the client's own list always does.
   */
  readonly subjectUserId: string | null;
  /**
   * The same person's client RECORD (D29: whom the shop served) — what the
   * story is keyed by (`VisitStorySystem.subjectStory`). The staff card
   * passes the record it resolved; absent, it is read off the seat that
   * names `subjectUserId` (the seat's explicit `subjectCustomerId` link,
   * never a uid taken for a record).
   */
  readonly subjectCustomerId?: string | null;
  /** The appointment the sheet is open on: it wears «Този час» wherever its date files it. */
  readonly currentAppointmentId: string | null;
  readonly nowMs: number;
  readonly locale: string;
  /**
   * @deprecated RETIRED (revision 3 §3.10, W4): a row draws no thumbs — the
   * glance's card is `lib-visit-card`, built by `visitCardOf`, which takes
   * the photos itself. Accepted and IGNORED (a row counts its photos from
   * `photoCount` alone) until the one caller left, the built
   * `visitsModuleVm` (`client-card.presenter.ts`), is gone; the key goes
   * with it (contract delta Z2-1).
   */
  readonly photos?: readonly VisitRowPhotoSource[];
  /** The visit's photos, counted (`countPhotosByAppointment`): a row's mark. */
  readonly photoCount?: number;
  /**
   * @deprecated RETIRED (revision 3 §3.11, W4): a row is a row, and
   * `lib-visit-row` takes no variant any more. Accepted and IGNORED until
   * the one caller left, the built `visitsModuleVm`, is gone; the key and
   * `VisitRowVariant` go with it (contract delta Z2-1).
   */
  readonly variant?: VisitRowVariant;
  readonly words: VisitBuilderWords;
  /**
   * False withholds the client's own words from a viewer who may not read
   * free text (a sysadmin, R15). Defaults to true.
   */
  readonly clientWords?: boolean;
}

export interface WaitlistRowOptions {
  readonly words: VisitWaitlistWords;
  /** `YYYY-MM-DD` on the request's calendar: the days before it have passed. */
  readonly today: string;
  readonly locale: string;
  /**
   * The person's OTHER watching requests: the row names the newest one and
   * counts the rest («· още 1»). Defaults to none.
   */
  readonly otherRequests?: number;
}

/**
 * How a host's catalogue answers — Transloco's `translate`, or anything
 * shaped like it (a spec's own map).
 */
export type VisitTranslate = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

/**
 * The row's words, read from the catalogue once — ONE map from keys to
 * words, so «Моите часове» and the staff card never word a row apart
 * (§8.1: the shared list reuses the keys the app already has). The
 * perspective picks the two words that differ by who reads them: a barber
 * records «Не дойде» / «Отказан от клиента»; a client reads their own
 * status, «Пропуснат» / «Отказан».
 */
export function visitWordsOf(
  translate: VisitTranslate,
  lang: string,
  perspective: VisitPerspective,
): VisitCatalogueWords {
  const plural = (key: string, count: number) =>
    translate(`${key}.${pluralForm(count, lang)}`, { count });
  const staff = perspective === 'staff';
  return {
    today: translate('visits.today'),
    thisVisit: translate('visits.thisVisit'),
    tileMonth: (month) => translate(`visits.tile.month.${month}`),
    unknownService: translate('appointments.visit.unknownService'),
    barberRole: translate('appointments.visit.barberRole'),
    severalBarbers: (count) =>
      translate('appointments.visit.severalBarbers', { count }),
    photoName: (when) => translate('staff.visit.photoOpen', { when }),
    withPeers: (count) => plural('visits.withPeers', count),
    photos: (count) => plural('visits.marks.photos', count),
    discount: translate('visits.marks.discount'),
    voucher: translate('visits.marks.voucher'),
    statusPending: translate('appointments.status.pending'),
    statusConfirmed: translate('appointments.status.confirmed'),
    noShow: translate(
      staff ? 'staff.visit.resolution.noShow' : 'appointments.status.no_show',
    ),
    cancelledBy: (side) =>
      translate(
        !staff
          ? 'appointments.status.cancelled'
          : side === 'client'
            ? 'staff.visit.resolution.cancelledByClient'
            : 'staff.visit.resolution.cancelledByStaff',
      ),
    quote: (text) => translate('visits.quote', { text }),
    quoteName: (text) => translate('visits.quoteName', { text }),
    rowName: (parts) => translate('visits.rowName', parts),
  };
}

/** A waiting request's words (`clientCard.visits.waitlist*`, `.daypart.*`). */
export function visitWaitlistWordsOf(
  translate: VisitTranslate,
): VisitWaitlistWords {
  return {
    unknownService: translate('appointments.visit.unknownService'),
    waiting: translate('clientCard.visits.waitlist'),
    name: (services, when) =>
      translate('clientCard.visits.waitlistName', { services, when }),
    daypart: (part) =>
      translate(`clientCard.visits.daypart.${DAYPART_KEY[part]}`),
    moreDays: (count) =>
      translate('clientCard.visits.waitlistMoreDays', { count }),
    moreRequests: (count) =>
      translate('clientCard.visits.waitlistMoreRequests', { count }),
  };
}

/**
 * A person's own story of one appointment, as the row tells it. Exported
 * with `storyOf`, `VisitClock` and `distinct` for the card's builders
 * (`visit-card.presenter.ts`, contract delta V1-1): a card is a row told at
 * length, and it reads the same story off the same clock.
 */
export interface VisitStory {
  /** The seats the row is about — the subject's, or the whole party's. */
  readonly seats: readonly Seat[];
  readonly outcome: VisitRowOutcome;
  /** Who called it off — set exactly when the outcome is `cancelled`. */
  readonly cancelledBy: 'client' | 'shop' | null;
}

/** The shop's zone a visit is read in: its location's, else the tenant's. */
export function visitZoneOf(
  locationId: string | null,
  lookup: Pick<VisitLookup, 'locationTimeZone'>,
): TimeZone {
  return (
    (locationId === null ? null : lookup.locationTimeZone?.(locationId)) ??
    VISITS_TIME_ZONE
  );
}

/** One appointment as a row of either list. */
export function visitRowOf(
  appointment: Appointment,
  options: VisitRowOptions,
  lookup: VisitLookup,
): VisitRowVm {
  const words = options.words;
  const staff = options.perspective === 'staff';
  const zone = visitZoneOf(appointment.locationId, lookup);
  // One reading per list: every row shares the list's `nowMs`.
  const now = shopNowOf(options.nowMs, zone);
  const at = new VisitClock(
    appointment.localDate,
    appointment.startMinutes,
    now,
    options.locale,
    zone,
  );
  const story = storyOf(appointment, options);
  const id: string = appointment.id;
  const current = id === options.currentAppointmentId;
  const upcoming = VisitStorySystem.isUpcoming(
    VISIT_ROW_OUTCOME_OF[story.outcome],
    { localDate: appointment.localDate, minute: appointment.startMinutes },
    now,
  );
  const hollow = story.outcome === 'cancelled' || story.outcome === 'no_show';

  const title =
    distinct(
      story.seats.map((seat) => lookup.serviceName(seat.serviceId)),
    ).join(' · ') || words.unknownService;

  const barberIds = distinct(story.seats.map((seat) => seat.barberId));
  const barberNames = barberIds.map(
    (barberId) => lookup.barberName(barberId) ?? words.barberRole,
  );

  const status = appointment.bookingStatus;
  const cancelledWord =
    story.cancelledBy === null ? null : words.cancelledBy(story.cancelledBy);
  const statusWord =
    story.outcome === 'no_show'
      ? words.noShow
      : story.outcome === 'open' && status === BookingStatus.Pending
        ? words.statusPending
        : cancelledWord;
  const outcomeSlot = [current ? words.thisVisit : null, statusWord]
    .filter((part): part is string => part !== null)
    .map((part) => `, ${part}`)
    .join('');

  // The caption says what the section does not: the weekday under a month
  // («пт», `Intl`), the month under a year and on the glance («септ.», the
  // catalogue's table — Bulgarian's `Intl` short month is numeric, LR4).
  const day = LocalDate.parts(appointment.localDate);
  const tile = {
    caption:
      options.grain === 'month' ? at.weekday() : words.tileMonth(day.month),
    day: day.day,
    tone: hollow
      ? ('hollow' as const)
      : upcoming
        ? ('upcoming' as const)
        : ('past' as const),
  };

  const base = {
    id,
    kind: 'visit' as const,
    startMs: appointment.utcEpochMs,
    sectionKey: upcoming
      ? UPCOMING_SECTION_KEY
      : visitSectionKey(appointment.localDate, options.grain),
    upcoming,
    tile,
    leadingIcon: null,
    title,
    struck: hollow,
    outcome: story.outcome,
    // The STORED tag (F1-9): the client row's `data-status` reads it.
    status,
  };

  if (!staff) {
    // The client's own list: the barber is a face on the trailing edge, and
    // the line says who and at what time — «Иван · 14:30».
    const barberLabel =
      barberIds.length === 1
        ? (barberNames[0] ?? words.barberRole)
        : words.severalBarbers(barberIds.length);
    const single = barberIds.length === 1 ? (barberIds[0] ?? null) : null;
    return {
      ...base,
      lines: [{ text: [barberLabel, at.time()].join(' · ') }],
      quote: null,
      trailing: {
        kind: 'barber',
        avatarSrc: single === null ? null : lookup.barberAvatarSrc(single),
        name: barberLabel,
        several: barberIds.length > 1,
      },
      // The staff's alone: a client reads no money and no status word here.
      trailingFact: null,
      marks: [],
      accessibleName: words.rowName({
        title,
        when: at.whenLong(words.today),
        barber: barberLabel,
        outcome: outcomeSlot,
        price: '',
        marks: '',
        quote: '',
      }),
      testId: 'appointment-row',
    };
  }

  const barberText = at.list(barberNames);
  // The line's barber goes by first name: «Иван», not «Иван Колев» (the
  // row's sentence keeps the whole name).
  const barberShort = at.list(
    barberIds.map((barberId) => {
      const name = lookup.barberName(barberId);
      return name === null ? words.barberRole : firstNameOf(name);
    }),
  );
  const alone = story.seats.length === appointment.seats.length;
  const peers = alone ? 0 : peersOf(appointment, story.seats);
  const peersText = peers > 0 ? words.withPeers(peers) : null;
  // The shop as a line names it: its short name, without the tenant's brand
  // that every shop shares (`VisitLookup.locationName`).
  const locationText =
    story.outcome === 'worked' && lookup.locationCount > 1
      ? lookup.locationName(appointment.locationId)
      : null;

  // The fact line never carries the date, because the tile and the section
  // own it. Its facts run from the one that varies most down a history to
  // the one that varies least, so an ellipsis only takes what the rows
  // around it already say (wave D, Critique 5). An hour still to come leads
  // with when in the day. The shop follows, then the party, and the barber
  // comes last. A no-show's word ends the line as the row's fact, so the
  // line does not say it twice. The barber is also the one run the
  // ellipsis never takes (`hold`), so a long shop name, even one without a
  // short name, truncates before who did the cut (wave D r2).
  //
  // A CANCELLED hour's word has a line of its own, FIRST (review r5): the
  // word keeps its words whole — the struck amount ends that line, as every
  // row's fact ends its first — and the barber, with the party, runs the
  // whole width under it.
  //
  // THE VISIT ON SCREEN leads with its time alone («10:00 · Иван»): its day
  // is the tile's and the capsule «Този час» already names it, and its
  // second line is the fullest of the list (revision 3 review 2,
  // fix-visits-r1). The row's sentence still says the day.
  const statusLine = !current && cancelledWord !== null ? cancelledWord : null;
  const lead: readonly string[] = current
    ? [at.time()]
    : story.outcome === 'open'
      ? [at.whenShort(words.today)]
      : [];
  const before = [
    ...lead,
    ...(current || locationText === null ? [] : [locationText]),
    ...(peersText === null ? [] : [peersText]),
  ];
  const factLine: StaffEventLine =
    before.length === 0
      ? { text: barberShort }
      : {
          text: [...before, barberShort].join(' · '),
          hold: ` · ${barberShort}`,
        };
  const lines: readonly StaffEventLine[] =
    statusLine === null ? [factLine] : [{ text: statusLine }, factLine];

  const price =
    story.outcome === 'worked' || story.outcome === 'cancelled'
      ? priceOf(appointment, story.seats, options.locale)
      : null;

  // THE FACE keeps the trailing edge, as on the client's own list (revision
  // 3 §2.5: that is the sameness). Who cut, by the name the shop knows them
  // by; a visit cut by several draws no face and names the group, and the
  // fact line still lists every one of them.
  const soleBarber = barberIds.length === 1 ? (barberIds[0] ?? null) : null;
  const trailing: VisitTrailing =
    barberIds.length === 0
      ? null
      : {
          kind: 'barber',
          avatarSrc:
            soleBarber === null ? null : lookup.barberAvatarSrc(soleBarber),
          name:
            soleBarber === null
              ? words.severalBarbers(barberIds.length)
              : (barberNames[0] ?? words.barberRole),
          several: barberIds.length > 1,
        };

  // THE STAFF'S FACT ends the second line: money, a state in words, or
  // «Този час». At most one.
  const trailingFact: VisitTrailingFact = current
    ? { kind: 'badge', text: words.thisVisit }
    : story.outcome === 'worked' && price !== null
      ? { kind: 'amount', text: price, emphasis: 'primary', struck: false }
      : story.outcome === 'cancelled' && price !== null
        ? { kind: 'amount', text: price, emphasis: 'secondary', struck: true }
        : story.outcome === 'no_show'
          ? {
              kind: 'status',
              icon: 'visit.noShow',
              text: words.noShow,
              tone: 'warning',
            }
          : story.outcome === 'open' && status === BookingStatus.Pending
            ? {
                kind: 'status',
                icon: 'visit.pending',
                text: words.statusPending,
                tone: 'neutral',
              }
            : null;

  const marks: VisitRowMark[] = [];
  if (story.outcome === 'worked') {
    const photoCount = options.photoCount ?? 0;
    if (photoCount > 0) {
      marks.push({
        icon: 'client.photos',
        label: words.photos(photoCount),
        count: photoCount,
      });
    }
    // Only where the figure beside it is the discounted one: a companion's
    // share is their seats' own prices, and the bill's discount is not in it.
    if (alone && appointment.discounts.length > 0) {
      marks.push({ icon: 'promo.coupon', label: words.discount, count: null });
    }
    // How the visit was settled (Fresha adopt-now N5): a voucher paid some
    // of this bill. The same rule as the discount, since the bill is the
    // whole party's; a draw that was taken back settled nothing.
    if (
      alone &&
      words.voucher !== undefined &&
      appointment.voucherRedemptions.some(VoucherRedemption.isLive)
    ) {
      marks.push({ icon: 'promo.voucher', label: words.voucher, count: null });
    }
  }

  // The client's own words belong to whoever booked: on a party someone
  // else booked they are the booker's, and the row does not carry them.
  const note = appointment.contactNote;
  const quoted =
    note !== null &&
    options.clientWords !== false &&
    options.subjectUserId !== null &&
    appointment.ownerUserId === options.subjectUserId
      ? note
      : null;

  return {
    ...base,
    lines,
    quote: quoted === null ? null : words.quote(quoted),
    trailing,
    trailingFact,
    marks,
    accessibleName: words.rowName({
      title,
      when: at.whenLong(words.today),
      barber: [barberText, locationText, peersText]
        .filter((part): part is string => part !== null)
        .join(', '),
      outcome: outcomeSlot,
      price: price === null ? '' : `, ${price}`,
      marks: marks.map((mark) => `, ${mark.label}`).join(''),
      quote: quoted === null ? '' : words.quoteName(quoted),
    }),
    testId: `history-row-${id}`,
  };
}

/**
 * A request waiting for a free slot, as the staff glance's row: a glyph in
 * place of the tile, then two fact lines — the state, «Чака свободен час»,
 * and under it the days it still watches, «чт – пт, следобед». The state has
 * a line of its own because it is the one thing that says this row is a
 * request and not a booked visit: on one line with the days, an ellipsis
 * cut it to «чака свобо…» at 390 and «чак…» at 330 (wave D r3). The person's
 * other requests («· още 1») close the state's line.
 */
export function waitlistRowOf(
  request: WaitlistRequest,
  options: WaitlistRowOptions,
  lookup: VisitLookup,
): VisitRowVm {
  const words = options.words;
  const parsedToday = LocalDate.parse(options.today);
  const today = parsedToday.ok ? parsedToday.value : null;
  const all = request.flexibleDays;
  const ahead =
    today === null ? all : all.filter((day) => day.localDate >= today);
  // A request whose every day has passed is the host's to leave out; drawn
  // anyway, it names what it asked for rather than nothing.
  const days = ahead.length > 0 ? ahead : all;

  const services =
    distinct(
      request.cartSeats.flatMap((seat) =>
        seat.lines.map((line) => lookup.serviceName(line.serviceId)),
      ),
    ).join(' · ') || words.unknownService;

  const parts = daypartsOf(days);
  const partWords =
    parts.length === 0
      ? null
      : listFormat(options.locale).format(
          parts.map((part) => words.daypart(part)),
        );

  // Short: consecutive days collapse to the house range, three items at
  // most — «чт – пт» when the whole run lies inside the coming week, else
  // its dates «8.10 – 9.10» at both ends (one range, one face: never
  // «сб – 6.10»). Its dash is `Intl`'s, the one the card's season window
  // prints «1.09 – 30.11» with (wave D r6).
  const items = runsOf(days).map(({ first, last }) =>
    first === last
      ? dayShort(first, today, options.locale)
      : dayRange(
          first.localDate,
          last.localDate,
          today,
          options.locale,
          withinWeek(first, today) && withinWeek(last, today)
            ? 'weekday'
            : 'date',
        ),
  );
  const shownDays =
    items.slice(0, 3).join(', ') +
    (items.length > 3 ? ` ${words.moreDays(items.length - 3)}` : '');
  const whenShort =
    partWords === null ? shownDays : `${shownDays}, ${partWords}`;

  // Spelled out for the row's name, every day in words: a reader never
  // hears «чт – пт».
  const spelledDays = listFormat(options.locale).format(
    days.map((day) => dayLong(day, today, options.locale)),
  );
  const whenLong =
    partWords === null ? spelledDays : `${spelledDays}, ${partWords}`;

  const others = options.otherRequests ?? 0;
  const more = others > 0 ? ` ${words.moreRequests(others)}` : '';
  const first = days[0];

  return {
    id: request.id,
    kind: 'waitlist',
    // The first watched day's first instant on the shop's calendar — the
    // order within the upcoming run.
    startMs:
      first === undefined
        ? 0
        : ZonedTimeSystem.startOfLocalDay(
            first.localDate,
            visitZoneOf(request.locationId, lookup),
          ),
    sectionKey: UPCOMING_SECTION_KEY,
    upcoming: true,
    tile: null,
    leadingIcon: 'calendar.watching',
    title: services,
    struck: false,
    lines: [
      { text: `${words.waiting}${more}` },
      ...(whenShort === '' ? [] : [{ text: whenShort }]),
    ],
    quote: null,
    trailing: null,
    trailingFact: null,
    marks: [],
    outcome: null,
    status: null,
    accessibleName: `${words.name(services, whenLong)}${more}`,
    testId: 'client-visit-waitlist',
  };
}

// ── The story ──────────────────────────────────────────────────────────

/**
 * The staff row tells the SUBJECT's story (their seats alone, so a
 * companion's no-show says nothing about the booker —
 * `VisitStorySystem.subjectStory`); the client's list, and a subject with no
 * seat on the visit, tell the appointment's.
 */
export function storyOf(
  appointment: Appointment,
  options: Pick<
    VisitRowOptions,
    'perspective' | 'subjectUserId' | 'subjectCustomerId'
  >,
): VisitStory {
  const story = VisitStorySystem.subjectStory(
    appointment,
    subjectRecordOf(appointment, options),
    options.perspective === 'staff',
  );
  return {
    seats: story.seatIndexes.map((index) => appointment.seats[index] as Seat),
    outcome: LEGACY_VISIT_ROW_OUTCOME[story.outcome],
    cancelledBy:
      story.cancelledBy === null
        ? null
        : LEGACY_CANCELLED_SIDE[story.cancelledBy],
  };
}

/**
 * The client record a row's story is about: the one the host named, else
 * the record the seat of `subjectUserId` links to — `null` for a guest, and
 * for an account with no seat on the visit (the appointment's story then).
 */
function subjectRecordOf(
  appointment: Appointment,
  options: Pick<VisitRowOptions, 'subjectUserId' | 'subjectCustomerId'>,
): CustomerId | null {
  const named = options.subjectCustomerId;
  if (named !== undefined) return named === null ? null : CustomerId.of(named);
  const account = options.subjectUserId;
  if (account === null) return null;
  for (const seat of appointment.seats) {
    if (
      seat.seatSubject === SeatSubject.Account &&
      seat.subjectUserId === account
    ) {
      return seat.subjectCustomerId;
    }
  }
  return null;
}

/**
 * What the row's figure says: the bill (`BillingSystem`, discounts taken
 * off) when the seats are the whole party; otherwise the subject's own
 * seats' prices — a root discount is not pro-rated onto a share (owner
 * question Q2). `null` for a visit no bill can be read from (no seat, two
 * currencies — refused at every write).
 */
function priceOf(
  appointment: Appointment,
  seats: readonly Seat[],
  locale: string,
): string | null {
  if (seats.length === appointment.seats.length) {
    const bill = BillingSystem.evaluate(appointment);
    return bill.ok
      ? formatCents(bill.value.totalCents, bill.value.currency, locale)
      : null;
  }
  const share = BillingSystem.subtotalOf(seats);
  return share.ok
    ? formatCents(share.value.amountCents, share.value.currency, locale)
    : null;
}

/** The OTHER people on the visit — an account by its id, a guest by the seat's name. */
function peersOf(appointment: Appointment, own: readonly Seat[]): number {
  return VisitStorySystem.peerCount(
    appointment.seats.map(personSubjectOf),
    appointment.seats.map((seat) => own.includes(seat)),
  );
}

/** Who a seat is for, as people are counted. */
function personSubjectOf(seat: Seat): PersonSubject {
  return seat.seatSubject === SeatSubject.Account
    ? { seatSubject: SeatSubject.Account, userId: seat.subjectUserId }
    : { seatSubject: SeatSubject.Anonymous, label: seat.guestLabel };
}

/** Present names, each once, in first-seen order. */
export function distinct<T extends string>(names: readonly (T | null)[]): T[] {
  return [...VisitStorySystem.distinct(names)];
}

// ── The clock ──────────────────────────────────────────────────────────

const LIST_FORMATS = new Map<string, Intl.ListFormat>();

/** «Иван и Петър» — the locale's conjunction, one formatter per locale. */
function listFormat(locale: string): Intl.ListFormat {
  let format = LIST_FORMATS.get(locale);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { type: 'conjunction' });
    LIST_FORMATS.set(locale, format);
  }
  return format;
}

/**
 * A visit's wall-clock start, read against the shop's "now". The day and
 * the minute print as stored (`formatWallClock`); a photo's instant is read
 * on the shop's calendar (`timeZone`, the location's).
 */
export class VisitClock {
  constructor(
    private readonly localDate: LocalDate,
    private readonly minute: number,
    private readonly now: ShopNow,
    private readonly locale: string,
    private readonly timeZone: TimeZone,
  ) {}

  /** «10:00». */
  time(): string {
    return formatMinute(this.minute, this.locale);
  }

  /** «пт» — the tile's caption under a month. */
  weekday(): string {
    return formatWallClock(this.localDate, null, this.locale, {
      weekday: 'short',
    });
  }

  /**
   * «днес, 10:00» · «пт, 10:00» — an hour still to come, in the fact line:
   * the day, then the time, two readings joined the same way whichever the
   * day is (`Intl`'s own weekday-and-time pattern appends « ч.» in bg).
   */
  whenShort(today: string): string {
    return `${this.isToday() ? today : this.weekday()}, ${this.time()}`;
  }

  /** «4 септември в 10:00» — the row's name, where a reader hears the month (R59). */
  whenLong(today: string): string {
    return this.isToday()
      ? `${today}, ${this.time()}`
      : formatWallClock(this.localDate, this.minute, this.locale, {
          day: 'numeric',
          month: 'long',
          ...this.yearIfElsewhere(this.localDate),
          hour: '2-digit',
          minute: '2-digit',
        });
  }

  /** «4 септември» — a photo's day, for its name; the visit's own day without one. */
  dayLong(takenAtUtcMs?: UtcEpochMs): string {
    const day =
      takenAtUtcMs === undefined
        ? this.localDate
        : ZonedTimeSystem.toLocal(takenAtUtcMs, this.timeZone).localDate;
    return formatWallClock(day, null, this.locale, {
      day: 'numeric',
      month: 'long',
      ...this.yearIfElsewhere(day),
    });
  }

  /** «Иван» · «Иван и Петър» — the people, as the locale lists them. */
  list(names: readonly string[]): string {
    return listFormat(this.locale).format(names);
  }

  /** The visit's day is today's, on the shop's calendar. */
  isToday(): boolean {
    return this.now.localDate === this.localDate;
  }

  /** The year only outside the current one (R59). */
  yearIfElsewhere(day: LocalDate): Pick<Intl.DateTimeFormatOptions, 'year'> {
    return LocalDate.parts(this.now.localDate).year ===
      LocalDate.parts(day).year
      ? {}
      : { year: 'numeric' };
  }
}

// ── The waiting request's days ─────────────────────────────────────────

/**
 * The parts of the day the windows touch, in the day's order — the
 * domain's one rule (`Daypart.touchedBy`), the same boundaries the booking
 * time sheet heads its times with, so the line names a window the way the
 * client's picker headed the times they chose from. A day offered whole
 * names none: «чт–пт, следобед» would be untrue of a Thursday that works at
 * any hour.
 */
function daypartsOf(days: readonly DayWindows[]): readonly Daypart[] {
  if (days.length === 0 || days.some(DayWindows.isWholeDay)) return [];
  return Daypart.touchedBy(days.flatMap((day) => day.windows));
}

/** A run of consecutive calendar days: one day when `first` is `last`. */
interface DayRun {
  readonly first: DayWindows;
  readonly last: DayWindows;
}

/** Runs of consecutive calendar days, in order — «чт, пт» reads «чт – пт». */
function runsOf(days: readonly DayWindows[]): readonly DayRun[] {
  return VisitStorySystem.dayRuns(days.map((day) => day.localDate)).map(
    (run) => ({
      first: days[run.first] as DayWindows,
      last: days[run.last] as DayWindows,
    }),
  );
}

/** Inside the coming week: the weekday says it («чт»). */
function withinWeek(day: DayWindows, today: LocalDate | null): boolean {
  return VisitStorySystem.withinWeek(day.localDate, today);
}

/** The year only when the day is outside today's. */
function yearUnlessToday(
  day: LocalDate,
  today: LocalDate | null,
): Pick<Intl.DateTimeFormatOptions, 'year'> {
  return today === null ||
    LocalDate.parts(today).year === LocalDate.parts(day).year
    ? {}
    : { year: 'numeric' };
}

/**
 * «чт» inside the coming week, else the date «12.10» (R59) — the range's
 * own date face (`month: '2-digit'`), so a line never says «Oct 12» beside
 * «10/13 – 10/14» in English.
 */
function dayShort(
  day: DayWindows,
  today: LocalDate | null,
  locale: string,
): string {
  return withinWeek(day, today)
    ? formatWallClock(day.localDate, null, locale, { weekday: 'short' })
    : formatWallClock(day.localDate, null, locale, {
        day: 'numeric',
        month: '2-digit',
        ...yearUnlessToday(day.localDate, today),
      });
}

/** «четвъртък» inside the coming week, else «12 октомври» — spelled for a reader. */
function dayLong(
  day: DayWindows,
  today: LocalDate | null,
  locale: string,
): string {
  return withinWeek(day, today)
    ? formatWallClock(day.localDate, null, locale, { weekday: 'long' })
    : formatWallClock(day.localDate, null, locale, {
        day: 'numeric',
        month: 'long',
        ...yearUnlessToday(day.localDate, today),
      });
}
