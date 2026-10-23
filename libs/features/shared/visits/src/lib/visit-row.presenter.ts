import type { Appointment, WaitlistRequest } from '@core/entities';
import {
  type DayWindows,
  type Seat,
  type ShopNow,
  VisitMark,
  VisitStatusMark,
  VisitTone,
} from '@core/components';
import {
  CustomerId,
  LocalDate,
  type LocationId,
  type MinuteOfDay,
  type TimeZone,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  CancelledSide,
  type SubjectStory,
  VisitGrain,
  VisitListSystem,
  VisitPerspective,
  VisitRowOutcome,
  VisitStorySystem,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { daypartWords, pluralForm } from '@creativo/infrastructure/i18n';
import { dayRange } from './day-range';
import type { StaffEventLine } from './event-head/staff-event-line';
import { firstNameOf } from './first-name';
import { UPCOMING_SECTION_KEY } from './visit-sections';
import {
  formatCents,
  formatMinute,
  formatWallClock,
} from '@creativo/ui/wall-clock';
import {
  TrailingFactFace,
  type VisitLookup,
  type VisitRowMark,
  VisitRowEntry,
  type VisitRowVm,
  type VisitTrailing,
  type VisitTrailingFact,
  type VisitWaitlistWords,
  type VisitWords,
} from './visit-row.vm';

/*
 * THE ROW BUILDERS (client-card redesign §5.3.2–§5.3.5) — an appointment,
 * or a waiting request, into the one row both lists draw.
 *
 * Pure on purpose: the words arrive translated (`VisitWords`), the
 * catalogue arrives as a lookup (`VisitLookup`), "now" arrives as the
 * shop's `ShopNow`, derived ONCE by the host (Law 7.3). So the staff sheet
 * builds rows without injecting a catalogue service into specs that never
 * provided one (FE-7), and a row reads the same in a spec, on the client's
 * page and on the staff card.
 *
 * The visit is the FLAT entity straight from its document (flip 1, Law 5):
 * its day and hour are the shop's wall clock (`localDate` +
 * `startMinutes`, Law 7.3) and are printed as stored, and the row carries
 * them as they are, so the list's system sections it with no conversion. A
 * photo's instant is read on the shop's calendar, in the LOCATION's zone
 * (`VisitLookup.locationTimeZone`, the zone "now" was read in while the
 * lookup names none), never the device's. The story's tags are the
 * system's (`VisitRowOutcome`, `CancelledSide`), compared against their
 * dictionaries.
 *
 * The row DECIDES NOTHING (Law 10.2). The story's math — whose seats, the
 * root outcome, the decisive cancellation and its side, the tile's tone,
 * the status a row names, the figure (the whole bill or a share), the
 * marks, whose words are quoted, the shop named, the people counted, the
 * upcoming rule, the runs of watched days — is `VisitStorySystem` in
 * `@core/systems`; the section a row files under is `VisitListSystem`'s;
 * the days a request still watches, their parts and where its row files
 * are `WaitlistSystem`'s. The words, the clock's formatting and the
 * money's stay here, each tag worded through one table.
 */

/** The tile's tone, per the system's tag (`VisitStorySystem.toneOf`). */
const VISIT_TONE_WORDS = {
  [VisitTone.Hollow]: 'hollow',
  [VisitTone.Upcoming]: 'upcoming',
  [VisitTone.Past]: 'past',
} as const satisfies Record<VisitTone, NonNullable<VisitRowVm['tile']>['tone']>;

/**
 * The row's words as the builders read them: `VisitWords`, and the one word
 * revision 3 adds for a row (§2.5, Fresha adopt-now N5), optional:
 * `visitWordsOf` always fills it, so a host that hands its words on as
 * plain `VisitWords` still hands the word on, and a hand-built table
 * without it draws no voucher mark.
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
  /**
   * "Now" on the shop's wall clock, derived ONCE by the host (Law 7.3,
   * `ZonedTimeSystem.shopNow`): every row of a list reads the same one.
   */
  readonly now: ShopNow;
  /**
   * The zone `now` was read in — a photo's day falls back to it when the
   * lookup names no zone for the visit's shop.
   */
  readonly timeZone: TimeZone;
  readonly locale: string;
  /** The visit's photos, counted (`countPhotosByAppointment`): a row's mark. */
  readonly photoCount?: number;
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
  const staff = perspective === VisitPerspective.Staff;
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
          : side === CancelledSide.Client
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
      translate(`clientCard.visits.daypart.${daypartWords[part]}`),
    moreDays: (count) =>
      translate('clientCard.visits.waitlistMoreDays', { count }),
    moreRequests: (count) =>
      translate('clientCard.visits.waitlistMoreRequests', { count }),
  };
}

