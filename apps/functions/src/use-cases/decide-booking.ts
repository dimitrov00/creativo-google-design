import {
  Money,
  PhoneNumber,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  BarberId,
  type LocationDayHours,
  type Service,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import {
  Appointment,
  AppointmentBarberDoubleBookedError,
  AppointmentEmptySeatsError,
  type AppointmentError,
  AppointmentMixedCurrencyError,
  AppointmentMultipleSelfSeatsError,
  AppointmentPastStartTimeError,
  BarberPref,
  BookingContact,
  type BookingContactProps,
  BookingPolicy,
  type ChairTime,
  EmptyIdError,
  Interval,
  PENDING,
  type ScheduleException,
  Seat,
  SeatId,
  SeatLabel,
  type SeatIdPair,
  SeatSubject,
  StaffScheduleHistory,
  StandingDoubleSeatings,
  WEEKDAYS,
  labelSharedByTwoGuests,
  toEcsDetail,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import type { AppointmentPlacement } from '@creativo/application/booking';
import {
  BarberId as EcsBarberId,
  type BookingCommitError,
  BookingCommitErrorCode,
  BookingCommitField,
  BookingDecisionSystem,
  type BookingPolicy as EcsBookingPolicy,
  type BookingSnapshot as EcsBookingSnapshot,
  BusyKey,
  DayHours,
  DayKey,
  type DayOffset,
  type DecideBookingRequest as EcsDecideBookingRequest,
  E164,
  type ExceptionEffect,
  GuestLabelSystem,
  LocationId as EcsLocationId,
  type RequestedSubject,
  type Seat as EcsSeat,
  ScheduleExceptionSystem,
  type ScheduleVersion,
  SchedulingErrorCode,
  type SchedulingError,
  ServiceCategoryId,
  ServiceComposition,
  type ServiceEntity,
  ServiceId as EcsServiceId,
  ServiceTerms as EcsServiceTerms,
  ServiceVariantId as EcsServiceVariantId,
  SeatId as EcsSeatId,
  ShiftSegment,
  type StaffTermsOverride as EcsStaffTermsOverride,
  type Weekday,
  ZonedTimeSystem,
} from '@creativo/ecs-core';
import {
  CommitBookingBarberNotRosteredError,
  CommitBookingBeyondHorizonError,
  CommitBookingConflictingServicesError,
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingInvariantError,
  CommitBookingPartyTooLargeError,
  CommitBookingServiceNotAtLocationError,
  CommitBookingShopUnavailableError,
  CommitBookingSlotUnavailableError,
  CommitBookingTooSoonError,
  CommitBookingUnauthenticatedError,
  CommitBookingUnknownServiceError,
} from './commit-booking.errors';
import {
  CommitBookingDuplicateGuestLabelError,
  CommitBookingPersonDoubleBookedError,
} from './decide-booking.errors';

/** One seat as the client asked for it — see `CommitBookingSeatRequest`. */
export interface RequestedSeat {
  readonly lineId: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  /**
   * What the client ASKED for, beside the barber they were given. Absent is
   * stored as UNKNOWN (`null`), never guessed: `specific` would put a request
   * nobody made into the client's history (the derived preferred barber,
   * §11.2 #6), and `any` would license moving them without a call. Staff
   * read unknown the conservative way — phone before moving.
   */
  readonly barberPref?: 'any' | 'specific';
  readonly startIso: string;
  /**
   * `companion` is a person with an account of their own on someone else's
   * booking. No payload parser produces it (`toSeats` reads only `self` and
   * `guest`): a client cannot seat another account. It exists so a staff
   * edit — and a client's move — can carry a STORED companion through the
   * rebuild, instead of refusing every visit that has one or, worse,
   * dropping the person.
   */
  readonly subject:
    | { readonly kind: 'self' }
    | { readonly kind: 'companion'; readonly userId: string }
    | {
        readonly kind: 'guest';
        readonly label: string;
        /**
         * The client's own name for this guest (the cart's seat key,
         * `guest-3`), so two DIFFERENT guests under one label can be told
         * apart — and refused (`CommitBookingDuplicateGuestLabelError`)
         * rather than merged by `personKey`. Opaque, never stored: the label
         * stays the guest's identity. Absent (an older client, a staff
         * path, a carried seat) reads one label as one person.
         */
        readonly guestKey?: string;
      };
}

export interface DecideBookingRequest {
  readonly locationId: string;
  readonly seats: readonly RequestedSeat[];
  /**
   * Client-minted idempotency key, used VERBATIM as the appointment id when
   * present (shape-validated at the callable). A retry that lost its
   * response then finds its own committed appointment by id instead of
   * seeing its own busy write and bouncing `slot_unavailable` — which sent
   * users off to book a second real slot.
   */
  readonly attemptId?: string;
  /**
   * The appointment this one was rebooked from, when the client came here
   * from a previous visit rather than cold.
   *
   * Client-supplied and carries NO authority — it is an analytics edge, not a
   * permission. A caller naming someone else's appointment gains nothing; the
   * worst case is one wrong entry in a rebooking-rate numerator, which is why
   * it is not worth a round-trip to verify. `Appointment.build` drops it if it
   * does not parse.
   */
  readonly bookedFromAppointmentId?: string | null;
  /**
   * Who the shop calls about this booking, and what they should know — the
   * client's own details by default, or a one-time override.
   *
   * Contact details only. Ownership comes from the verified token and is
   * never read from here, so a caller choosing a name and a number changes
   * nothing about who may see or cancel the appointment.
   */
  readonly contact?: BookingContactProps;
  /**
   * Who is putting this booking in the book — the client themselves, or the
   * shop on their behalf (R33). The decision never reads it; the STORE does,
   * twice:
   * - on a commit, it is stamped on the NEW document;
   * - wherever a booking ARRIVES at a shop — a commit, or a move naming a
   *   shop the visit is not at — only `'staff'` may bring it to a shop
   *   `/book` does not list (`admitsArrival`, team decision 2026-09-26).
   *   Absent reads as the client's: fail-closed.
   *
   * On a move it names who is moving the visit and answers only that: the
   * document keeps the placement it was first stamped with.
   */
  readonly placement?: AppointmentPlacement;
}

/** One barber's roster, as loaded from `barberSchedules/{barberId}`. */
export interface LoadedSchedule {
  readonly history: StaffScheduleHistory;
  readonly turnaroundMinutes: number;
}

/**
 * Everything the decision reads, loaded INSIDE the transaction so the commit
 * fails rather than races if any of it changes underneath.
 */
export interface BookingSnapshot {
  readonly zone: string;
  /** `Location.hours`, Mon-first. Not 7 entries ⇒ the shop publishes none. */
  readonly shopHours: readonly LocationDayHours[];
  readonly services: readonly Service[];
  /** Keyed by `BarberId.value`. A missing entry means "no roster". */
  readonly schedules: ReadonlyMap<string, LoadedSchedule>;
  /** Existing busy intervals keyed by `${barberId}__${dayKey}`, UNPADDED. */
  readonly busy: ReadonlyMap<string, readonly Interval[]>;
  /**
   * Chair time handed back before any placement is checked: the visit
   * being REBUILT (a client's move, a staff edit), whose own seats must
   * never block where it goes next. `Appointment.chairTimes` of the stored
   * visit — the same chair time the booking grid hands back
   * (`ObserveDayAvailabilityInput.release`), released by the same rule
   * (`paddedBusy`), so a move is offered exactly what this accepts. Absent
   * on a new booking.
   */
  readonly release?: readonly ChairTime[];
  /**
   * Published schedule exceptions keyed by `${barberId}__${dayKey}` — the
   * sanitized public docs, read in the SAME transaction as the busy set so
   * a commit racing a just-declared day off loses honestly.
   */
  readonly exceptions: ReadonlyMap<string, ScheduleException>;
}

/** A span to add to one barber's public busy projection. */
export interface BusyWrite {
  readonly barberId: string;
  readonly dayKey: string;
  readonly interval: Interval;
}

export interface BookingDecision {
  readonly appointment: Appointment;
  readonly busyWrites: readonly BusyWrite[];
}

/**
 * What a commit attempt resolved to: a fresh decision, or the discovery that
 * THIS attempt already committed. Replay carries only the id — the original
 * response's one payload — because a retry after a lost response needs its
 * answer back, not a re-parsed aggregate.
 */
export type CommitOutcome =
  | { readonly kind: 'committed'; readonly decision: BookingDecision }
  | { readonly kind: 'replayed'; readonly appointmentId: string };

/**
 * A seat's terms as STAFF fixed them — the snapshot being carried forward,
 * plus whatever the command just changed.
 *
 * It lives on `deps` rather than on `RequestedSeat` on purpose. `RequestedSeat`
 * is the shape a browser payload is parsed into; anything on it is a field a
 * client can try to send, and "name your own price" is the one thing the round
 * trip exists to prevent. `deps` is assembled server-side — by the staff use
 * case once it has checked the caller works the book, or by a client's move
 * from the STORED seats it carries (never from the cart) — so a privilege
 * that lives here cannot be reached from the wire at all.
 */
export interface StaffTermsOverride {
  readonly priceMinorUnits?: number;
  readonly currencyCode?: string;
  readonly durationMinutes?: number;
  readonly setupMinutes?: number;
  readonly cleanupMinutes?: number;
}

/**
 * One seat of a visit as it STANDS before a rebuild: which seat it is, who
 * sits in it, and the minutes they were sold. The staff edit's stored seat
 * (`StoredSeat`) is one as it is; a client's move builds them from the
 * stored aggregate. See `DecideBookingDeps.standing`.
 */
export interface StandingSeat {
  /** The seat's id — what the rebuilt seat is minted with again (`nextId`). */
  readonly id: string;
  readonly subject: RequestedSeat['subject'];
  readonly startMs: number;
  readonly durationMinutes: number;
}

export interface DecideBookingDeps {
  readonly now: ZonedDateTime;
  readonly policy: BookingPolicy;
  readonly nextId: () => string;
  /**
   * The booking's owner, from the VERIFIED token.
   *
   * `null` is a walk-in the shop entered itself: nobody owns it, and every
   * seat on it is anonymous. It is not a licence to book in nobody's name —
   * a `self` seat with no owner is still refused below, because a self seat
   * IS the owner's seat and there is no owner to bind it to.
   */
  readonly ownerUserId: string | null;
  /**
   * The shop is placing this itself, so the BOOKABLE-WINDOW tier does not
   * apply to it.
   *
   * `roster-window.ts` already states the principle in prose: what
   * `buildDayWindows` returns is what a CLIENT may be offered, and never a
   * bound on what can exist. A barber taking a regular at 08:00 before the
   * shop opens is a real thing that occupies real time, is tracked, and counts
   * in that barber's statistics — it simply never becomes publicly bookable.
   *
   * Exactly four refusals are dropped, and they are one idea between them —
   * every rule whose subject is "what may we OFFER":
   *   - the rostered windows and the shop's published hours;
   *   - `minLeadMinutes`, the notice a client owes the shop (a receptionist
   *     pushing a running-late 10:00 visit to 10:15 at 10:12 owes nobody
   *     notice — it is the same visit, already in the building);
   *   - `horizonMonths`, how far ahead the calendar opens;
   *   - the future-start invariant, so a visit currently IN THE CHAIR can be
   *     corrected at all.
   *
   * What it does NOT drop is collisions: see `allowOverlap`, which is a
   * separate flag precisely because sitting on somebody else's slot has to be
   * said out loud. This one is never acknowledged and has no second tap — it
   * is not a refusal staff override, it is not the staff rule to begin with.
   */
  readonly allowOutsideWindow?: boolean;
  /**
   * THE SHOP COMBINES WHAT IT LIKES (owner, 2026-09-17: "a staff account
   * could do whatever he wants"). The catalogue's `conflictsWith` is the
   * CLIENT's self-booking rule — what a stranger may put together from a
   * menu without asking. The shop's own book is not bound by it: a staff
   * edit and a staff placement skip the check, unconditionally and with no
   * second tap, exactly like the window. The per-person scoping and the
   * bundle inheritance stay as they are for everyone else.
   */
  readonly allowConflictingServices?: boolean;
  /**
   * Staff may double-book, once they have said so.
   *
   * Unlike the window, this one IS acknowledged: the sheet relabels its commit
   * «Запази въпреки застъпването» and only then sends the flag. Set from that
   * acknowledgement and nothing else, so the promise the button makes is a
   * promise the server keeps.
   */
  readonly allowOverlap?: boolean;
  /** Per-`lineId` terms staff fixed by hand. See `StaffTermsOverride`. */
  readonly termsOverrides?: ReadonlyMap<string, StaffTermsOverride>;
  /**
   * The visit as it stands, on every path that REBUILDS an appointment
   * instead of booking one: a staff edit and a client's move. One rule
   * reads it, "one person, one chair at a time", and only to refuse a NEW
   * overlap rather than every overlap (owner decision, round 5).
   *
   * Two seats of it that already seat one person twice (booked on the old
   * person-blind grid, or two walk-ins under the old shared label) are a
   * pair the visit already held, identified by SEAT ID: a rebuilt seat
   * minted with a standing seat's id (`nextId`) is that seat, wherever the
   * edit put it. Such a pair may keep overlapping through any edit that
   * keeps both ids (a whole-visit drag, a chair-wide resize; on a client's
   * move, only the seats the move CARRIES — the client's own seats are
   * re-picked with fresh ids and judged, BA ruling round 6), so staff can
   * always save a visit they did not make worse. A pair that did not overlap, or
   * a seat the edit adds, is judged in full, so no write ever PUTS a person
   * in two chairs. The rule is the domain's (`StandingDoubleSeatings`).
   *
   * Absent (every commit), nothing stands and every seat is judged. Built
   * server-side from the stored document, like `termsOverrides`, so no
   * payload can claim a pair is history.
   */
  readonly standing?: readonly StandingSeat[];
  /**
   * Pairs, by seat id, that stood in the visit before the SAVE this edit
   * immediately follows, and that the save broke — one seat removed, or
   * the two moved apart (round 6). They stand beside `standing`, so the
   * undo of that save, which puts back exactly what the save changed, is
   * not refused for restoring a double seating the visit already held.
   *
   * Only the staff edit sets it, from the visit's own memory of its last
   * save (`stoodSeatPairsFromDocument`), and only while nothing else has
   * been written since (`liveStoodSeatPairs`); read off the document, like
   * `standing`, never from a payload.
   */
  readonly stood?: readonly SeatIdPair[];
}

/**
 * Decide whether a requested booking may be written, and what writing it
 * means. Pure: every fact comes from `snapshot` and `deps`.
 *
 * Phase 2 shim: the decision is `BookingDecisionSystem.decide` in
 * `@creativo/ecs-core` — terms re-derived from the catalogue, the owner from
 * the verified token, the windows from the roster and the shop's hours,
 * conflicts per person, people re-counted ("one person, one chair"; two
 * guests the client tells apart may not share the label the domain's
 * `labelSharedByTwoGuests` reads them by) and collisions against the busy set
 * read in this transaction. This function converts the legacy inputs to the
 * system's structs, and its answer back to the legacy `Appointment` and
 * error classes.
 */
export function decideBooking(
  request: DecideBookingRequest,
  snapshot: BookingSnapshot,
  deps: DecideBookingDeps,
): Result<BookingDecision, CommitBookingError> {
  const outside = deps.allowOutsideWindow === true;
  const ecsRequest = toEcsRequest(request, snapshot.zone);
  const decided = BookingDecisionSystem.decide(
    ecsRequest,
    toEcsSnapshot(snapshot),
    toEcsPolicy(deps.policy),
    {
      allowOutsideWindow: outside,
      skipMinNotice: outside,
      allowOverlap: deps.allowOverlap === true,
      allowConflictingServices: deps.allowConflictingServices === true,
    },
    (snapshot.release ?? []).map((chair) => ({
      barberId: EcsBarberId.of(chair.barberId.value),
      occupied: chair.occupied,
    })),
    {
      nowMs: deps.now.toMillis(),
      nextId: deps.nextId,
      days: dayTableOf(snapshot.zone, deps.now, ecsRequest),
      ownerUserId: deps.ownerUserId,
      termsOverrides: overridePatchesOf(deps.termsOverrides),
      standing: (deps.standing ?? []).map((seat) => ({
        id: seat.id,
        subject: toEcsSubject(seat.subject),
        startMs: seat.startMs,
        durationMinutes: seat.durationMinutes,
      })),
      stood: (deps.stood ?? []).map(([seatId, otherSeatId]) => ({
        seatId: EcsSeatId.of(seatId),
        otherSeatId: EcsSeatId.of(otherSeatId),
      })),
      parsePhone,
    },
  );
  if (!decided.ok) return fail(toLegacyError(decided.error, request));
  return toLegacyDecision(decided.value, request, snapshot, deps);
}

/**
 * The visit as it stood (`DecideBookingDeps.standing`) → the double
 * seatings it already held, keyed by the same person key every request seat
 * is counted by. Exported for the staff edit, which asks it of the visit
 * before AND after its batch to learn which pairs the batch broke.
 */
export function standingDoubleSeatingsOf(
  standing: readonly StandingSeat[],
): StandingDoubleSeatings {
  if (standing.length === 0) return StandingDoubleSeatings.none();
  return StandingDoubleSeatings.of(
    standing.map((seat) => ({
      seatId: seat.id,
      personKey: GuestLabelSystem.personKeyOf(toEcsSubject(seat.subject)),
      slot: Interval.of(
        seat.startMs,
        seat.startMs + seat.durationMinutes * 60_000,
      ),
    })),
  );
}

/* ── Phase 2 shim converters: legacy shapes ↔ ecs-core structs ──────────── */

function toEcsSubject(subject: RequestedSeat['subject']): RequestedSubject {
  switch (subject.kind) {
    case 'self':
      return { kind: 'self' };
    case 'companion':
      return { kind: 'companion', userId: subject.userId };
    case 'guest':
      return {
        kind: 'guest',
        label: subject.label,
        guestKey: subject.guestKey ?? null,
      };
  }
}

/** The request, its starts read as instants in the shop's zone (`null`: did not parse). */
function toEcsRequest(
  request: DecideBookingRequest,
  zone: string,
): EcsDecideBookingRequest {
  return {
    locationId: request.locationId,
    seats: request.seats.map((seat) => {
      const start = ZonedDateTime.fromISO(seat.startIso, zone);
      return {
        lineId: seat.lineId,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        barberPref: seat.barberPref ?? null,
        startMs: start.isSuccess() ? start.value.toMillis() : null,
        subject: toEcsSubject(seat.subject),
      };
    }),
    attemptId: request.attemptId ?? null,
    bookedFromAppointmentId: request.bookedFromAppointmentId ?? null,
    contact: request.contact
      ? {
          name: request.contact.name,
          phone: request.contact.phone,
          email: request.contact.email ?? null,
          note: request.contact.note ?? null,
        }
      : null,
    placement: request.placement ?? null,
  };
}

function toEcsSnapshot(snapshot: BookingSnapshot): EcsBookingSnapshot {
  return {
    zone: snapshot.zone,
    shopHours: weekOf(snapshot.shopHours),
    services: snapshot.services.map(toServiceEntity),
    schedules: [...snapshot.schedules].map(([barberId, schedule]) => ({
      barberId: EcsBarberId.of(barberId),
      versions: versionsOf(schedule.history),
      turnaroundMinutes: schedule.turnaroundMinutes,
    })),
    busy: [...snapshot.busy].flatMap(([key, spans]) => {
      const id = BusyKey.parse(key);
      return id === null ? [] : [{ id, spans }];
    }),
    exceptions: [...snapshot.exceptions].flatMap(([key, exception]) => {
      const id = BusyKey.parse(key);
      const effect = effectOf(exception);
      return id === null || effect === null
        ? []
        : [
            {
              barberId: BusyKey.split(id).barberId,
              dayKey: DayKey.of(exception.day.key()),
              effect,
            },
          ];
    }),
  };
}

function toEcsPolicy(policy: BookingPolicy): EcsBookingPolicy {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: policy.slotStepMinutes,
    minLeadMinutes: policy.minLeadMinutes,
    horizonMonths: policy.horizonMonths,
    cancellationWindowHours: policy.cancellationWindow.hours,
    maxFlexibleDays: policy.maxFlexibleDays,
    autoConfirm: policy.autoConfirm,
  };
}

function overridePatchesOf(
  overrides: ReadonlyMap<string, StaffTermsOverride> | undefined,
): readonly EcsStaffTermsOverride[] {
  return [...(overrides ?? [])].map(([seatKey, override]) => ({
    seatKey,
    priceMinorUnits: override.priceMinorUnits ?? null,
    currencyCode: override.currencyCode ?? null,
    durationMinutes: override.durationMinutes ?? null,
    setupMinutes: override.setupMinutes ?? null,
    cleanupMinutes: override.cleanupMinutes ?? null,
  }));
}

/** The kernel's phone rule, so a contact parses exactly as it always did. */
function parsePhone(raw: string): E164 | null {
  const phone = PhoneNumber.create(raw);
  return phone.isSuccess() ? E164.of(phone.value.value) : null;
}

/** The zone table around `now` and every parsed start, a day of margin each side. */
function dayTableOf(
  zone: string,
  now: ZonedDateTime,
  request: EcsDecideBookingRequest,
): readonly DayOffset[] {
  const instants = [now.toMillis()];
  for (const seat of request.seats) {
    if (seat.startMs !== null) instants.push(seat.startMs);
  }
  return ZonedTimeSystem.dayTableAround(
    zone,
    Math.min(...instants),
    Math.max(...instants),
    1,
  );
}

function toTerms(terms: ServiceTerms): EcsServiceTerms {
  return EcsServiceTerms.of(
    terms.price.toMinorUnits(),
    terms.price.currencyCode(),
    terms.durationMinutes,
    terms.setupMinutes,
    terms.cleanupMinutes,
  );
}

/** The legacy aggregate → the stored entity (the cover is not read by the decision). */
function toServiceEntity(service: Service): ServiceEntity {
  const composition = service.composition;
  return {
    id: EcsServiceId.of(service.id.value),
    name: { bg: service.name.bg, en: service.name.en },
    description: { bg: service.description.bg, en: service.description.en },
    categoryId: ServiceCategoryId.of(service.categoryId.value),
    baseTerms: toTerms(service.baseTerms),
    variants: service.variants.map((variant) => ({
      id: EcsServiceVariantId.of(variant.id.value),
      name: { bg: variant.name.bg, en: variant.name.en },
    })),
    offerings: service.offerings.map((offering) => ({
      barberId: EcsBarberId.of(offering.barberId.value),
      base: toTerms(offering.base),
      overrides: service.variants.flatMap((variant) => {
        const terms = offering.termsFor(variant.id);
        return terms === offering.base
          ? []
          : [
              {
                variantId: EcsServiceVariantId.of(variant.id.value),
                terms: toTerms(terms),
              },
            ];
      }),
    })),
    cover: null,
    locationIds: service.locationIds.map((id) => EcsLocationId.of(id.value)),
    conflictsWith: service.conflictsWith.map((id) => EcsServiceId.of(id.value)),
    composition:
      composition.kind === 'bundle'
        ? ServiceComposition.bundle(
            composition.includes.map((id) => EcsServiceId.of(id.value)),
          )
        : ServiceComposition.single(),
    upsellOnly: service.upsellOnly,
    popular: service.popular,
    status: service.status,
    sortOrder: service.sortOrder,
  };
}

/** The roster history → its versions, the weekday map flattened to segments. */
function versionsOf(history: StaffScheduleHistory): readonly ScheduleVersion[] {
  return history.all().map((version) => ({
    seq: version.seq,
    effectiveFromDayKey: DayKey.of(version.effectiveFrom.key()),
    effectiveToDayKey:
      version.effectiveTo === null
        ? null
        : DayKey.of(version.effectiveTo.key()),
    segments: WEEKDAYS.flatMap((weekday, index) =>
      version.pattern
        .segmentsOn(weekday)
        .map((segment) =>
          ShiftSegment.of(
            (index + 1) as Weekday,
            EcsLocationId.of(segment.locationId.value),
            segment.start.minutesFromMidnight(),
            segment.end.minutesFromMidnight(),
          ),
        ),
    ),
  }));
}

/**
 * `'HH:mm'` weeks → minutes. A week holding a clock that does not parse
 * (refused by the `Location` aggregate, so never stored) publishes nothing.
 */
function weekOf(weekly: readonly LocationDayHours[]): readonly DayHours[] {
  const week: DayHours[] = [];
  for (const entry of weekly) {
    if (entry.kind === 'closed') {
      week.push(DayHours.closed());
      continue;
    }
    const opens = DayHours.parseClock(entry.opens);
    const closes = DayHours.parseClock(entry.closes);
    if (!opens.ok || !closes.ok) return [];
    week.push(DayHours.open(opens.value, closes.value));
  }
  return week;
}

/**
 * A published exception → its public effect: the GDPR boundary is
 * `ScheduleExceptionSystem.publicEffect`, the detail converted once by the
 * scheduling shim's `toEcsDetail`.
 */
function effectOf(exception: ScheduleException): ExceptionEffect | null {
  const effect = ScheduleExceptionSystem.publicEffect(
    toEcsDetail(exception.detail),
  );
  return effect.ok ? effect.value : null;
}

/**
 * The guests a request tells apart, as the domain's label rule reads them —
 * how the legacy refusal names the label two of them share. Kept (rather
 * than reading `error.detail` alone) because decide-booking.spec.ts pins
 * that this file asks the domain's `labelSharedByTwoGuests`, which is itself
 * a shim over the same `Party.labelSharedByTwoGuests` the system asks.
 */
function namedGuestsOf(
  seats: readonly RequestedSeat[],
): readonly { readonly key: string; readonly label: SeatLabel }[] {
  const guests: { readonly key: string; readonly label: SeatLabel }[] = [];
  for (const seat of seats) {
    const subject = seat.subject;
    if (subject.kind !== 'guest' || subject.guestKey === undefined) continue;
    const label = SeatLabel.create(subject.label);
    if (label.isFailure()) continue;
    guests.push({ key: subject.guestKey, label: label.value });
  }
  return guests;
}

/** The system's refusal → the legacy error class the callers branch on. */
function toLegacyError(
  error: BookingCommitError,
  request: DecideBookingRequest,
): CommitBookingError {
  switch (error.code) {
    case BookingCommitErrorCode.InvalidInput:
      if (error.field === BookingCommitField.LocationId && error.reason) {
        return new CommitBookingShopUnavailableError(
          error.detail ?? '',
          error.reason === 'unlisted' ? 'unlisted' : 'not_found',
        );
      }
      if (error.field === BookingCommitField.PersonOverlap) {
        return new CommitBookingPersonDoubleBookedError(error.detail ?? '');
      }
      if (error.field === BookingCommitField.GuestLabel) {
        return new CommitBookingDuplicateGuestLabelError(
          labelSharedByTwoGuests(namedGuestsOf(request.seats))?.value ??
            error.detail ??
            '',
        );
      }
      return new CommitBookingInvalidInputError(error.field);
    case BookingCommitErrorCode.Unauthenticated:
      return new CommitBookingUnauthenticatedError();
    case BookingCommitErrorCode.UnknownService:
      return new CommitBookingUnknownServiceError(error.serviceId);
    case BookingCommitErrorCode.ServiceNotAtLocation:
      return new CommitBookingServiceNotAtLocationError(
        error.serviceId,
        error.locationId,
      );
    case BookingCommitErrorCode.ConflictingServices:
      return new CommitBookingConflictingServicesError(
        error.first,
        error.second,
      );
    case BookingCommitErrorCode.BarberNotRostered:
      return new CommitBookingBarberNotRosteredError(
        error.barberId,
        error.dayKey,
      );
    case BookingCommitErrorCode.SlotUnavailable:
      return new CommitBookingSlotUnavailableError(
        error.barberId,
        request.seats.at(error.seatIndex)?.startIso ?? '',
      );
    case BookingCommitErrorCode.TooSoon:
      return new CommitBookingTooSoonError(error.minLeadMinutes);
    case BookingCommitErrorCode.BeyondHorizon:
      return new CommitBookingBeyondHorizonError(error.horizonMonths);
    case BookingCommitErrorCode.PartyTooLarge:
      return new CommitBookingPartyTooLargeError(error.maxPartySize);
    case BookingCommitErrorCode.InvariantViolated:
      return new CommitBookingInvariantError(
        error.violations.map(toLegacyViolation),
      );
  }
}

function toLegacyViolation(violation: SchedulingError): AppointmentError {
  switch (violation.code) {
    case SchedulingErrorCode.AppointmentEmptySeats:
      return new AppointmentEmptySeatsError();
    case SchedulingErrorCode.AppointmentMultipleSelfSeats:
      return new AppointmentMultipleSelfSeatsError();
    case SchedulingErrorCode.AppointmentPastStartTime:
      return new AppointmentPastStartTimeError();
    case SchedulingErrorCode.AppointmentBarberDoubleBooked:
      return new AppointmentBarberDoubleBookedError(violation.barberId);
    case SchedulingErrorCode.AppointmentMixedCurrency:
      return new AppointmentMixedCurrencyError(
        violation.expected,
        violation.found,
      );
    case SchedulingErrorCode.IdEmpty:
    default:
      return new EmptyIdError('AppointmentId');
  }
}

/**
 * The system's draft → the legacy aggregate, built through the legacy
 * factories exactly as the decision always built it (`create`, or
 * `reconstitute` for the shop's own placement, then `confirm`).
 */
function toLegacyDecision(
  decision: {
    readonly appointment: {
      readonly id: string;
      readonly seats: readonly EcsSeat[];
      readonly bookingStatus: { readonly kind: string };
      readonly bookedFromAppointmentId: string | null;
    };
    readonly busyWrites: readonly {
      readonly barberId: string;
      readonly dayKey: string;
      readonly interval: Interval;
    }[];
  },
  request: DecideBookingRequest,
  snapshot: BookingSnapshot,
  deps: DecideBookingDeps,
): Result<BookingDecision, CommitBookingError> {
  const seats: Seat[] = [];
  for (const seat of decision.appointment.seats) {
    const legacy = toLegacySeat(seat, snapshot);
    if (legacy === null) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }
    seats.push(legacy);
  }
  let contact: BookingContact | null = null;
  if (request.contact) {
    const parsed = BookingContact.create(request.contact);
    if (parsed.isFailure()) {
      return fail(new CommitBookingInvalidInputError('contact'));
    }
    contact = parsed.value;
  }
  const props = {
    id: decision.appointment.id,
    locationId: request.locationId,
    seats,
    contact,
    bookedFromAppointmentId: request.bookedFromAppointmentId ?? null,
  };
  const built =
    deps.allowOutsideWindow === true
      ? Appointment.reconstitute({
          ...props,
          status: PENDING,
          bookedAt: deps.now,
        })
      : Appointment.create({ ...props, now: deps.now });
  if (built.isFailure()) {
    return fail(new CommitBookingInvariantError(built.error));
  }
  const appointment =
    decision.appointment.bookingStatus.kind === 'confirmed'
      ? built.value.confirm()
      : ok(built.value);
  if (appointment.isFailure()) {
    return fail(new CommitBookingInvariantError(appointment.error));
  }
  return ok({
    appointment: appointment.value,
    busyWrites: decision.busyWrites.map((write) => ({
      barberId: write.barberId,
      dayKey: write.dayKey,
      interval: write.interval,
    })),
  });
}

