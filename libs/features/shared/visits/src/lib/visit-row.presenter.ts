import { UserId } from '@creativo/application/accounts';
import {
  type Appointment,
  CalendarDay,
  type DayWindows,
  type Daypart,
  type Money,
  type Seat,
  type SeatOutcome,
  type WaitlistRequest,
  ZonedDateTime,
  daypartsTouchedBy,
  formatMoney,
  ownerUserIdOf,
  subjectVisitOf,
} from '@creativo/application/booking';
import {
  DayKey,
  type PersonSubject,
  SeatOutcome as EcsSeatOutcome,
  VisitStorySystem,
} from '@creativo/ecs-core';
import { pluralForm } from '@creativo/infrastructure/i18n';
import { dayRange } from './day-range';
import type { StaffEventLine } from './event-head/staff-event-line';
import { firstNameOf } from './first-name';
import { UPCOMING_SECTION_KEY, visitSectionKey } from './visit-sections';
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
 * Every date is formatted on the visit's own calendar — the shop's zone
 * travels with the instant — never on the device's.
 *
 * Phase 2: the story's math — whose seats, the root outcome, the decisive
 * cancellation and its side, the people counted, the upcoming rule, the
 * runs of watched days — is `VisitStorySystem` in `@creativo/ecs-core`;
 * the words, the clock's formatting and the money's stay here. The legacy
 * shapes reach it through the converters at the end of this file.
 */

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
  readonly takenAtIso: string;
}

export interface VisitRowOptions {
  readonly perspective: VisitPerspective;
  /** The list's grain: which section the row files under, and so what its tile says. */
  readonly grain: VisitGrain;
  /**
   * Whose story the staff row tells — their seats, their outcome, their
   * share. Null (a guest) tells the appointment's; the client's own list
   * always does.
   */
  readonly subjectUserId: string | null;
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
  /** The visit's photos, counted (`CLIENT_PHOTOS_READER.countByAppointment`): a row's mark. */
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
    daypart: (part) => translate(`clientCard.visits.daypart.${part}`),
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

type Cancellation = Extract<SeatOutcome, { kind: 'cancelled' }>;

/** One appointment as a row of either list. */
export function visitRowOf(
  appointment: Appointment,
  options: VisitRowOptions,
  lookup: VisitLookup,
): VisitRowVm {
  const words = options.words;
  const staff = options.perspective === 'staff';
  const start = appointment.timeSlot.start;
  const startMs = start.toMillis();
  const at = new VisitClock(start, options.nowMs, options.locale);
  const story = storyOf(appointment, options);
  const id = appointment.id.value;
  const current = id === options.currentAppointmentId;
  const upcoming = VisitStorySystem.isUpcoming(
    story.outcome,
    startMs,
    options.nowMs,
  );
  const hollow = story.outcome === 'cancelled' || story.outcome === 'no_show';

  const title =
    distinct(
      story.seats.map((seat) => lookup.serviceName(seat.serviceId.value)),
    ).join(' · ') || words.unknownService;

  const barberIds = distinct(story.seats.map((seat) => seat.barberId.value));
  const barberNames = barberIds.map(
    (barberId) => lookup.barberName(barberId) ?? words.barberRole,
  );

  const status = appointment.status.kind;
  const cancelledWord =
    story.cancelledBy === null ? null : words.cancelledBy(story.cancelledBy);
  const statusWord =
    story.outcome === 'no_show'
      ? words.noShow
      : story.outcome === 'open' && status === 'pending'
        ? words.statusPending
        : cancelledWord;
  const outcomeSlot = [current ? words.thisVisit : null, statusWord]
    .filter((part): part is string => part !== null)
    .map((part) => `, ${part}`)
    .join('');

  // The caption says what the section does not: the weekday under a month
  // («пт», `Intl`), the month under a year and on the glance («септ.», the
  // catalogue's table — Bulgarian's `Intl` short month is numeric, LR4).
  const tile = {
    caption:
      options.grain === 'month' ? at.weekday() : words.tileMonth(start.month),
    day: start.day,
    tone: hollow
      ? ('hollow' as const)
      : upcoming
        ? ('upcoming' as const)
        : ('past' as const),
  };

  const base = {
    id,
    kind: 'visit' as const,
    startMs,
    sectionKey: upcoming
      ? UPCOMING_SECTION_KEY
      : visitSectionKey(start, options.grain),
    upcoming,
    tile,
    leadingIcon: null,
    title,
    struck: hollow,
    outcome: story.outcome,
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
      ? lookup.locationName(appointment.locationId.value)
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
  // A CANCELLED hour's word has a line of its own, FIRST (review r5). It
  // led the barber's line, and beside the struck amount that line had
  // ≈150 of the 215 column at 390: the ellipsis took the one word that
  // says who called it off («Отказан от … · Иван»), and the shorter the
  // phone, the less of it survived. So the word is the first line and
  // keeps its words whole — the struck amount ends that line, as every
  // row's fact ends its first — and the barber, with the party, runs the
  // whole width under it, the way a waiting request's days run under its
  // state. The visit on screen keeps its own grammar (below).
  //
  // THE VISIT ON SCREEN leads with its time alone («10:00 · Иван»): its day
  // is the tile's and the capsule «Този час» already names it, and its
  // second line is the fullest of the list — the capsule, and the marks
  // of a settled visit before it. With the day word too («днес, 10:00 ·
  // Иван», 140 at 390) a marked current row did not fit the 215 column
  // beside «▣ 1 · Този час» (103): it wrapped to a third line, and held to
  // two only by cutting the lead to «днес,…», the time gone and the day
  // word kept (revision 3 review 2, fix-visits-r1). The row's sentence
  // still says the day.
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
      ? formatMoney(priceOf(appointment, story.seats), options.locale)
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
          : story.outcome === 'open' && status === 'pending'
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
      appointment.voucherRedemptions.some((redemption) => redemption.live)
    ) {
      marks.push({ icon: 'promo.voucher', label: words.voucher, count: null });
    }
  }