/**
 * A person's own story of one appointment, as the row tells it. Exported
 * with `storyOf`, `subjectStoryOf`, `visitClockOf` and `distinct` for the
 * card's builders (`visit-card.presenter.ts`, contract delta V1-1): a card
 * is a row told at length, and it reads the same story off the same clock.
 */
export interface VisitStory {
  /** The seats the row is about — the subject's, or the whole party's. */
  readonly seats: readonly Seat[];
  readonly outcome: VisitRowOutcome;
  /** Who called it off — set exactly when the outcome is `CANCELLED`. */
  readonly cancelledBy: CancelledSide | null;
}

/**
 * The shop's zone a visit is read in — its location's, as the lookup names
 * it (`VisitLookup.locationTimeZone`); `null` where the lookup names none,
 * and the caller falls back to the zone it read "now" in.
 */
export function visitZoneOf(
  locationId: LocationId | null,
  lookup: Pick<VisitLookup, 'locationTimeZone'>,
): TimeZone | null {
  return locationId === null
    ? null
    : (lookup.locationTimeZone?.(locationId) ?? null);
}

/** One appointment as a row of either list. */
export function visitRowOf(
  appointment: Appointment,
  options: VisitRowOptions,
  lookup: VisitLookup,
): VisitRowVm {
  const words = options.words;
  const staff = options.perspective === VisitPerspective.Staff;
  // One reading per list: every row shares the host's `now`.
  const now = options.now;
  const at = visitClockOf(
    appointment.localDate,
    appointment.startMinutes,
    now,
    options.locale,
    visitZoneOf(appointment.locationId, lookup) ?? options.timeZone,
  );
  const story = subjectStoryOf(appointment, options);
  const id: string = appointment.id;
  const current = id === options.currentAppointmentId;
  const start = {
    localDate: appointment.localDate,
    minute: appointment.startMinutes,
  };
  const upcoming = VisitStorySystem.isUpcoming(story.outcome, start, now);
  const struck = VisitStorySystem.isVoid(story.outcome);

  const title =
    distinct(
      seatsOf(appointment, story).map((seat) =>
        lookup.serviceName(seat.serviceId),
      ),
    ).join(' · ') || words.unknownService;

  const barberIds = VisitStorySystem.subjectBarberIds(appointment, story);
  const barberNames = barberIds.map(
    (barberId) => lookup.barberName(barberId) ?? words.barberRole,
  );

  const status = appointment.bookingStatus;
  const statusMark = VisitStorySystem.statusMark(story.outcome, status);
  const cancelledWord =
    story.cancelledBy === null ? null : words.cancelledBy(story.cancelledBy);
  // The row words a no-show and an hour the shop has not confirmed; any
  // other row says how it was called off, or nothing.
  const statusWord =
    statusMark === VisitStatusMark.NoShow
      ? words.noShow
      : statusMark === VisitStatusMark.Pending
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
      options.grain === VisitGrain.Month
        ? at.weekday()
        : words.tileMonth(day.month),
    day: day.day,
    tone: VISIT_TONE_WORDS[VisitStorySystem.toneOf(story.outcome, start, now)],
  };

  const base = {
    id,
    visitRowEntry: VisitRowEntry.Visit,
    // The shop's wall clock, as stored — the order within a section.
    localDate: appointment.localDate,
    startMinutes: appointment.startMinutes,
    sectionKey: VisitListSystem.rowSectionKey(
      upcoming,
      appointment.localDate,
      options.grain,
    ),
    upcoming,
    tile,
    leadingIcon: null,
    title,
    struck,
    outcome: story.outcome,
    // The STORED tag (F1-9): the client row's `data-status` reads it.
    bookingStatus: status,
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
  const peers = VisitStorySystem.peerCountOf(appointment, story);
  const peersText = peers > 0 ? words.withPeers(peers) : null;
  // The shop as a line names it: its short name, without the tenant's brand
  // that every shop shares (`VisitLookup.locationName`).
  const locationText = VisitStorySystem.namesShop(
    story.outcome,
    lookup.locationCount,
  )
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
    : story.outcome === VisitRowOutcome.Open
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

  // The figure is the system's (the whole bill, or the subject's share); the
  // row only prints it.
  const figure = VisitStorySystem.subjectFigure(appointment, story);
  const price =
    figure === null
      ? null
      : formatCents(figure.amountCents, figure.currency, options.locale);

  // THE FACE keeps the trailing edge, as on the client's own list (revision
  // 3 §2.5: that is the sameness). Who cut, by the name the shop knows them
  // by; a visit cut by several draws no face and names the group, and the
  // fact line still lists every one of them.
  const soleBarber = barberIds.length === 1 ? (barberIds[0] ?? null) : null;
  const trailing: VisitTrailing =
    barberIds.length === 0
      ? null
      : {
          avatarSrc:
            soleBarber === null ? null : lookup.barberAvatarSrc(soleBarber),
          name:
            soleBarber === null
              ? words.severalBarbers(barberIds.length)
              : (barberNames[0] ?? words.barberRole),
          several: barberIds.length > 1,
        };

  // THE STAFF'S FACT ends the second line: money, a state in words, or
  // «Този час». At most one. The figure is charged and primary on a worked
  // visit, booked, secondary and struck on one that did not happen (the
  // system gives a figure to a worked or a cancelled visit only).
  const trailingFact: VisitTrailingFact = current
    ? { trailingFactFace: TrailingFactFace.Badge, text: words.thisVisit }
    : price !== null
      ? {
          trailingFactFace: TrailingFactFace.Amount,
          text: price,
          emphasis: struck ? 'secondary' : 'primary',
          struck,
        }
      : statusMark === VisitStatusMark.NoShow
        ? {
            trailingFactFace: TrailingFactFace.Status,
            icon: 'visit.noShow',
            text: words.noShow,
            tone: 'warning',
          }
        : statusMark === VisitStatusMark.Pending
          ? {
              trailingFactFace: TrailingFactFace.Status,
              icon: 'visit.pending',
              text: words.statusPending,
              tone: 'neutral',
            }
          : null;

  // Which marks a row carries, and in what order, is the system's
  // (`VisitStorySystem.marksOf`): the row gives each its glyph and word.
  const photoCount = options.photoCount ?? 0;
  const marks: VisitRowMark[] = [];
  for (const mark of VisitStorySystem.marksOf(appointment, story, photoCount)) {
    const drawn = rowMarkOf(mark, words, photoCount);
    if (drawn !== null) marks.push(drawn);
  }

  // The client's own words belong to whoever booked
  // (`VisitStorySystem.quotesBooker`): on a party someone else booked they
  // are the booker's, and the row does not carry them — nor to a viewer who
  // may not read them.
  const quoted =
    options.clientWords !== false &&
    VisitStorySystem.quotesBooker(appointment, userIdOf(options.subjectUserId))
      ? appointment.contactNote
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
  // The days it still watches come FIRST (every fact below reads them): a
  // request whose every day has passed is the host's to leave out; drawn
  // anyway, it names what it asked for rather than nothing.
  const days = WaitlistSystem.daysAhead(request.flexibleDays, today);

  const services =
    distinct(
      request.cartSeats.flatMap((seat) =>
        seat.lines.map((line) => lookup.serviceName(line.serviceId)),
      ),
    ).join(' · ') || words.unknownService;

  const parts = WaitlistSystem.daypartsWatched(days);
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
  // The first watched day, from its first minute — the order within the
  // upcoming run; a request that watches no day files first (§9 R-4).
  const point = WaitlistSystem.sortPoint(days);

  return {
    id: request.id,
    visitRowEntry: VisitRowEntry.Waitlist,
    localDate: point.localDate,
    startMinutes: point.minute,
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
    bookingStatus: null,
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
  const story = subjectStoryOf(appointment, options);
  return {
    seats: seatsOf(appointment, story),
    outcome: story.outcome,
    cancelledBy: story.cancelledBy,
  };
}

/**
 * The system's story of one appointment (`VisitStorySystem.subjectStory`),
 * keyed by the client record `VisitStorySystem.subjectRecordOf` reads off
 * the host's options — the one the host named, else the one the ACCOUNT
 * seat of `subjectUserId` links to. The row and the card ask the system
 * every question of the story with it.
 */
export function subjectStoryOf(
  appointment: Appointment,
  options: Pick<
    VisitRowOptions,
    'perspective' | 'subjectUserId' | 'subjectCustomerId'
  >,
): SubjectStory {
  return VisitStorySystem.subjectStory(
    appointment,
    VisitStorySystem.subjectRecordOf(
      appointment,
      namedRecordOf(options.subjectCustomerId),
      userIdOf(options.subjectUserId),
    ),
    options.perspective === VisitPerspective.Staff,
  );
}

/** The seats a story is about, in the appointment's order — for the catalogue's names. */
function seatsOf(
  appointment: Appointment,
  story: SubjectStory,
): readonly Seat[] {
  return story.seatIndexes.map((index) => appointment.seats[index] as Seat);
}

/**
 * The record the host named, branded at the edge (a document id the host
 * read): `undefined` names none, `null` names a guest.
 */
function namedRecordOf(
  named: string | null | undefined,
): CustomerId | null | undefined {
  return named === undefined || named === null ? named : CustomerId.of(named);
}

/** The subject's account, branded at the edge (a uid the host read); `null` is a guest. */
function userIdOf(subjectUserId: string | null): UserId | null {
  return subjectUserId === null ? null : UserId.of(subjectUserId);
}

/**
 * A mark as the row draws it, per the system's tag
 * (`VisitStorySystem.marksOf`) — its glyph and its hidden word. A table
 * without the voucher's word (`VisitBuilderWords.voucher`) draws no
 * voucher mark.
 */
function rowMarkOf(
  mark: VisitMark,
  words: VisitBuilderWords,
  photoCount: number,
): VisitRowMark | null {
  switch (mark) {
    case VisitMark.Photos:
      return {
        icon: 'client.photos',
        label: words.photos(photoCount),
        count: photoCount,
      };
    case VisitMark.Discount:
      return { icon: 'promo.coupon', label: words.discount, count: null };
    case VisitMark.Voucher:
      return words.voucher === undefined
        ? null
        : { icon: 'promo.voucher', label: words.voucher, count: null };
  }
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
 * A visit's wall-clock start, read against the shop's "now" — ONE clock for
 * the row and the card (a card is a row told at length). The day and the
 * minute print as stored (`formatWallClock`); a photo's instant is read on
 * the shop's calendar (`timeZone`, the location's). The row's faces and the
 * card's own date faces (`dayShort`, `weekdayAndDay`, `whenHeard`: a row
 * never prints its date) sit side by side.
 */