/** One decided seat → the legacy `Seat`; `null` if a figure the system admitted does not rebuild. */
function toLegacySeat(seat: EcsSeat, snapshot: BookingSnapshot): Seat | null {
  const id = SeatId.create(seat.id);
  const serviceId = ServiceId.create(seat.serviceId);
  const barberId = BarberId.create(seat.barberId);
  const startsAt = ZonedDateTime.fromMillis(seat.startMs, snapshot.zone);
  const price = Money.fromMinorUnitsAndCode(
    seat.terms.priceMinorUnits,
    seat.terms.currencyCode,
  );
  if (
    id.isFailure() ||
    serviceId.isFailure() ||
    barberId.isFailure() ||
    startsAt.isFailure() ||
    price.isFailure()
  ) {
    return null;
  }
  const pads = {
    setupMinutes: seat.terms.setupMinutes,
    cleanupMinutes: seat.terms.cleanupMinutes,
  };
  const terms = ServiceTerms.create(
    price.value,
    seat.terms.durationMinutes,
    pads,
  );
  if (terms.isFailure()) return null;

  let variantId: ServiceVariantId | null = null;
  if (seat.variantId !== null) {
    const parsed = ServiceVariantId.create(seat.variantId);
    if (parsed.isFailure()) return null;
    variantId = parsed.value;
  }

  const catalogTerms =
    seat.terms.catalogPriceMinorUnits === null
      ? null
      : catalogTermsOf(seat, snapshot.services, barberId.value, variantId);

  let subject: SeatSubject;
  if (seat.subject.kind === 'account') {
    const userId = UserId.create(seat.subject.userId);
    if (userId.isFailure()) return null;
    subject = SeatSubject.account(userId.value, seat.subject.relationship);
  } else {
    const label = SeatLabel.create(seat.subject.label);
    if (label.isFailure()) return null;
    subject = SeatSubject.anonymous(label.value);
  }

  return Seat.of({
    id: id.value,
    subject,
    serviceId: serviceId.value,
    variantId,
    barberId: barberId.value,
    terms: terms.value,
    catalogTerms,
    startsAt: startsAt.value,
    pref:
      seat.barberPref === 'any'
        ? BarberPref.any()
        : seat.barberPref === 'specific'
          ? BarberPref.specific(barberId.value)
          : null,
  });
}