  // The client's own words belong to whoever booked: on a party someone
  // else booked they are the booker's, and the row does not carry them.
  const note = appointment.contact?.note ?? null;
  const quoted =
    note !== null &&
    options.clientWords !== false &&
    options.subjectUserId !== null &&
    ownerUserIdOf(appointment) === options.subjectUserId
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
  const today = CalendarDay.create(options.today, request.zone);
  const all = request.when.days;
  const ahead = today.isSuccess()
    ? all.filter((day) => !day.day.isBefore(today.value))
    : all;
  // A request whose every day has passed is the host's to leave out; drawn
  // anyway, it names what it asked for rather than nothing.
  const days = ahead.length > 0 ? ahead : all;
  const reference = today.isSuccess() ? today.value : null;

  const services =
    distinct(
      request.cart.seats.flatMap((seat) =>
        seat.lines.map((line) => lookup.serviceName(line.serviceId)),
      ),
    ).join(' · ') || words.unknownService;

  const parts = daypartsOf(days);
  const partWords =
    parts.length === 0
      ? null
      : new Intl.ListFormat(options.locale, { type: 'conjunction' }).format(
          parts.map((part) => words.daypart(part)),
        );

  // Short: consecutive days collapse to the house range, three items at
  // most — «чт – пт» when the whole run lies inside the coming week, else
  // its dates «8.10 – 9.10» at both ends (one range, one face: never
  // «сб – 6.10»). Its dash is `Intl`'s, the one the card's season window
  // prints «1.09 – 30.11» with (wave D r6).
  const todayKey = reference === null ? null : reference.key();
  const items = runsOf(days).map(({ first, last }) =>
    first === last
      ? dayShort(first, reference, options.locale)
      : dayRange(
          first.day.key(),
          last.day.key(),
          todayKey,
          options.locale,
          withinWeek(first, reference) && withinWeek(last, reference)
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
  const spelledDays = new Intl.ListFormat(options.locale, {
    type: 'conjunction',
  }).format(days.map((day) => dayLong(day, reference, options.locale)));
  const whenLong =
    partWords === null ? spelledDays : `${spelledDays}, ${partWords}`;

  const others = options.otherRequests ?? 0;
  const more = others > 0 ? ` ${words.moreRequests(others)}` : '';
  const first = days[0];

  return {
    id: request.id.value,
    kind: 'waitlist',
    startMs: first === undefined ? 0 : first.day.startOfDay().toMillis(),
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
 * The staff row tells the SUBJECT's story (`subjectVisitOf`: their seats
 * alone, so a companion's no-show says nothing about the booker); the
 * client's list, and a subject with no seat on the visit, tell the
 * appointment's.
 */
export function storyOf(
  appointment: Appointment,
  options: Pick<VisitRowOptions, 'perspective' | 'subjectUserId'>,
): VisitStory {
  if (options.perspective === 'staff' && options.subjectUserId !== null) {
    const subject = UserId.create(options.subjectUserId);
    const visit = subject.isSuccess()
      ? subjectVisitOf(subject.value, appointment)
      : null;
    if (visit !== null) {
      const outcome = visit.outcome;
      return {
        seats: visit.seats,
        outcome: outcome.kind,
        cancelledBy:
          outcome.kind === 'cancelled' ? sideOf(outcome.decisive) : null,
      };
    }
  }
  return rootStoryOf(appointment);
}

function rootStoryOf(appointment: Appointment): VisitStory {
  const root = VisitStorySystem.rootStory(
    appointment.status.kind,
    appointment.seats.map((seat) => toEcsOutcome(seat.outcome)),
  );
  return {
    seats: appointment.seats,
    outcome: root.outcome,
    cancelledBy: root.cancelledBy,
  };
}

/**
 * Who a cancellation is on (`clientCaused`, the rule the stats count by).
 * A cancelled visit with no seat on record — every cancel path stamps its
 * seats, so only a hand-edited document — holds nothing against the client.
 */
function sideOf(cancellation: Cancellation | null): 'client' | 'shop' {
  return VisitStorySystem.cancelledSide(
    cancellation === null ? null : toEcsCancellation(cancellation),
  );
}

/**
 * What the row's figure says: the bill (`total()`, discounts taken off)
 * when the seats are the whole party; otherwise the subject's own seats'
 * prices — a root discount is not pro-rated onto a share (owner question Q2).
 */
function priceOf(appointment: Appointment, seats: readonly Seat[]): Money {
  if (seats.length === appointment.seats.length) return appointment.total();
  return seats
    .map((seat) => seat.terms.price)
    .reduce((total, price) => {
      const sum = total.add(price);
      // Unreachable: `validateSeats` rejects a mixed-currency appointment
      // at build, so `add` cannot mismatch here.
      if (sum.isFailure()) throw new Error('unreachable: mixed currency');
      return sum.value;
    });
}

/** The OTHER people on the visit — an account by its id, a guest by the seat's name. */
function peersOf(appointment: Appointment, own: readonly Seat[]): number {
  return VisitStorySystem.peerCount(
    appointment.seats.map((seat) => toPersonSubject(seat)),
    appointment.seats.map((seat) => own.includes(seat)),
  );
}

/** Present names, each once, in first-seen order. */
export function distinct(names: readonly (string | null)[]): string[] {
  return [...VisitStorySystem.distinct(names)];
}

// ── The clock ──────────────────────────────────────────────────────────

/** A visit's instant, read on its own calendar against "now". */
export class VisitClock {
  private readonly now: ZonedDateTime | null;

  constructor(
    private readonly start: ZonedDateTime,
    nowMs: number,
    private readonly locale: string,
  ) {
    const now = ZonedDateTime.fromMillis(nowMs, start.zoneName);
    this.now = now.isSuccess() ? now.value : null;
  }

  /** «10:00». */
  time(): string {
    return this.format(this.start, { hour: '2-digit', minute: '2-digit' });
  }

  /** «пт» — the tile's caption under a month. */
  weekday(): string {
    return this.format(this.start, { weekday: 'short' });
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
      : this.format(this.start, {
          day: 'numeric',
          month: 'long',
          ...this.yearIfElsewhere(this.start),
          hour: '2-digit',
          minute: '2-digit',
        });
  }

  /** «4 септември» — a photo's day, for its name; the visit's own when unreadable. */
  dayLong(iso: string): string {
    const taken = ZonedDateTime.fromISO(iso, this.start.zoneName);
    const day = taken.isSuccess() ? taken.value : this.start;
    return this.format(day, {
      day: 'numeric',
      month: 'long',
      ...this.yearIfElsewhere(day),
    });
  }

  /** «Иван» · «Иван и Петър» — the people, as the locale lists them. */
  list(names: readonly string[]): string {
    return new Intl.ListFormat(this.locale, { type: 'conjunction' }).format(
      names,
    );
  }

  /** The visit's day is today's, on the visit's own calendar. */
  isToday(): boolean {
    return this.now !== null && this.now.toISODate() === this.start.toISODate();
  }

  /** The year only outside the current one (R59). */
  yearIfElsewhere(
    instant: ZonedDateTime,
  ): Pick<Intl.DateTimeFormatOptions, 'year'> {
    return this.now === null || this.now.year === instant.year
      ? {}
      : { year: 'numeric' };
  }

  /** An instant in the locale's form, on the calendar it carries. */
  format(instant: ZonedDateTime, options: Intl.DateTimeFormatOptions): string {
    return instant.toLocaleString(this.locale, options);
  }
}

// ── The waiting request's days ─────────────────────────────────────────

/**
 * The parts of the day the windows touch, in the day's order — the
 * domain's one rule (`daypartsTouchedBy`), the same boundaries the booking
 * time sheet heads its times with, so the line names a window the way the
 * client's picker headed the times they chose from. A day offered whole
 * names none: «чт–пт, следобед» would be untrue of a Thursday that works at
 * any hour.
 */
function daypartsOf(days: readonly DayWindows[]): readonly Daypart[] {
  if (days.length === 0 || days.some((day) => day.isWholeDay())) return [];
  return daypartsTouchedBy(days.flatMap((day) => day.windows));
}

/** A run of consecutive calendar days: one day when `first` is `last`. */
interface DayRun {
  readonly first: DayWindows;
  readonly last: DayWindows;
}

/** Runs of consecutive calendar days, in order — «чт, пт» reads «чт – пт». */
function runsOf(days: readonly DayWindows[]): readonly DayRun[] {
  return VisitStorySystem.dayRuns(
    days.map((day) => DayKey.of(day.day.key())),
  ).map((run) => ({
    first: days[run.first] as DayWindows,
    last: days[run.last] as DayWindows,
  }));
}

/** Inside the coming week: the weekday says it («чт»). */
function withinWeek(day: DayWindows, today: CalendarDay | null): boolean {
  return VisitStorySystem.withinWeek(
    DayKey.of(day.day.key()),
    today === null ? null : DayKey.of(today.key()),
  );
}

/**
 * «чт» inside the coming week, else the date «12.10» (R59) — the range's
 * own date face (`month: '2-digit'`), so a line never says «Oct 12» beside
 * «10/13 – 10/14» in English.
 */
function dayShort(
  day: DayWindows,
  today: CalendarDay | null,
  locale: string,
): string {
  const instant = day.day.startOfDay();
  return withinWeek(day, today)
    ? instant.toLocaleString(locale, { weekday: 'short' })
    : instant.toLocaleString(locale, {
        day: 'numeric',
        month: '2-digit',
        ...(today === null || today.year === day.day.year
          ? {}
          : { year: 'numeric' }),
      });
}

/** «четвъртък» inside the coming week, else «12 октомври» — spelled for a reader. */
function dayLong(
  day: DayWindows,
  today: CalendarDay | null,
  locale: string,
): string {
  const instant = day.day.startOfDay();
  return withinWeek(day, today)
    ? instant.toLocaleString(locale, { weekday: 'long' })
    : instant.toLocaleString(locale, {
        day: 'numeric',
        month: 'long',
        ...(today === null || today.year === day.day.year
          ? {}
          : { year: 'numeric' }),
      });
}

// ── Legacy ↔ ECS converters (Phase 2 shim) ──────────────────────────────

/** A legacy seat outcome → the `SeatOutcome` struct. */
function toEcsOutcome(outcome: SeatOutcome): EcsSeatOutcome {
  switch (outcome.kind) {
    case 'scheduled':
      return EcsSeatOutcome.scheduled();
    case 'worked':
      return EcsSeatOutcome.worked(outcome.atMs);
    case 'no_show':
      return EcsSeatOutcome.noShow(outcome.atMs);
    case 'cancelled':
      return toEcsCancellation(outcome);
  }
}

/** A legacy cancellation → the struct (its stamped window as whole hours). */
function toEcsCancellation(
  cancellation: Cancellation,
): EcsSeatOutcome.Cancelled {
  return {
    kind: 'cancelled',
    atMs: cancellation.atMs,
    by: cancellation.by,
    reason: { kind: cancellation.reason.kind },
    windowHours: cancellation.window?.hours ?? null,
  };
}

/** Who a legacy seat is for, as people are counted. */
function toPersonSubject(seat: Seat): PersonSubject {
  return seat.subject.kind === 'account'
    ? { kind: 'account', userId: seat.subject.userId.value }
    : { kind: 'anonymous', label: seat.subject.label.value };
}