export type VisitClock = {
  /** «10:00». */
  readonly time: () => string;
  /** «пт» — the tile's caption under a month. */
  readonly weekday: () => string;
  /**
   * «днес, 10:00» · «пт, 10:00» — an hour still to come, in the fact line:
   * the day, then the time, two readings joined the same way whichever the
   * day is (`Intl`'s own weekday-and-time pattern appends « ч.» in bg).
   */
  readonly whenShort: (today: string) => string;
  /** «4 септември в 10:00» — the row's name, where a reader hears the month (R59). */
  readonly whenLong: (today: string) => string;
  /** «4 септември» — a photo's day, for its name; the visit's own day without one. */
  readonly dayLong: (takenAtUtcMs?: UtcEpochMs) => string;
  /** «Иван» · «Иван и Петър» — the people, as the locale lists them. */
  readonly list: (names: readonly string[]) => string;
  /** The visit's day is today's, on the shop's calendar. */
  readonly isToday: () => boolean;
  /** The year only outside the current one (R59). */
  readonly yearIfElsewhere: (
    day: LocalDate,
  ) => Pick<Intl.DateTimeFormatOptions, 'year'>;
  /** «5.09» — a last visit's day on the card (R59); the year only outside the current one. */
  readonly dayShort: () => string;
  /** «пт, 23.10» — the day of a visit to come, as `/account` has always printed it. */
  readonly weekdayAndDay: () => string;
  /** «петък, 23 октомври в 10:00» · «днес, 10:00» — a card's visit to come, heard. */
  readonly whenHeard: (today: string) => string;
};

