import {
  AppliedDiscount,
  BookingLifecycle,
  ChairMoment,
  CouponValue,
  DiscountProvenance,
  GridEvent as GridEventTag,
  type MinuteRange,
  type Money,
  Seat,
  SeatOutcome,
  SeatSubject,
  type ShopNow,
  TimeCoordinate,
  VoucherRedemption,
  WallTime,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  type AppointmentId,
  type BarberId,
  BookingStatus,
  Currency,
  DraftPersonKey,
  DurationMinutes,
  type EndMinute,
  type LocalDate,
  MinuteCount,
  type MinuteOfDay,
  type PersonKey,
  type PriceCents,
  type TimeZone,
  type UserId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  AppointmentLifecycleSystem,
  BillingSystem,
  BusySystem,
  OfferingPriceSystem,
  PhoneSystem,
  RosterSystem,
  VisitDraftSystem,
  VisitStorySystem,
  ZonedTimeSystem,
} from '@core/systems';
import type { UiIconName } from '@creativo/ui/controls';
import {
  formatCents,
  formatInstant,
  formatWallClock,
} from '@creativo/ui/wall-clock';
import {
  bookingStatusWords,
  cancellationReasonWords,
  relativeTime,
} from '@creativo/infrastructure/i18n';
import {
  firstNameOf,
  hollowStatus,
  type StaffEventLine,
} from '@creativo/features/shared/visits';
import type { AgendaField } from '../agenda-fields';
import { ROW_VERB_WORD, type RowVerb } from '../row-verb';
import { catalogTagWords } from '../shared/catalog-tag.words';
import { spanCopyOf, spanWords } from '../shared/span.words';
import { fill } from '../time-grid/grid-gesture';
import type { AllDayEntry, GridEvent } from '../time-grid/staff-time-grid';
import type {
  VisitEditorClientOption,
  VisitEditorDiscount,
  VisitEditorResolution,
  VisitEditorVerb,
  VisitEditorVoucher,
} from '../visit-editor/staff-visit-editor';
import {
  ALL_DAY_MORE_KEY,
  type AgendaCardVm,
  AgendaRow,
  type DayRowVm,
  type FrameNeighbour,
  type GapRowVm,
  type LaneVm,
  STATUS_ICONS,
  type StaffDayWords,
  type StaffTranslate,
} from './staff-day.vm';
import type { StaffCatalogNames } from './staff-day-chrome.presenter';
import { guestLabelsOf } from './staff-day-guest.words';

/*
 * THE STAFF DAY, WORDED (Law 10). The row's state, its verbs, what is next and
 * what is live are `VisitStorySystem`'s, `VisitListSystem`'s and
 * `AppointmentLifecycleSystem`'s; these functions turn the answers into what
 * the agenda's card, the grid's block and the sheets print. Pure — the words,
 * the catalogue's lookups, the agenda's switches and `now` arrive as inputs,
 * and the page calls them inside the `computed()`s that read those.
 */

/** The day's words, from the catalogue as it stands. */
export function staffDayWordsOf(
  translate: StaffTranslate,
  minutesPattern: string | null,
): StaffDayWords {
  return {
    unnamedClient: translate('staff.day.unnamedClient'),
    statusName: (status) =>
      translate(`appointments.status.${bookingStatusWords[status]}`),
    exception: (status) =>
      translate(`staff.day.exception.${bookingStatusWords[status]}`),
    noShow: translate('staff.visit.resolution.noShow'),
    arrived: translate('staff.day.statusArrived'),
    remaining: (span) => translate('staff.day.agendaRemaining', { span }),
    rowMenu: (client, time) => translate('staff.day.rowMenu', { client, time }),
    cancelReason: (reason) =>
      translate(
        `staff.day.cancelReasonCode.${cancellationReasonWords[reason]}`,
      ),
    verb: (key) => translate(key),
    partyOf: (count) => translate('staff.day.partyOf', { count }),
    blocked: translate('staff.day.blockedLabel'),
    span: spanCopyOf(translate),
    daySummaryFree: (span) => translate('staff.day.daySummaryFree', { span }),
    daySummaryTips: (amount) =>
      translate('staff.day.daySummaryTips', { amount }),
    offBadge: translate('staff.day.offBadge'),
    offChip: (name) => translate('staff.day.offChip', { name }),
    allDayMore: (count) => translate('staff.day.allDayMore', { count }),
    clientReturning: translate('staff.visit.clientReturning'),
    newVisitTitle: translate('staff.visit.newTitle'),
    lastVisit: (date) => translate('staff.visit.lastVisit', { date }),
    recentClients: translate('staff.visit.clientsRecent'),
    minutesPattern,
  };
}

/**
 * The page's clock face — «13:00», 24-hour: in the reader's locale on the
 * rows, in `en-GB` in a block's accessible name.
 */
export const CLOCK_FACE: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/** A stored wall-clock reading — the visit's own day and minute — as the page's clock. */
export function wallClockLabel(
  localDate: LocalDate,
  minute: MinuteOfDay | EndMinute,
  locale: string,
): string {
  return formatWallClock(localDate, minute, locale, CLOCK_FACE);
}

// ── The row ───────────────────────────────────────────────────────────

/** The catalogue as a row reads it — the page's live lookups. */
export interface DayRowNames extends StaffCatalogNames {
  readonly barberName: (id: BarberId) => string;
  readonly barberAvatarSrc: (id: BarberId) => string | null;
  readonly toneOf: (id: BarberId) => number;
}

/** What every row is worded from — the page reads it once per change. */
export interface DayRowContext {
  /** The page's tick; a seat's outcome is summarized against it. */
  readonly nowUtcMs: UtcEpochMs;
  /** The shop's clock (`null` before the zone is known). */
  readonly shopNow: ShopNow | null;
  /** The day's zone, for the stamps on the sheet's head. */
  readonly zone: TimeZone | null;
  /** The wall clock's locale (`CatalogWording.locale`). */
  readonly locale: string;
  /** Money's locale, the active language. */
  readonly lang: string;
  /** Companions by account, as their own profiles name them (`resolveCompanionNames`). */
  readonly companionNames: Readonly<Record<string, string>>;
  readonly words: StaffDayWords;
  readonly names: DayRowNames;
}

/**
 * A ROW'S NAME — the aggregate it belongs to, plus the lane it is drawn in.
 *
 * `#` is safe as the seam: both halves are ids the app mints itself
 * (Firestore doc ids and barber slugs), and neither can contain one. The key
 * is opaque — nothing parses it back apart, because everything that needs the
 * appointment reads `DayRowVm.appointmentId` instead.
 */
function rowKey(appointmentId: AppointmentId, barberId: BarberId): string {
  return `${appointmentId}#${barberId}`;
}

/** The same sum, formatted («27,50 €»). */
function seatsPrice(seats: readonly Seat[], lang: string): string | null {
  const sum = BillingSystem.subtotalOf(seats);
  return sum.ok
    ? formatCents(sum.value.amountCents, sum.value.currency, lang)
    : null;
}