/**
 * The catalogue's answer the seat was resolved against, kept as provenance
 * (`catalogTerms`) when the system found the charged terms differ from it.
 * Rebuilt from the legacy catalogue itself — `termsFor` with the CATALOGUE's
 * own pads, exactly as the legacy `resolveTerms` kept it — because the
 * system's `SeatTerms` keeps only the catalogue price and duration: an
 * override that changes nothing but a pad must still record the row it
 * overruled. Falls back to the stored pair (charged pads) only when the row
 * is gone, as `catalogTermsFromDocument` reads it back.
 */
function catalogTermsOf(
  seat: EcsSeat,
  services: readonly Service[],
  barberId: BarberId,
  variantId: ServiceVariantId | null,
): ServiceTerms | null {
  const service = services.find((each) => each.id.value === seat.serviceId);
  if (service !== undefined) return service.termsFor(barberId, variantId);
  if (
    seat.terms.catalogPriceMinorUnits === null ||
    seat.terms.catalogDurationMinutes === null
  ) {
    return null;
  }
  const catalogPrice = Money.fromMinorUnitsAndCode(
    seat.terms.catalogPriceMinorUnits,
    seat.terms.currencyCode,
  );
  if (catalogPrice.isFailure()) return null;
  const catalog = ServiceTerms.create(
    catalogPrice.value,
    seat.terms.catalogDurationMinutes,
    {
      setupMinutes: seat.terms.setupMinutes,
      cleanupMinutes: seat.terms.cleanupMinutes,
    },
  );
  return catalog.isSuccess() ? catalog.value : null;
}