/** The clock of one visit — its shop day and minute, against the shop's `now`. */
export function visitClockOf(
  localDate: LocalDate,
  minute: MinuteOfDay,
  now: ShopNow,
  locale: string,
  timeZone: TimeZone,
): VisitClock {
  const time = (): string => formatMinute(minute, locale);

  const weekday = (): string =>
    formatWallClock(localDate, null, locale, { weekday: 'short' });

  const isToday = (): boolean => now.localDate === localDate;

  const yearIfElsewhere = (
    day: LocalDate,
  ): Pick<Intl.DateTimeFormatOptions, 'year'> =>
    LocalDate.parts(now.localDate).year === LocalDate.parts(day).year
      ? {}
      : { year: 'numeric' };

  const whenShort = (today: string): string =>
    `${isToday() ? today : weekday()}, ${time()}`;

  const whenLong = (today: string): string =>
    isToday()
      ? `${today}, ${time()}`
      : formatWallClock(localDate, minute, locale, {
          day: 'numeric',
          month: 'long',
          ...yearIfElsewhere(localDate),
          hour: '2-digit',
          minute: '2-digit',
        });

  const dayLong = (takenAtUtcMs?: UtcEpochMs): string => {
    const day =
      takenAtUtcMs === undefined
        ? localDate
        : ZonedTimeSystem.toLocal(takenAtUtcMs, timeZone).localDate;
    return formatWallClock(day, null, locale, {
      day: 'numeric',
      month: 'long',
      ...yearIfElsewhere(day),
    });
  };

  const list = (names: readonly string[]): string =>
    listFormat(locale).format(names);

  const dayShort = (): string =>
    formatWallClock(localDate, null, locale, {
      day: 'numeric',
      month: 'short',
      ...yearIfElsewhere(localDate),
    });

  const weekdayAndDay = (): string =>
    formatWallClock(localDate, null, locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...yearIfElsewhere(localDate),
    });

  const whenHeard = (today: string): string =>
    isToday()
      ? `${today}, ${time()}`
      : formatWallClock(localDate, minute, locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          ...yearIfElsewhere(localDate),
          hour: '2-digit',
          minute: '2-digit',
        });

  return {
    time,
    weekday,
    whenShort,
    whenLong,
    dayLong,
    list,
    isToday,
    yearIfElsewhere,
    dayShort,
    weekdayAndDay,
    whenHeard,
  };
}

// ── The waiting request's days ─────────────────────────────────────────

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