/**
 * What this chair's seats were tipped, as a figure and in cents.
 *
 * `null` on both when NOT ONE seat carries a recording — which is not the
 * same as a chair that was tipped nothing, and is why an unrecorded row
 * offers `＋ Добави бакшиш` while a zero one states `0,00 €`.
 */
function seatsTip(
  seats: readonly Seat[],
  lang: string,
): {
  readonly tipLabel: string | null;
  readonly tipCents: PriceCents | null;
} {
  const first = seats[0];
  // Mixed currencies within one chair is a data error, not a feature;
  // the tips are read in the chair's own currency (`BillingSystem.tipsOf`).
  const total =
    first === undefined ? null : BillingSystem.tipsOf(seats, first.currency);
  if (total === null) return { tipLabel: null, tipCents: null };
  return {
    tipLabel: formatCents(total.amountCents, total.currency, lang),
    tipCents: total.amountCents,
  };
}

/**
 * When a stamp landed, in shop time: the clock alone on the visit's own
 * day, the day before it otherwise — in the day pill's short form, so a
 * cancellation the evening before reads `24.08, 18:40`.
 */
function stampLabel(
  atUtcMs: UtcEpochMs,
  visitLocalDate: LocalDate,
  zone: TimeZone | null,
  locale: string,
): string {
  // `''` before the zone is known: the page shows nothing then anyway.
  if (zone === null) return '';
  if (ZonedTimeSystem.toLocal(atUtcMs, zone).localDate === visitLocalDate) {
    return formatInstant(atUtcMs, zone, locale, CLOCK_FACE);
  }
  return formatInstant(atUtcMs, zone, locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * WHAT SETTLED THIS CHAIR, for the sheet's head (owner, 2026-09-11: "the
 * cancellation reason or no-show is not showing in the event detail
 * sheets").
 *
 * From the chair's OWN seats, the same way its status is
 * (`VisitStorySystem.chairResolution`, DEP-1): the stamp that closed the
 * last of them is the moment; a cancellation's side is the one the card's
 * rows and the statistics read — the seat called off last, by its reason
 * first; and the reasons are the DISTINCT ones — a father and son called
 * off together for one reason read as one line, not two. A reason nobody
 * gave adds nothing rather than "no reason", and «Друго» is the barber's
 * own words. `null` on a live chair and on a finished one. The clock and
 * the reason words are this page's.
 */
function resolutionOf(
  seats: readonly Seat[],
  status: BookingStatus,
  visitLocalDate: LocalDate,
  context: DayRowContext,
): VisitEditorResolution | null {
  const resolution = VisitStorySystem.chairResolution(status, seats);
  if (resolution === null) return null;
  const details = new Set<string>();
  for (const reason of resolution.reasons) {
    details.add(context.words.cancelReason(reason));
  }
  return {
    // What settled the chair — the stored tag the system narrowed.
    bookingStatus: resolution.bookingStatus,
    by: resolution.cancelledBy,
    whenLabel: stampLabel(
      resolution.atUtcMs,
      visitLocalDate,
      context.zone,
      context.locale,
    ),
    detail: details.size > 0 ? [...details].join(' · ') : null,
  };
}

/**
 * The chair's catalogue minutes for a seat's service and variant, or
 * nothing when the catalogue no longer knows the service — the seat's own
 * booked terms then stand in, exactly as they do on the sheet.
 */
export function chairMinutesOf(
  seat: Seat,
  barberId: BarberId,
  names: Pick<StaffCatalogNames, 'findService'>,
): DurationMinutes | null {
  const service = names.findService(seat.serviceId);
  if (service === undefined) return null;
  // The server's resolution (`OfferingPriceSystem.termsFor`): a chair
  // that does not perform the service is measured against the service's
  // own minutes — never against another chair's offering.
  return OfferingPriceSystem.termsFor(service, barberId, seat.variantId)
    .durationMinutes;
}

/**
 * The frame's tag, on the row: the run's distance from the catalogue.
 *
 * The pattern («{{minutes}} мин») is read FIRST, off the loaded table,
 * and filled here — the way the editors word their drag readouts — so
 * every row depends on the table: built before `bg.json` has landed, the
 * tag is withheld rather than printed as its key, and the row is rebuilt
 * the moment the words are there (review r4, 2026-10-06).
 */
function catalogTag(
  seats: readonly Seat[],
  barberId: BarberId,
  startMinute: MinuteOfDay,
  endMinute: EndMinute,
  context: DayRowContext,
): string | null {
  const pattern = context.words.minutesPattern;
  if (pattern === null) return null;
  // The chair's run on the shop's wall clock (DEP-8). A visit lasts a
  // positive whole number of minutes by construction, so a span that is
  // not one is a broken invariant, never an input.
  const span = DurationMinutes.of(MinuteCount.span(startMinute, endMinute));
  if (!span.ok) {
    return defect(`not a visit's span: ${startMinute}–${endMinute}`);
  }
  // A seat the catalogue no longer knows stands at its booked length.
  const sold = VisitDraftSystem.catalogMinutesOf(
    seats.map((seat) => ({
      catalogMinutes: chairMinutesOf(seat, barberId, context.names),
      bookedMinutes: seat.durationMinutes,
    })),
  );
  return catalogTagWords(
    VisitDraftSystem.minutesDelta(span.value, sold),
    (minutes) => fill(pattern, { minutes }),
  );
}

/**
 * The bill's discounts as the sheet reads them — every snapshot, in stored
 * order: its provenance and its value as the domain stored them (exactly
 * their variants' fields), with the coupon's name, the grant it honoured,
 * the code it was opened with and whether it must be alone on the bill.
 */
export function discountsOf(appointment: Appointment): VisitEditorDiscount[] {
  return appointment.discounts.map((applied) => ({
    ...DiscountProvenance.sliceOf(applied),
    ...CouponValue.sliceOf(applied),
    label: applied.label,
    grantId: DiscountProvenance.grantIdOf(applied),
    code: DiscountProvenance.codeOf(applied),
    exclusive: AppliedDiscount.isExclusive(applied),
  }));
}

/**
 * The vouchers still paying the bill. `availableCents` is what THIS visit
 * may draw on that voucher if the bill changes: its own amount plus what
 * the voucher had left after it — the server re-clamps on save.
 */
export function vouchersOf(appointment: Appointment): VisitEditorVoucher[] {
  return appointment.voucherRedemptions
    .filter(VoucherRedemption.isLive)
    .map((redemption) => ({
      voucherId: redemption.voucherId,
      code: redemption.code,
      availableCents: VoucherRedemption.drawableCents(redemption),
    }));
}

/**
 * The names of a chair that holds companion accounts and nobody else, each
 * person once; `null` for any other chair, and while any of them has no read
 * profile.
 */
function companionsLabelOf(
  seats: readonly Seat[],
  companionNames: Readonly<Record<string, string>>,
): string | null {
  const names = new Set<string>();
  for (const seat of seats) {
    if (seat.seatSubject !== SeatSubject.Account) return null;
    if (!Seat.isCompanion(seat)) return null;
    const name = companionNames[seat.subjectUserId];
    if (name === undefined) return null;
    names.add(name);
  }
  return names.size === 0 ? null : [...names].join(' + ');
}

/**
 * One lane's view of one appointment.
 *
 * Only THIS chair's seats: a two-barber party appears in both lanes, each
 * lane naming its own work. The state, the verbs and the fold are the systems'
 * (`SeatOutcome.summarize`, `AppointmentLifecycleSystem`, `VisitStorySystem`);
 * this words them. `isNext` is the lane's to set.
 */
export function dayRowVm(
  appointment: Appointment,
  barberId: BarberId,
  context: DayRowContext,
): DayRowVm {
  const { nowUtcMs, shopNow, words, names, companionNames } = context;
  const seats = Seat.ofChair(appointment.seats, barberId);
  const first = seats[0];
  // The chair's own span on the visit's shop day (Law 7.3).
  const { startMinutes: startMinute, endMinutes: endMinute } = Seat.chairSpan(
    seats,
    appointment,
  );
  // HAS IT BEGUN, HAS IT ENDED — on the shop's wall clock, against the
  // store's `ShopNow` (Law 7.3 T1, pass D D-6): the visit's day and the
  // chair's minutes, never an instant. Neither before a zone is known.
  const start = WallTime.of(appointment.localDate, startMinute);
  const ended =
    shopNow !== null &&
    VisitStorySystem.hasEnded(
      { localDate: appointment.localDate, minute: endMinute },
      shopNow,
    );

  const serviceLabel = seats
    .map((seat) => {
      const service = names.findService(seat.serviceId);
      return service ? names.text(service.name) : seat.serviceId;
    })
    .join(' + ');

  /*
   * WHO IS IN THIS CHAIR — not who made the booking. (owner ruling
   * 2026-09-03)
   *
   * The contact used to win outright, which named the booker in every lane
   * of a party: a father booked for himself with Ivan and his son with
   * Stefan, and Stefan's row said "Стоян Колев" — the son was invisible in
   * the whole staff app, and the two rows were indistinguishable.
   *
   * A row is one chair's share, so it is named by the people sitting in it.
   * When every seat here is a guest, their labels are the name; the contact
   * is still the number to ring, which is the only job it had. A chair
   * holding the account holder — alone or beside a guest — keeps the
   * contact's name, because that IS the person in it.
   */
  const contactName = appointment.contactName;
  const contactPhone = appointment.contactPhone;
  const phoneLabel =
    contactPhone === null
      ? null
      : PhoneSystem.formatInternational(contactPhone);
  const guestLabels = guestLabelsOf(seats);
  const allGuests = seats.length > 0 && guestLabels.length === seats.length;
  const contactLabel: string =
    (allGuests ? guestLabels.join(' + ') : contactName) ??
    guestLabels[0] ??
    words.unnamedClient;
  // A chair holding only companions is named by them (B4, the rule above),
  // once their profiles are read: a seat holds no name of its own for them.
  const clientLabel = companionsLabelOf(seats, companionNames) ?? contactLabel;

  /*
   * THE PEOPLE, from the seats themselves. `clientLabel` above is one
   * string for the row; the sheet needs each person as their own key so a
   * party keeps its grammar when reopened (owner ruling 2026-09-08). The
   * booker's own seat carries the contact; a guest carries only their
   * label, which is all the shop holds about them.
   *
   * A COMPANION ACCOUNT IS NOT THE BOOKER (client-card-redesign §3.1.4,
   * the P0 audit's defect): the contact is the booker's, so a son booked
   * by his father never wears the father's name or number. He is named
   * by his own profile once it is read (`companionNames`), and his card
   * reads `users/{uid}` itself; his number is his profile's, never the
   * booking's.
   */
  // Each person by the sheet's draft key (`DraftPersonKey`): a guest by
  // `guest-<label>`, an account by its uid — no address is known for any
  // of them here (`email: null`, what the client search reads as none).
  // A walk-in (OR-26) is a guest by label here too: the seat holds only
  // its label and its record's id, and the contact is the record's. The
  // record's id rides as its own field (S-RU-15) — what opens the
  // walk-in's card keyed by the record (S-WS-F); an anonymous seat has
  // none.
  const personOf = (seat: Seat): VisitEditorClientOption => {
    switch (seat.seatSubject) {
      case SeatSubject.Anonymous:
      case SeatSubject.WalkIn:
        return {
          id: DraftPersonKey.guest(seat.guestLabel),
          label: seat.guestLabel,
          phone: null,
          phoneHref: null,
          meta: null,
          email: null,
          customerId:
            seat.seatSubject === SeatSubject.WalkIn
              ? seat.subjectCustomerId
              : null,
        };
      case SeatSubject.Account:
        return Seat.wearsBookingContact(seat)
          ? {
              id: DraftPersonKey.account(seat.subjectUserId),
              label: contactName ?? words.unnamedClient,
              phone: phoneLabel,
              phoneHref: contactPhone,
              meta: null,
              email: null,
            }
          : {
              id: DraftPersonKey.account(seat.subjectUserId),
              label: companionNames[seat.subjectUserId] ?? words.unnamedClient,
              phone: null,
              phoneHref: null,
              meta: null,
              email: null,
            };
    }
  };
  // One entry per PERSON, the first of their seats — the people key of
  // the server's party check (`VisitStorySystem.personKeyOf`).
  const peopleSeen = new Set<PersonKey>();
  const people: VisitEditorClientOption[] = [];
  for (const seat of seats) {
    const key = VisitStorySystem.personKeyOf(seat);
    if (peopleSeen.has(key)) continue;
    peopleSeen.add(key);
    people.push(personOf(seat));
  }

  /*
   * THIS CHAIR'S status, not the party's (found live, 2026-09-11).
   *
   * A party across two chairs is one appointment whose ROOT stays
   * `CONFIRMED` while any seat is still scheduled — so a guest cancelled
   * out of it kept reading as a live visit on his own chair, the sheet
   * offered «Откажи часа» a second time, and the server refused it as
   * already resolved with nothing the sheet could say but "something went
   * wrong". Once every seat on this chair is resolved, the chair's own
   * outcome is the row's status: the domain's fold (`SeatOutcome.summarize`
   * — cancelled if all cancelled, completed if any worked, else no-show),
   * applied to this chair's seats. A chair with a seat still open keeps
   * the root's word, as before; a one-chair visit is unchanged, because
   * the root was folded from the same seats when it was written.
   */
  const chairLifecycle = SeatOutcome.summarize(seats, appointment, nowUtcMs);
  const status = chairLifecycle.bookingStatus;
  // What the graph allows from the CHAIR, plus the same-day correction
  // edge (owner ruling 2026-09-08) — the root settled the same way and the
  // shop still in the visit's day (`offeredVerbs`, over `reopenable`).
  const legal = AppointmentLifecycleSystem.offeredVerbs(
    chairLifecycle,
    appointment,
    appointment.localDate,
    shopNow?.localDate ?? null,
  );
  const arrived = appointment.arrivedAtUtcMs !== null;
  // Which verb leads, drawn from the legal set (`leadVerb`).
  const primary = AppointmentLifecycleSystem.leadVerb(
    chairLifecycle,
    legal,
    arrived,
  );
  const seatCount = appointment.seats.length;
  /*
   * "1 / 2" — this chair's share over the whole party.
   *
   * It was computed here and rendered NOWHERE, while the only party mark the
   * agenda drew was a `+N` keyed on `seatsHere`, which counts one chair. A
   * party split across two chairs has `seatsHere === 1` in both of them, so
   * the one case that most needs saying so — two rows, same time, same
   * booking, different barbers — was the exact case that showed nothing.
   */
  // «1/2», set tight (owner, 2026-09-16): a share, not a sum.
  const partyLabel = seatCount > 1 ? `${seats.length}/${seatCount}` : null;
  const note = appointment.contactNote?.trim() || null;
  // What the chair's seats come to, in the seats' own currency — the
  // shop's one for a chair holding none, or a mixed one (no figure then).
  const subtotal = BillingSystem.subtotalOf(seats);

  return {
    agendaRow: AgendaRow.Visit,
    id: rowKey(appointment.id, barberId),
    appointmentId: appointment.id,
    revision: appointment.revision,
    locationId: appointment.locationId,
    seatId: first?.seatId ?? null,
    seatIds: seats.map((seat) => seat.seatId),
    selfSeat: seats.some((seat) => Seat.isOwnAccount(seat)),
    ownerUserId: appointment.ownerUserId,
    ownerCustomerId: appointment.ownerCustomerId,
    arrived,
    arrivedAtUtcMs: appointment.arrivedAtUtcMs,
    localDate: appointment.localDate,
    startMinute,
    endMinute,
    // The chair's instants off the STORED start (`TimeCoordinate.instantAt`,
    // D-6.5) — the countdown's and the live remaining's only.
    startUtcMs: TimeCoordinate.instantAt(appointment, startMinute),
    endUtcMs: TimeCoordinate.instantAt(appointment, endMinute),
    partySize: seatCount,
    seatsHere: seats.length,
    // The stored wall clock, printed as stored (Law 7.3).
    startLabel: wallClockLabel(
      appointment.localDate,
      startMinute,
      context.locale,
    ),
    endLabel: wallClockLabel(appointment.localDate, endMinute, context.locale),
    tag: catalogTag(seats, barberId, startMinute, endMinute, context),
    priceLabel: seatsPrice(seats, context.lang),
    // In cents — what a tip preset is a share of. `subtotalOf` refuses
    // two currencies: a party mixed-currency has no number at all rather
    // than a wrong one.
    priceCents: subtotal.ok ? subtotal.value.amountCents : null,
    currency: subtotal.ok
      ? subtotal.value.currency
      : (first?.currency ?? Currency.EUR),
    barberName: names.barberName(barberId),
    barberAvatarSrc: names.barberAvatarSrc(barberId),
    barberTone: names.toneOf(barberId),
    past: ended,
    live: VisitStorySystem.isInChair(
      chairLifecycle,
      start,
      { localDate: appointment.localDate, minute: endMinute },
      shopNow,
    ),
    // Set by the lane, which is the only scope that can know which visit is
    // FIRST — a row cannot see its siblings.
    isNext: false,
    // One shop day per visit (F-6): a chair that runs to the closing
    // midnight ends on the next day's first instant — mark it, never move it.
    crossesMidnight: endMinute >= 24 * 60,
    serviceLabel,
    clientLabel,
    contactLabel,
    phone: phoneLabel,
    phoneHref: contactPhone,
    email: appointment.contactEmail,
    rebooked: appointment.bookedFromAppointmentId !== null,
    // The note's EXISTENCE is a row signal; its prose belongs in the sheet.
    hasNote: note !== null,
    note,
    partyLabel,
    ...seatsTip(seats, context.lang),
    discounts: discountsOf(appointment),
    vouchers: vouchersOf(appointment),
    resolution: resolutionOf(seats, status, appointment.localDate, context),
    people,
    legs: seats.map((seat) => {
      const service = names.findService(seat.serviceId);
      const seatBarberId = seat.barberId;
      return {
        seatId: seat.seatId,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        clientId: personOf(seat).id,
        serviceLabel: service ? names.text(service.name) : seat.serviceId,
        durationMinutes: seat.durationMinutes,
        // The same resolver the card's tag reads, so the frame agrees.
        catalogMinutes: chairMinutesOf(seat, seatBarberId, names),
        // The seat's own price in its currency; the label is printed from
        // it (D-10.3).
        priceCents: seat.priceCents,
        currency: seat.currency,
        priceLabel: seatsPrice([seat], context.lang),
        barberId: seatBarberId,
        barberName: names.barberName(seatBarberId),
        barberTone: names.toneOf(seatBarberId),
        // The catalogue's terms are kept only when the stored ones DIFFER
        // (`Seat.termsOf`), so their presence is the override mark.
        overridden: Seat.overridden(seat),
      };
    }),
    bookingStatus: status,
    rootBookingStatus: appointment.bookingStatus,
    primary,
    overflow: legal.filter((verb) => verb !== primary),
    terminal: BookingLifecycle.isSettled(chairLifecycle),
  };
}

/** Whose chair a hole is in. */
export interface GapChair {
  readonly barberId: BarberId;
  readonly barberName: string;
  readonly barberAvatarSrc: string | null;
  readonly barberTone: number;
}

/** A sellable or elapsed hole, as the run prints it. */
export function gapRowVm(
  gap: {
    readonly startMinutes: MinuteOfDay;
    readonly endMinutes: EndMinute;
    readonly minutes: MinuteCount;
    readonly sellable: boolean;
  },
  chair: GapChair,
  localDate: LocalDate | null,
  context: Pick<DayRowContext, 'locale' | 'words'>,
): GapRowVm {
  return {
    agendaRow: AgendaRow.Gap,
    // The BARBER in the id: two chairs free from 14:00 are two different
    // holes, and a shared key would collapse them in the agenda's track.
    // The START too, since one hole now splits into two at the clock.
    id: `gap-${chair.barberId}-${gap.startMinutes}`,
    startLabel:
      localDate === null
        ? ''
        : wallClockLabel(localDate, gap.startMinutes, context.locale),
    endLabel:
      localDate === null
        ? ''
        : wallClockLabel(localDate, gap.endMinutes, context.locale),
    minutes: gap.minutes,
    spanLabel: spanWords(gap.minutes, context.words.span),
    startMinutes: gap.startMinutes,
    past: !gap.sellable,
    sellable: gap.sellable,
    barberName: chair.barberName,
    barberAvatarSrc: chair.barberAvatarSrc,
    barberTone: chair.barberTone,
  };
}

// ── The agenda's card ─────────────────────────────────────────────────

/** The agenda's switches (`AgendaFields.visible`). */
export type AgendaFlags = Readonly<Record<AgendaField, boolean>>;

/** What a card is worded from. */
export interface AgendaCardInput {
  readonly flags: AgendaFlags;
  readonly words: StaffDayWords;
  /** The page's tick — what keeps the relative time true. */
  readonly nowUtcMs: UtcEpochMs;
  readonly lang: string;
}

/**
 * AN HOUR THAT DID NOT HAPPEN, SAID IN ONE WORD (owner, 2026-09-24: "so
 * it's instantly recognised") — «Отказан», «Не дойде». The card puts it
 * where the countdown stood (a countdown to a visit that will not happen
 * was the card's loudest lie), the grid's block on its second line;
 * `null` for every live or finished visit. ONE word, not «Отказан от
 * салона»: at a phone's width the phrase widened the clock's column and
 * broke the service line under the name in two — and whose act it was
 * is the sheet's head, one tap away.
 */
export function stateLabel(
  entry: { readonly bookingStatus: BookingStatus },
  words: StaffDayWords,
): string | null {
  if (entry.bookingStatus === BookingStatus.NoShow) return words.noShow;
  if (entry.bookingStatus === BookingStatus.Cancelled) {
    return words.statusName(BookingStatus.Cancelled);
  }
  return null;
}

/**
 * THE STATE ON THE FACE (owner, 2026-09-24: "so it's instantly
 * recognised") — the glyph of an hour that did not happen, as a badge on
 * the client's disc, at the leading edge where a glance starts. The same
 * two glyphs the grid's block and the sheet use; `null` for everything
 * live or finished.
 */
export function stateIcon(entry: {
  readonly bookingStatus: BookingStatus;
}): UiIconName | null {
  if (entry.bookingStatus === BookingStatus.Cancelled) {
    return 'visit.cancelled';
  }
  if (entry.bookingStatus === BookingStatus.NoShow) return 'visit.noShow';
  return null;
}

/**
 * WHEN this visit is, said relatively — the third line of the interval.
 *
 * A live cut counts down to its END: the barber is standing in it and wants
 * the time left, not the time since. Everything else counts to its start,
 * which `Intl` renders as "утре", "след 2 ч", "преди 20 мин". `short`,
 * because this shares a narrow column with the clock times above it.
 */
export function whenWords(
  entry: DayRowVm,
  nowUtcMs: UtcEpochMs,
  lang: string,
  words: StaffDayWords,
): string {
  const moment = VisitStorySystem.chairMoment(entry, entry.arrived, entry.live);
  if (moment === ChairMoment.InChair) {
    // The time LEFT is real elapsed time to the chair's end — an
    // elapsed-time phrase on instants (T2, D-6.4).
    const minutes = VisitStorySystem.minutesLeft(entry.endUtcMs, nowUtcMs);
    return words.remaining(spanWords(minutes, words.span));
  }
  // THEY ARE HERE — and that displaces the countdown rather than adding a
  // line to the card. The gloss answers "when, relative to now"; once
  // someone is in the shop, "in 20 min" is not merely less useful than
  // "arrived", it is WRONG, because the thing it counts down to has
  // already happened. This is also where the word went when the state
  // stopped being a fact row: every other state is carried by the card's
  // form, but arrival is the one that is about RIGHT NOW, and form is
  // already spoken for by `data-live` and `data-next`.
  if (moment === ChairMoment.Arrived) return words.arrived;
  return relativeTime(entry.startUtcMs, nowUtcMs, lang, 'short');
}

/**
 * The exception word, and it is NOT a field.
 *
 * It prints only for states that went other than to plan: confirmed and
 * completed say nothing, because "this booking is a booking" is not news on
 * nine cards in ten.
 */
export function exceptionWord(
  status: BookingStatus,
  words: StaffDayWords,
): string | null {
  if (status === BookingStatus.Confirmed || status === BookingStatus.Completed)
    return null;
  return words.exception(status);
}

/**
 * THE ROW'S ACCESSIBLE NAME — and the only place the state is still said.
 *
 * The state left the fact column because it read as one more field there,
 * and it is carried by the card's FORM now: hollow for a cancellation or a
 * no-show, dashed for pending, struck through for a cancellation
 * specifically. Not one of those reaches a screen reader —
 * `text-decoration` is not announced and a missing background certainly is
 * not — so a cancelled booking would have been indistinguishable from a
 * live one.
 *
 * It rides the name rather than a visually-hidden node in the column: the
 * row already has an explicit `aria-label`, and a second hidden line in a
 * list whose every child is a fact was exactly the arrangement the sighted
 * card just got rid of.
 */
export function rowName(entry: DayRowVm, words: StaffDayWords): string {
  const base = words.rowMenu(entry.clientLabel, entry.startLabel);
  const note = rowStateNote(entry, words);
  return note === null ? base : `${base}, ${note}`;
}

/**
 * Arrival is NOT here any more. It is visible text in the trailing gloss
 * (`whenWords`), so repeating it here would announce it twice to a screen
 * reader. What is left is exactly the set of states the card says with its
 * FORM — hollow, hollow-and-struck, dashed — none of which a screen reader can
 * perceive.
 */
export function rowStateNote(
  entry: { readonly bookingStatus: BookingStatus },
  words: StaffDayWords,
): string | null {
  return exceptionWord(entry.bookingStatus, words);
}

/**
 * The marks that ride the body row's trailing edge.
 *
 * TWO THINGS ONLY, and the rule is the owner's: an icon earns its place for
 * a note, for a repeat, and for a blocker. Nothing else.
 *
 * Status is NOT among them any more. It was a glyph on every card, which
 * made the foot row texture rather than signal; it is a word now, and only
 * for the states worth interrupting a glance for — see `rowStateNote`.
 *
 * Both survivors are facts the model actually holds: a note is
 * `contact.note`, a repeat is `Appointment.bookedFrom` (persisted and
 * round-tripped). There is no blocker glyph HERE because a block is not a
 * visit — it is its own object, and `staff-time-grid` draws it on the axis
 * where it has an extent. And no paid glyph, because payment is not
 * modelled anywhere in this codebase; an icon that can never appear is a
 * claim about the schema, not a feature.
 */
export function rowMarks(
  entry: DayRowVm,
  flags: AgendaFlags,
): readonly UiIconName[] {
  const icons: UiIconName[] = [];
  // THE TWO STATES THAT ARE NOT ORDINARY, and they lead — a row that did
  // not happen is the first thing to know about it.
  //
  // A status glyph was removed from this foot once, and correctly: it fired
  // on EVERY card, because every booking has a status, and a mark on 100%
  // of rows is texture rather than signal. These two are the opposite case.
  // They fire on the small minority of rows where something went wrong, and
  // they are the second channel for a state the card otherwise says only in
  // FORM — hollow, and struck through for a cancellation. Form reads across
  // the room; a glyph names which of the two it is without a word.
  //
  // …and since 2026-09-24 they ride the client's FACE (`stateIcon`), where
  // scanning starts: the foot keeps them only when faces are switched off.
  const state = stateIcon(entry);
  if (state !== null && !flags.avatar) icons.push(state);
  if (entry.rebooked) icons.push('visit.repeat');
  // The note is a MARK, not a row. Its text was a clamped line in the fact
  // column — the one fact there that could not be read in full, sitting in
  // a column whose whole premise is that everything gets its place. A mark
  // says "there is one" honestly; the sheet says what it is.
  if (flags.note && entry.hasNote) icons.push('visit.note');
  return icons;
}

/**
 * The tag a card prints. Not on an hour that did not happen (2026-09-24): how
 * far a run is from the catalogue's length means nothing for a visit that will
 * not run.
 */
function printedTag(entry: DayRowVm): string | null {
  return entry.tag && !hollowStatus(entry.bookingStatus) ? entry.tag : null;
}

/**
 * Is there anything for the foot to hold?
 *
 * With price, marks and the barber's face all switched off the row still
 * rendered — an empty flex box of zero height, which sounds free and is
 * not: the card's `row-gap` sits on BOTH sides of it, so every card carried
 * 8px of dead space (measured) for a row with nothing in it.
 *
 * The same answer as what the card prints ({@link agendaCardVm}): a tag on an
 * hour that did not happen is not printed, so it holds no foot.
 */
export function footShown(entry: DayRowVm, flags: AgendaFlags): boolean {
  return (
    (flags.price && !!entry.priceLabel) ||
    // The frame's tag is a mark, never a field: it shows whenever it is.
    printedTag(entry) !== null ||
    // ⚠ The party share joined the foot (owner ruling 2026-09-04); a card
    // whose only mark is `1 / 2` must still get a row to put it on.
    (flags.party && !!entry.partyLabel) ||
    rowMarks(entry, flags).length > 0 ||
    flags.barberAvatar
  );
}

/**
 * The lines under the client's name, in the card's fixed order — the
 * email, the phone, the service — each only when its switch is on and it
 * has something to say. A line that is not rendered costs no height.
 */
export function factLines(
  entry: DayRowVm,
  flags: AgendaFlags,
): readonly StaffEventLine[] {
  const lines: StaffEventLine[] = [];
  if (flags.email && entry.email) {
    lines.push({
      text: entry.email,
      icon: 'contact.email',
      testId: 'staff-visit-email',
    });
  }
  if (flags.phone && entry.phone) {
    lines.push({
      text: entry.phone,
      icon: 'contact.phone',
      testId: 'staff-visit-phone',
    });
  }
  if (flags.service) lines.push({ text: entry.serviceLabel });
  return lines;
}

/** The end, marked when it falls on the next day. */
export function endWords(entry: DayRowVm): string {
  return entry.crossesMidnight ? `${entry.endLabel}⁺¹` : entry.endLabel;
}

/** Everything a visit's card prints, under the switches and at the tick given. */
export function agendaCardVm(
  entry: DayRowVm,
  input: AgendaCardInput,
): AgendaCardVm {
  const { flags, words } = input;
  const state = stateLabel(entry, words);
  // An hour that did not happen — struck on the card's head (staff-event-head).
  const hollow = hollowStatus(entry.bookingStatus);
  return {
    rowLabel: rowName(entry, words),
    stateIcon: stateIcon(entry),
    struck: hollow,
    lines: factLines(entry, flags),
    guestsMark: `+${entry.seatsHere - 1}`,
    start: flags.timeStart ? entry.startLabel : null,
    end: flags.timeEnd ? endWords(entry) : null,
    gloss:
      state ??
      (flags.timeRelative
        ? whenWords(entry, input.nowUtcMs, input.lang, words)
        : null),
    glossState: state !== null,
    foot: footShown(entry, flags),
    price: flags.price && entry.priceLabel ? entry.priceLabel : null,
    partyShare: flags.party && entry.partyLabel ? entry.partyLabel : null,
    tag: printedTag(entry),
    marks: rowMarks(entry, flags),
  };
}

// ── The grid's blocks ─────────────────────────────────────────────────

/**
 * A wall-clock minute of a shop day as an accessible name reads it —
 * «13:00» in `en-GB`, whatever the reader's locale (a fixed 24-hour face,
 * not a language): a laptop left in UTC must not put a barber's lunch two
 * hours out. The closing midnight reads «00:00».
 */
function nameClock(
  localDate: LocalDate,
  minute: MinuteOfDay | EndMinute,
): string {
  return formatWallClock(localDate, minute, 'en-GB', CLOCK_FACE);
}

/**
 * The block's story in words — client, service, span, and the state.
 *
 * The visual block drops its service line when it is short and says its
 * state only in form and a glyph; none of that reaches a screen reader, so
 * the whole fact is composed here.
 */
export function blockName(row: DayRowVm, words: StaffDayWords): string {
  return [
    row.clientLabel,
    row.serviceLabel,
    `${row.startLabel}–${row.endLabel}`,
    row.barberName,
    words.statusName(row.bookingStatus),
    // The party share is drawn as a glyph and a ratio, and a short block
    // drops it entirely — neither reaches a screen reader, and "this is one
    // of two seats" is exactly the fact that changes what a move means.
    ...(row.partySize > 1 ? [words.partyOf(row.partySize)] : []),
  ].join(', ');
}

/** A visit's row, as a block the grid can draw. */
export function gridVisitEvent(
  row: DayRowVm,
  attribute: boolean,
  words: StaffDayWords,
): GridEvent {
  return {
    id: row.id,
    gridEvent: GridEventTag.Visit,
    // The seat's own wall clock, as stored (Law 7.3).
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    title: row.clientLabel,
    // A cancelled or missed hour says so on the line under the name —
    // the block's clock is withheld on a narrow column, and the
    // service matters less than that it did not happen (2026-09-24).
    detail: stateLabel(row, words) ?? row.serviceLabel,
    attribution: attribute ? row.barberName : null,
    // The stored tag; the grid prints its lowercase DOM word.
    bookingStatus: row.bookingStatus,
    terminal: row.terminal,
    barberTone: row.barberTone,
    // The hour, not the outcome: whatever became of it, a 10:00 slot is
    // behind us by noon. Same rule the search sheet sorts by — the
    // row's own (`VisitStorySystem.hasEnded`, on the wall clock).
    past: row.past,
    accessibleName: blockName(row, words),
    // One vocabulary across the three surfaces (owner review
    // 2026-09-08): the sheet's arrived glyph is the block's too, for as
    // long as the visit is live.
    statusIcon: VisitStorySystem.arrivedOpen(row, row.arrived)
      ? 'visit.arrived'
      : (STATUS_ICONS[row.bookingStatus] ?? null),
    partyLabel: row.partyLabel,
  };
}

/** Whose carve-out a block is, and on which day. */
export interface GridBlockFacts {
  readonly barberId: BarberId;
  readonly barberName: string;
  readonly localDate: LocalDate;
  readonly shopNow: ShopNow | null;
  readonly attribute: boolean;
}

/** A lane's break or admin hour, as a block the grid can draw. */
export function gridBlockEvent(
  interval: MinuteRange,
  facts: GridBlockFacts,
  words: StaffDayWords,
): GridEvent {
  const { barberId, localDate, shopNow } = facts;
  const from = nameClock(localDate, interval.startMinutes);
  const to = nameClock(localDate, interval.endMinutes);
  return {
    // Stable across a re-render, and unique per lane and DAY: a
    // barber's day holds at most one exception document, so the chair,
    // the day and the start name this block uniquely without inventing
    // an id the store cannot resolve back to anything — and the day
    // keeps a block of another visible date from answering for the
    // shown day's (`openBlock`, DEP-11).
    id: `block:${barberId}:${localDate}:${interval.startMinutes}`,
    gridEvent: GridEventTag.Block,
    // The store's own wall-clock minutes — a block that closes at
    // midnight ends at 1440, anchored on its day.
    startMinute: interval.startMinutes,
    endMinute: interval.endMinutes,
    title: words.blocked,
    detail: null,
    // A carve-out is the opposite of a booking; identity is not its
    // business, and the rail stays neutral (the grid's own ruling).
    barberTone: null,
    attribution: facts.attribute ? facts.barberName : null,
    bookingStatus: null,
    terminal: false,
    past:
      shopNow !== null &&
      VisitStorySystem.hasEnded(
        { localDate, minute: interval.endMinutes },
        shopNow,
      ),
    // Says WHAT it is and WHEN — the channel the shading never had.
    accessibleName: `${words.blocked}, ${from}–${to}`,
    statusIcon: 'booking.blocked',
    // A carve-out is time, not a booking — there is no party to be part of.
    partyLabel: null,
  };
}

// ── The all-day band ──────────────────────────────────────────────────

/**
 * In the day view a column IS a barber, so the chip names the fact rather than
 * the person — the column head above it is already the name.
 */
export function offChairEntry(
  barberId: BarberId,
  name: string,
  tone: number,
  words: StaffDayWords,
): AllDayEntry {
  return {
    key: barberId,
    label: words.offBadge,
    shortLabel: words.offBadge,
    initial: firstNameOf(name).charAt(0),
    tone,
    accessibleName: words.offBadge,
  };
}

/**
 * A DATE column: the chip says WHO — the first name where the cell can carry a
 * word, the initial on the chair's tone disc where it cannot (§8) — and the
 * whole sentence stays the accessible name.
 */
export function offDateEntry(
  barberId: BarberId,
  name: string,
  tone: number,
  words: StaffDayWords,
): AllDayEntry {
  const first = firstNameOf(name);
  return {
    key: barberId,
    label: words.offChip(first),
    shortLabel: first,
    initial: first.charAt(0),
    tone,
    accessibleName: words.offChip(name),
  };
}

/** «+N» for the chairs past the band's cap — a fact about no one. */
export function allDayMoreEntry(
  rest: number,
  words: StaffDayWords,
): AllDayEntry {
  return {
    key: ALL_DAY_MORE_KEY,
    label: `+${rest}`,
    shortLabel: `+${rest}`,
    initial: `+${rest}`,
    tone: null,
    accessibleName: words.allDayMore(rest),
  };
}

/**
 * How many chairs the all-day band names on one date before it says «+N»
 * (§8): a fourth chip would push the band into a second screen of chrome,
 * and a phone has no tooltip to read the rest from.
 */
const ALL_DAY_CHIP_CAP = 3;

/** What the all-day band is worded from. */
export interface AllDayInput {
  /** A column IS a chair in the day view, and a date otherwise. */
  readonly dayView: boolean;
  readonly cells: readonly {
    readonly dayKey: LocalDate;
    readonly lanes: readonly {
      readonly barberId: BarberId;
      readonly rostered: readonly MinuteRange[];
      readonly failed: boolean;
      readonly rosterRead: boolean;
    }[];
  }[];
  readonly shownDay: LocalDate | null;
  readonly nameOf: (barberId: BarberId) => string;
  readonly toneOf: (barberId: BarberId) => number;
  readonly words: StaffDayWords;
}

/**
 * What the band above each column holds, by the column's id: a chair off all
 * day (`RosterSystem.offAllDay`). A failed or unread lane is not off (OR-2).
 *
 * In the day view a column IS a barber, so the chip names the fact rather than
 * the person — the column head above it is already the name. The shading says
 * "nothing can happen here"; this says WHY, which shading alone cannot, and
 * which is the only form a screen reader can read.
 *
 * In a date column the chip says WHO — the first name where the cell can carry
 * a word, the initial on the chair's tone disc where it cannot (§8) — and the
 * whole sentence stays the accessible name. Three chips, then «+N», never fewer
 * names as more chairs are off: a scroller inside the pinned band would be a
 * trap.
 */
export function allDayEntriesOf(
  input: AllDayInput,
): Record<string, readonly AllDayEntry[]> {
  const { nameOf, toneOf, words } = input;
  const out = new Map<string, readonly AllDayEntry[]>();
  if (input.dayView) {
    const cell = input.cells.find((entry) => entry.dayKey === input.shownDay);
    for (const lane of cell?.lanes ?? []) {
      if (!RosterSystem.offAllDay(lane)) continue;
      const { barberId } = lane;
      out.set(barberId, [
        offChairEntry(barberId, nameOf(barberId), toneOf(barberId), words),
      ]);
    }
    return Object.fromEntries(out);
  }
  for (const cell of input.cells) {
    const off = cell.lanes
      .filter((lane) => RosterSystem.offAllDay(lane))
      .map(({ barberId }) =>
        offDateEntry(barberId, nameOf(barberId), toneOf(barberId), words),
      );
    if (off.length === 0) continue;
    out.set(
      cell.dayKey,
      off.length <= ALL_DAY_CHIP_CAP
        ? off
        : [
            ...off.slice(0, ALL_DAY_CHIP_CAP),
            allDayMoreEntry(off.length - ALL_DAY_CHIP_CAP, words),
          ],
    );
  }
  return Object.fromEntries(out);
}

/** One chair off the shown day, as its all-day row names it. */
export interface RestingChairVm {
  readonly id: BarberId;
  readonly name: string;
  readonly tone: number;
}

/**
 * Barbers with neither a window nor a booking (`StaffDayStore.offToday`), each
 * by the catalogue's name — by its id when the catalogue has no such chair.
 */
export function restingChairs(
  ids: readonly BarberId[],
  chairs: readonly {
    readonly id: BarberId;
    readonly name: Parameters<StaffCatalogNames['text']>[0];
  }[],
  names: Pick<StaffCatalogNames, 'text'>,
  toneOf: (id: BarberId) => number,
): readonly RestingChairVm[] {
  const byId = new Map(chairs.map((chair) => [chair.id, chair] as const));
  return ids
    .map((id) => {
      const chair = byId.get(id);
      return {
        id,
        name: chair ? names.text(chair.name) : id,
        tone: toneOf(id),
      };
    })
    .filter((barber) => barber.name.length > 0);
}

// ── The day's line ────────────────────────────────────────────────────

/** «2 ч свободни» — the unsold minutes the system summed. */
export function daySummaryWords(
  freeMinutes: number,
  words: StaffDayWords,
): string {
  return words.daySummaryFree(spanWords(freeMinutes, words.span));
}

/** «12,00 € бакшиши» — the day's recorded tips, as the system totalled them. */
export function dayTipsWords(
  total: Money,
  lang: string,
  words: StaffDayWords,
): string {
  return words.daySummaryTips(
    formatCents(total.amountCents, total.currency, lang),
  );
}

/**
 * WHAT THE DAY WAS TIPPED, at whatever scope is being looked at.
 *
 * Summed from the SEATS rather than from the rows, because the seat is
 * where a tip is recorded and the seat is what names the barber. Walking
 * each lane and taking only that lane's own seats means a party split
 * between two chairs contributes each half to the barber who earned it,
 * and nothing is counted twice. Every visit counts, whatever the status
 * filter draws: a total is a fact, not a view.
 *
 * `null` when the day has no recording at all — an empty figure is worse
 * than no line, and `0,00 €` would claim every visit had been settled.
 */
export function dayTipsLine(
  lanes: readonly {
    readonly barberId: BarberId;
    readonly appointments: readonly Appointment[];
  }[],
  lang: string,
  words: StaffDayWords,
): string | null {
  const seats: Seat[] = [];
  for (const lane of lanes) {
    for (const appointment of lane.appointments) {
      seats.push(...Seat.ofChair(appointment.seats, lane.barberId));
    }
  }
  // Strict: nothing recorded, or a mixed-currency day — a data error, not
  // a feature — is no figure (`BillingSystem.recordedTipsTotal`).
  const total = BillingSystem.recordedTipsTotal(seats);
  return total === null ? null : dayTipsWords(total, lang, words);
}

// ── The sheets' words ─────────────────────────────────────────────────

/**
 * The WORD for a verb. Reopening a no-show is not "confirm" — it is undoing
 * a judgement, and it says so.
 */
export function verbKeyOf(status: BookingStatus, verb: RowVerb): string {
  if (verb === BookingStatus.Confirmed && status === BookingStatus.NoShow) {
    return 'staff.day.act.reopen';
  }
  if (verb === BookingStatus.Confirmed && status === BookingStatus.Completed) {
    return 'staff.day.act.reopenCompleted';
  }
  if (verb === BookingStatus.Confirmed && status === BookingStatus.Cancelled) {
    return 'staff.day.act.reinstate';
  }
  return 'staff.day.act.' + ROW_VERB_WORD[verb];
}

export function editorVerb(
  row: { readonly bookingStatus: BookingStatus },
  verb: RowVerb,
  words: StaffDayWords,
): VisitEditorVerb {
  return {
    // The verb itself — what the sheet emits back through `(acted)`.
    rowVerb: verb,
    label: words.verb(verbKeyOf(row.bookingStatus, verb)),
    // ONE red in the menu (owner review, 2026-09-08). Cancelling is the
    // destructive act: it is terminal and it pages the waitlist. A no-show
    // is a fact about the client, and the graph keeps a correction edge for
    // it, so it reads as an ordinary verb rather than a second warning.
    destructive: verb === BookingStatus.Cancelled,
  };
}

/** The words the visit sheet's head and menu print for a row. */
export function visitEditorWords(
  row: DayRowVm,
  words: StaffDayWords,
): {
  readonly clientMeta: string | null;
  readonly statusLabel: string;
  readonly primaryVerb: VisitEditorVerb | null;
  readonly overflowVerbs: readonly VisitEditorVerb[];
} {
  return {
    // `rebooked` is the one durable fact the shop holds about a person here:
    // a client who came back. Anything richer needs a history read the sheet
    // does not have, so it says the true thing or nothing.
    clientMeta: row.rebooked ? words.clientReturning : null,
    statusLabel: words.statusName(row.bookingStatus),
    // Regime A, carried through unchanged. `offeredVerbs` already decided
    // what is legal and `leadVerb` already decided what leads; the editor
    // renders that decision rather than re-taking it.
    primaryVerb: row.primary ? editorVerb(row, row.primary, words) : null,
    overflowVerbs: row.overflow.map((verb) => editorVerb(row, verb, words)),
  };
}

/** Another chair's row of the same booking, as the sheet lists it. */
export function peerRowOf(entry: DayRowVm) {
  return {
    rowId: entry.id,
    clientLabel: entry.clientLabel,
    chairName: entry.barberName,
    chairTone: entry.barberTone,
    timeLabel: `${entry.startLabel} – ${entry.endLabel}`,
  };
}

/**
 * WHAT OCCUPIES `barberId`'s CHAIR beside the visit `excludeId` names
 * (`null`: a new one), read off one day's documents —
 * `BusySystem.chairOccupants`, the server's collision rule (DEP-2): one
 * neighbour per seat the chair holds, on the seat's own wall clock.
 */
export function occupantNeighbours(
  appointments: readonly Appointment[],
  barberId: BarberId,
  excludeId: AppointmentId | null,
  tone: number,
  words: StaffDayWords,
): FrameNeighbour[] {
  return BusySystem.chairOccupants(appointments, barberId, excludeId).map(
    ({ appointment, seat }) => ({
      name: appointment.contactName ?? words.unnamedClient,
      // The seat's own wall clock — the frame's axis (Law 7.3).
      startMinute: seat.startMinutes,
      endMinute: Seat.endMinutes(seat),
      tone,
    }),
  );
}

/**
 * The same answer on the shown day, where the agenda already drew each
 * chair's rows: the lane's visit rows whose appointment occupies the chair
 * by `BusySystem.chairOccupants` over the store lane's documents (the
 * ones the rows were drawn from) — one neighbour per row, on the row's
 * own wall clock. Which rows are drawn is the agenda's; which occupy is
 * the system's.
 */
export function occupyingRows(
  lane: LaneVm | undefined,
  appointments: readonly Appointment[],
  excludeId: AppointmentId | null,
): FrameNeighbour[] {
  if (lane === undefined) return [];
  const occupying = new Set<AppointmentId>();
  for (const { appointment } of BusySystem.chairOccupants(
    appointments,
    lane.barberId,
    excludeId,
  )) {
    occupying.add(appointment.id);
  }
  return lane.entries
    .filter(
      (entry): entry is DayRowVm =>
        entry.agendaRow === AgendaRow.Visit &&
        occupying.has(entry.appointmentId),
    )
    .map((entry) => ({
      name: entry.clientLabel,
      // The visit's own wall clock, as stored (Law 7.3).
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
      tone: entry.barberTone,
    }));
}

/** What a client option on the add-client page is worded from. */
export interface RecentClientWords {
  readonly words: StaffDayWords;
  /** A wall-clock reading prints nothing before the zone is known (D-6.2). */
  readonly zoneKnown: boolean;
  readonly locale: string;
}

/** A recent visitor on «Скорошни»: the last contact, and the day of the visit. */
export function recentClientOption(
  userId: UserId,
  visit: Appointment,
  input: RecentClientWords,
): VisitEditorClientOption {
  const phone = visit.contactPhone;
  return {
    id: DraftPersonKey.account(userId),
    label: visit.contactName ?? input.words.unnamedClient,
    phone: phone === null ? null : PhoneSystem.formatInternational(phone),
    phoneHref: phone,
    meta: input.words.lastVisit(
      // `3 авг` — the day a person was last here, as stored.
      input.zoneKnown
        ? formatWallClock(visit.localDate, null, input.locale, {
            day: 'numeric',
            month: 'short',
          })
        : '',
    ),
    email: visit.contactEmail,
  };
}

/** An account of the book — searched by the omnibox, never listed. */
export function bookClientOption(
  userId: UserId,
  visit: Appointment,
  contactName: string,
): VisitEditorClientOption {
  const phone = visit.contactPhone;
  return {
    id: DraftPersonKey.account(userId),
    label: contactName,
    phone: phone === null ? null : PhoneSystem.formatInternational(phone),
    phoneHref: phone,
    meta: null,
    email: visit.contactEmail,
  };
}
