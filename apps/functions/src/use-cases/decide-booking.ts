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
  paddedBusy,
  toEcsDetail,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import type { AppointmentPlacement } from '@creativo/application/booking';
import {
  BarberId as EcsBarberId,
  BookingError,
  BookingErrorCode,
  BookingErrorField,
  BookingStatus,
  BusyKey,
  Currency,
  DurationMinutes,
  EndMinute,
  LocalDate,
  LocationId as EcsLocationId,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  SchedulingErrorCode,
  type SchedulingError,
  SeatId as EcsSeatId,
  SeatKeyText,
  type TimeError,
  TimeErrorCode,
  type TimeZone,
  UserId as EcsUserId,
  UtcEpochMs,
  type Weekday,
  defect,
} from '@core/primitives';
import {
  BarberPreference,
  DayHours,
  E164,
  type ExceptionEffectRule,
  type MinuteRange,
  Placement,
  type Seat as EcsSeat,
  type ScheduleVersion,
  SeatSubject as EcsSeatSubject,
  ShiftSegment,
  type ShopNow,
  type StaffTermsOverride as EcsStaffTermsOverride,
  SubjectRelationship,
} from '@core/components';
import {
  type BookingDecision as EcsBookingDecision,
  BookingDecisionSystem,
  type BookingSnapshot as EcsBookingSnapshot,
  type ChairTime as EcsChairTime,
  type DecideBookingInput as EcsDecideBookingInput,
  type DecisionBusyDay,
  type DecisionException,
  type DecisionStandingSeat,
  GuestLabelSystem,
  type RequestedSeatInput as EcsRequestedSeatInput,
  type RequestedSubjectInput,
  RequestedSubjectRole,
  ScheduleExceptionSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  CommitBookingBarberNotRosteredError,
  CommitBookingBeyondHorizonError,
  CommitBookingConflictingServicesError,
  CommitBookingDstGapError,
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
import { toEcsPolicy, toEcsService } from './party-admission';

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
 * `@core/systems` — terms re-derived from the catalogue, the owner from
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
  const framed = toEcsRequest(request, snapshot.zone);
  if (framed.gap !== null)
    return fail(new CommitBookingDstGapError(framed.gap));
  // On a DST transition day the barber-busy collision is judged on the
  // absolute timeline below (`collisionOnInstants`), not on the wall clock.
  const onInstants = deps.allowOverlap !== true && isTransitionDay(framed);
  const decided = BookingDecisionSystem.decide(
    framed.input,
    toEcsSnapshot(snapshot, framed.timeZone),
    toEcsPolicy(deps.policy),
    {
      allowOutsideWindow: outside,
      skipMinNotice: outside,
      allowOverlap: deps.allowOverlap === true || onInstants,
      allowConflictingServices: deps.allowConflictingServices === true,
    },
    releaseOf(snapshot.release ?? [], framed),
    {
      now: shopNowOf(deps.now, framed.timeZone),
      startUtcMs: framed.startUtcMs ?? instantOf(deps.now.toMillis()),
      nextId: deps.nextId,
      ownerUserId:
        deps.ownerUserId === null ? null : EcsUserId.of(deps.ownerUserId),
      termsOverrides: overridePatchesOf(deps.termsOverrides),
      standing: standingOf(deps.standing ?? []),
      stood: (deps.stood ?? []).map(([seatId, otherSeatId]) => ({
        seatId: EcsSeatId.of(seatId),
        otherSeatId: EcsSeatId.of(otherSeatId),
      })),
      parsePhone,
    },
  );
  if (!decided.ok) return fail(toLegacyError(decided.error, request));
  if (onInstants) {
    const collision = collisionOnInstants(decided.value, framed, snapshot);
    if (collision !== null) return fail(toLegacyError(collision, request));
  }
  return toLegacyDecision(decided.value, request, snapshot, deps, framed);
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

/*
 * THE SHOP DAY. The system decides a request on ONE shop day, on its wall
 * clock (T7, Law 7.3); the legacy request carries an instant per seat. The
 * shim reads each start ONCE at this ingestion boundary with the location's
 * zone (`ZonedTimeSystem.parseIsoIn`, flatten-spec §2.4): an offset start is
 * the instant it names; a bare wall clock is placed on the shop's clock — a
 * time inside the spring-forward gap is refused as `DST_GAP_INVALID_TIME`
 * (never shifted forward), a fall-back repeat takes the earlier offset. Each
 * instant is read back on the wall clock with `toLocal` and placed on the
 * shop day of the FIRST seat that parses: a seat that does not parse, or one
 * on another day, has no minute on that day and is refused where the
 * decision refuses an unparsed start (`invalid_input: startIso`). Every
 * instant the legacy answer carries — a seat's `startsAt`, a busy write — is
 * the request's own, never a wall clock read back.
 */

/** A real day of 24 hours — a transition day is one hour shorter or longer. */
const MS_PER_DAY = 86_400_000;

/**
 * A brand the legacy value already satisfies — its own rules are the
 * brand's (a legacy roster, `CalendarDay` or instant already holds every
 * rule the brand checks), so a refusal is a programmer defect.
 */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  return result.ok ? result.value : defect(`unreachable: ${what}`);
}

function instantOf(ms: number): UtcEpochMs {
  return sure(UtcEpochMs.of(ms), 'an instant');
}

/**
 * A wire `startIso`, read ONCE at the ingestion boundary with the shop's
 * zone (`ZonedTimeSystem.parseIsoIn`): an offset start's own instant, a
 * wall clock's through `toUtc` — `DST_GAP_INVALID_TIME` inside the
 * spring-forward gap, the earlier offset in a fall-back repeat. The one
 * reading the commit, a client's move and the transaction's busy read share
 * (an unknown zone reads nothing: `TIME_INVALID_TIME_ZONE`).
 */
export function readStartIso(
  startIso: string,
  zone: string,
): ReturnType<typeof ZonedTimeSystem.parseIsoIn> {
  const timeZone = ZonedTimeSystem.checkZone(zone);
  return timeZone.ok
    ? ZonedTimeSystem.parseIsoIn(startIso, timeZone.value)
    : timeZone;
}

/** The request on its shop day: the system's input, and how the shim reads it back. */
type FramedRequest = {
  readonly input: EcsDecideBookingInput;
  /** The shop's zone, or `null` when the engine cannot read it. */
  readonly timeZone: TimeZone | null;
  /** Each request seat's parsed start (`null`: did not parse), by index. */
  readonly startsMs: readonly (number | null)[];
  /** The first seat start inside the spring-forward gap, refused before anything is decided. */
  readonly gap: TimeError.DstGap | null;
  /** The envelope's start instant — the earliest seat placed on the day. */
  readonly startUtcMs: UtcEpochMs | null;
};

/**
 * An instant → its wall-clock minute on `localDate`'s axis in `timeZone`
 * (counted past `1440` for a later day, below `0` for an earlier one).
 */
function minuteOn(
  localDate: LocalDate,
  timeZone: TimeZone,
  instantMs: number,
): number {
  const wall = ZonedTimeSystem.toLocal(instantOf(instantMs), timeZone);
  return LocalDate.daysBetween(localDate, wall.localDate) * 1440 + wall.minute;
}

/** Instants → the minute ranges of `localDate`, clipped to it. */
function rangesOn(
  localDate: LocalDate,
  timeZone: TimeZone,
  intervals: readonly Interval[],
): readonly MinuteRange[] {
  const ranges: MinuteRange[] = [];
  for (const interval of intervals) {
    const start = Math.max(minuteOn(localDate, timeZone, interval.startMs), 0);
    const end = Math.min(minuteOn(localDate, timeZone, interval.endMs), 1440);
    const from = MinuteOfDay.of(start);
    const to = EndMinute.of(end);
    if (start < end && from.ok && to.ok) {
      ranges.push({ startMinutes: from.value, endMinutes: to.value });
    }
  }
  return ranges;
}

function toEcsSubject(
  subject: RequestedSeat['subject'],
): RequestedSubjectInput {
  switch (subject.kind) {
    case 'self':
      return { requestedSubjectRole: RequestedSubjectRole.Self };
    case 'companion':
      return {
        requestedSubjectRole: RequestedSubjectRole.Companion,
        companionUserId: subject.userId,
      };
    case 'guest':
      return {
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: subject.label,
        guestKey: subject.guestKey ?? null,
      };
  }
}

/** The legacy placement ↔ the dictionary (`'self'` ↔ `SELF`). */
const PLACEMENT: Readonly<Record<AppointmentPlacement, Placement>> = {
  self: Placement.Self,
  staff: Placement.Staff,
};

/** The legacy preference ↔ the dictionary (`'any'` ↔ `ANY`). */
const PREFERENCE: Readonly<Record<'any' | 'specific', BarberPreference>> = {
  any: BarberPreference.Any,
  specific: BarberPreference.Specific,
};

/** The request, its starts read in the shop's zone and placed on the first seat's shop day. */
function toEcsRequest(
  request: DecideBookingRequest,
  zone: string,
): FramedRequest {
  const timeZone = ZonedTimeSystem.checkZone(zone);
  let gap: TimeError.DstGap | null = null;
  const startsMs = request.seats.map((seat) => {
    // An unreadable zone reads no start (every seat is refused unplaced).
    if (!timeZone.ok) return null;
    const start = ZonedTimeSystem.parseIsoIn(seat.startIso, timeZone.value);
    if (start.ok) return start.value;
    if (gap === null && start.error.errorCode === TimeErrorCode.DstGap) {
      gap = start.error;
    }
    return null;
  });
  // The shop day: the first seat that parses (an unreadable zone has none).
  let localDate: LocalDate | null = null;
  if (timeZone.ok) {
    for (const startMs of startsMs) {
      const instant = startMs === null ? null : UtcEpochMs.of(startMs);
      if (instant === null || !instant.ok) continue;
      localDate = ZonedTimeSystem.toLocal(
        instant.value,
        timeZone.value,
      ).localDate;
      break;
    }
  }
  let startUtcMs: UtcEpochMs | null = null;
  const seats: EcsRequestedSeatInput[] = request.seats.map((seat, index) => {
    const startMs = startsMs[index] ?? null;
    let startMinutes: number | null = null;
    if (startMs !== null && localDate !== null && timeZone.ok) {
      const minute = minuteOn(localDate, timeZone.value, startMs);
      // Only a minute OF this shop day places the seat on it.
      if (MinuteOfDay.of(minute).ok) {
        startMinutes = minute;
        if (startUtcMs === null || startMs < startUtcMs) {
          startUtcMs = instantOf(startMs);
        }
      }
    }
    return {
      lineId: seat.lineId,
      serviceId: seat.serviceId,
      variantId: seat.variantId,
      barberId: seat.barberId,
      barberPreference:
        seat.barberPref === undefined ? null : PREFERENCE[seat.barberPref],
      startMinutes,
      subject: toEcsSubject(seat.subject),
    };
  });
  return {
    input: {
      locationId: request.locationId,
      localDate: localDate ?? '',
      seats,
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
      placement:
        request.placement === undefined ? null : PLACEMENT[request.placement],
    },
    timeZone: timeZone.ok ? timeZone.value : null,
    startsMs,
    gap,
    startUtcMs,
  };
}

/**
 * Is the request's shop day a DST transition day — one whose wall clock is
 * not its elapsed time (23 or 25 hours long)? On such a day a wall-clock
 * minute range is no measure of what overlaps: a span after the
 * spring-forward reads an hour later than the time that passed, and the
 * fall-back hour reads twice.
 */
function isTransitionDay(framed: FramedRequest): boolean {
  const day = LocalDate.parse(framed.input.localDate);
  if (framed.timeZone === null || !day.ok) return false;
  const length = UtcEpochMs.elapsedMs(
    ZonedTimeSystem.startOfLocalDay(day.value, framed.timeZone),
    ZonedTimeSystem.startOfLocalDay(
      LocalDate.addDays(day.value, 1),
      framed.timeZone,
    ),
  );
  return length !== MS_PER_DAY;
}

/**
 * The barber-busy collision on the ABSOLUTE timeline — the commit check the
 * legacy decision made, kept for a transition day, where the wall-clock
 * check would let a real double booking through (a seat before the
 * spring-forward against a span after it) or refuse two seats an hour apart
 * (the repeated fall-back hour). Each decided seat's chair time, on the
 * request's own instants with its raw pads (exactly the busy write it would
 * make), against what is taken — the stored spans with this visit's own
 * chairs handed back first, padded by the barber's turnaround by the ONE
 * rule the grid reads by (`paddedBusy`). The first seat that collides, in
 * request order, is the refusal the decision would have given.
 */
function collisionOnInstants(
  decision: EcsBookingDecision,
  framed: FramedRequest,
  snapshot: BookingSnapshot,
): BookingError | null {
  const localDate = LocalDate.parse(framed.input.localDate);
  if (!localDate.ok) return null;
  const decided = decision.appointment.seats;
  for (let index = 0; index < decided.length; index++) {
    const seat = decided.at(index) as EcsSeat;
    const startMs = framed.startsMs.at(index) ?? null;
    const barberId = BarberId.create(seat.barberId);
    if (startMs === null || barberId.isFailure()) continue;
    const occupied = Interval.of(
      startMs - seat.setupMinutes * 60_000,
      startMs + (seat.durationMinutes + seat.cleanupMinutes) * 60_000,
    );
    const taken = paddedBusy({
      barberId: barberId.value,
      spans:
        snapshot.busy.get(BusyKey.of(seat.barberId, localDate.value)) ?? [],
      turnaroundMinutes:
        snapshot.schedules.get(seat.barberId)?.turnaroundMinutes ?? 0,
      release: snapshot.release ?? [],
    });
    if (taken.some((span) => Interval.overlaps(span, occupied))) {
      return BookingError.slotUnavailable(
        seat.barberId,
        localDate.value,
        seat.startMinutes,
        index,
      );
    }
  }
  return null;
}

/**
 * The shop's "now" — derived once from the legacy clock's instant and the
 * shop's zone (UTC stands in for a zone the engine cannot read: every seat
 * is refused as unplaceable before the clock is compared).
 */
function shopNowOf(now: ZonedDateTime, timeZone: TimeZone | null): ShopNow {
  return ZonedTimeSystem.shopNow(
    instantOf(now.toMillis()),
    timeZone ?? sure(ZonedTimeSystem.checkZone('UTC'), 'UTC'),
  );
}

/** The chairs a rebuilt visit hands back, on the request's shop day. */
function releaseOf(
  release: readonly ChairTime[],
  framed: FramedRequest,
): readonly EcsChairTime[] {
  const localDate = LocalDate.parse(framed.input.localDate);
  if (framed.timeZone === null || !localDate.ok) return [];
  const chairs: EcsChairTime[] = [];
  for (const chair of release) {
    for (const range of rangesOn(localDate.value, framed.timeZone, [
      chair.occupied,
    ])) {
      chairs.push({
        barberId: EcsBarberId.of(chair.barberId.value),
        startMinutes: sure(MinuteOfDay.of(range.startMinutes), 'a chair start'),
        endMinutes: sure(EndMinute.of(range.endMinutes), 'a chair end'),
      });
    }
  }
  return chairs;
}

/**
 * The visit as it stands, for the "one person, one chair" rule — which only
 * compares its seats WITH EACH OTHER (the pairs it already held), so they
 * are read on their own frame: minutes from the earliest standing start.
 */
function standingOf(
  standing: readonly StandingSeat[],
): readonly DecisionStandingSeat[] {
  let originMs = Number.POSITIVE_INFINITY;
  for (const seat of standing) {
    if (seat.startMs < originMs) originMs = seat.startMs;
  }
  const origin = Math.floor(originMs / 60_000) * 60_000;
  return standing.map((seat) => ({
    seatId: EcsSeatId.of(seat.id),
    subject: toEcsSubject(seat.subject),
    startMinutes: sure(
      MinuteOfDay.of(Math.floor((seat.startMs - origin) / 60_000)),
      'a standing start',
    ),
    durationMinutes: sure(
      DurationMinutes.of(seat.durationMinutes),
      'a standing duration',
    ),
  }));
}

function toEcsSnapshot(
  snapshot: BookingSnapshot,
  timeZone: TimeZone | null,
): EcsBookingSnapshot {
  const busy: DecisionBusyDay[] = [];
  for (const [key, spans] of snapshot.busy) {
    const id = BusyKey.parse(key);
    const day = LocalDate.parse(key.slice(key.lastIndexOf('__') + 2));
    if (id === null || !day.ok || timeZone === null) continue;
    busy.push({ id, spans: rangesOn(day.value, timeZone, spans) });
  }
  const exceptions: DecisionException[] = [];
  for (const [key, exception] of snapshot.exceptions) {
    const id = BusyKey.parse(key);
    const effect = effectOf(exception);
    const localDate = LocalDate.parse(exception.day.key());
    if (id === null || effect === null || !localDate.ok) continue;
    exceptions.push({
      // The key's barber half — everything before its LAST `__`.
      barberId: EcsBarberId.of(key.slice(0, key.lastIndexOf('__'))),
      localDate: localDate.value,
      ...effect,
    });
  }
  return {
    shopHours: weekOf(snapshot.shopHours),
    services: snapshot.services.map(toEcsService),
    schedules: [...snapshot.schedules].map(([barberId, schedule]) => ({
      barberId: EcsBarberId.of(barberId),
      versions: versionsOf(schedule.history),
      turnaroundMinutes: sure(
        MinuteCount.of(schedule.turnaroundMinutes),
        'a turnaround',
      ),
    })),
    busy,
    exceptions,
  };
}

/**
 * A carried figure → its brand. The carry is built server-side from STORED
 * seats, so it always parses; one that does not is a corrupt carry, handed
 * through as it is for the decision's own guards to refuse where they
 * always did (`invalid_input: priceMinorUnits | durationMinutes`).
 */
function carried<T>(
  parsed: { readonly ok: true; readonly value: T } | { readonly ok: false },
  raw: number | string,
): T {
  return parsed.ok ? parsed.value : (raw as unknown as T);
}

function overridePatchesOf(
  overrides: ReadonlyMap<string, StaffTermsOverride> | undefined,
): readonly EcsStaffTermsOverride[] {
  return [...(overrides ?? [])].map(([seatKey, override]) => {
    const price = override.priceMinorUnits;
    const code = override.currencyCode;
    const duration = override.durationMinutes;
    const setup = override.setupMinutes;
    const cleanup = override.cleanupMinutes;
    return {
      seatKey: SeatKeyText.of(seatKey),
      priceCents:
        price === undefined ? null : carried(PriceCents.of(price), price),
      // A stored code is read case-insensitively and untrimmed by the
      // decision itself (`storedCurrencyOf`), as the legacy kernel read it.
      currency:
        code === undefined
          ? null
          : carried<Currency>(
              code.trim() === code ? Currency.parse(code) : { ok: false },
              code,
            ),
      durationMinutes:
        duration === undefined
          ? null
          : carried(DurationMinutes.of(duration), duration),
      setupMinutes:
        setup === undefined ? null : carried(MinuteCount.of(setup), setup),
      cleanupMinutes:
        cleanup === undefined
          ? null
          : carried(MinuteCount.of(cleanup), cleanup),
    };
  });
}

/** The kernel's phone rule, so a contact parses exactly as it always did. */
function parsePhone(raw: string): E164 | null {
  const phone = PhoneNumber.create(raw);
  return phone.isSuccess() ? E164.of(phone.value.value) : null;
}

/** The roster history → its versions, the weekday map flattened to segments. */
function versionsOf(history: StaffScheduleHistory): readonly ScheduleVersion[] {
  return history.all().map((version) => ({
    seq: version.seq,
    effectiveFromLocalDate: sure(
      LocalDate.parse(version.effectiveFrom.key()),
      'a version start',
    ),
    effectiveToLocalDate:
      version.effectiveTo === null
        ? null
        : sure(LocalDate.parse(version.effectiveTo.key()), 'a version end'),
    segments: WEEKDAYS.flatMap((weekday, index) =>
      version.pattern
        .segmentsOn(weekday)
        .map((segment) =>
          ShiftSegment.of(
            (index + 1) as Weekday,
            EcsLocationId.of(segment.locationId.value),
            sure(
              MinuteOfDay.of(segment.start.minutesFromMidnight()),
              'a segment start',
            ),
            sure(
              EndMinute.of(segment.end.minutesFromMidnight()),
              'a segment end',
            ),
          ),
        ),
    ),
  }));
}

/**
 * `'HH:mm'` weeks → minutes. A week holding a clock that does not parse
 * (refused by the `Location` aggregate, so never stored) publishes nothing;
 * a closing `00:00` opens nothing (an inverted day): closed.
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
    const end = EndMinute.of(closes.value);
    week.push(
      end.ok ? DayHours.open(opens.value, end.value) : DayHours.closed(),
    );
  }
  return week;
}

/**
 * A published exception → its public effect: the GDPR boundary is
 * `ScheduleExceptionSystem.publicEffect`, the detail converted once by the
 * scheduling shim's `toEcsDetail`.
 */
function effectOf(exception: ScheduleException): ExceptionEffectRule | null {
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
  error: BookingError,
  request: DecideBookingRequest,
): CommitBookingError {
  switch (error.errorCode) {
    case BookingErrorCode.InvalidInput:
      if (error.field === BookingErrorField.LocationId && error.reason) {
        return new CommitBookingShopUnavailableError(
          error.detail ?? '',
          error.reason === 'unlisted' ? 'unlisted' : 'not_found',
        );
      }
      if (error.field === BookingErrorField.PersonOverlap) {
        return new CommitBookingPersonDoubleBookedError(error.detail ?? '');
      }
      if (error.field === BookingErrorField.GuestLabel) {
        return new CommitBookingDuplicateGuestLabelError(
          labelSharedByTwoGuests(namedGuestsOf(request.seats))?.value ??
            error.detail ??
            '',
        );
      }
      return new CommitBookingInvalidInputError(error.field);
    case BookingErrorCode.Unauthenticated:
      return new CommitBookingUnauthenticatedError();
    case BookingErrorCode.UnknownService:
      return new CommitBookingUnknownServiceError(error.serviceId);
    case BookingErrorCode.ServiceNotAtLocation:
      return new CommitBookingServiceNotAtLocationError(
        error.serviceId,
        error.locationId,
      );
    case BookingErrorCode.ConflictingServices:
      return new CommitBookingConflictingServicesError(
        error.first,
        error.second,
      );
    case BookingErrorCode.BarberNotRostered:
      return new CommitBookingBarberNotRosteredError(
        error.barberId,
        error.localDate,
      );
    case BookingErrorCode.SlotUnavailable:
      return new CommitBookingSlotUnavailableError(
        error.barberId,
        request.seats.at(error.seatIndex)?.startIso ?? '',
      );
    case BookingErrorCode.TooSoon:
      return new CommitBookingTooSoonError(error.minLeadMinutes);
    case BookingErrorCode.BeyondHorizon:
      return new CommitBookingBeyondHorizonError(error.horizonMonths);
    case BookingErrorCode.PartyTooLarge:
      return new CommitBookingPartyTooLargeError(error.maxPartySize);
    case BookingErrorCode.InvariantViolated:
      return new CommitBookingInvariantError(
        error.violations.map(toLegacyViolation),
      );
  }
}

function toLegacyViolation(violation: SchedulingError): AppointmentError {
  switch (violation.errorCode) {
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
  decision: EcsBookingDecision,
  request: DecideBookingRequest,
  snapshot: BookingSnapshot,
  deps: DecideBookingDeps,
  framed: FramedRequest,
): Result<BookingDecision, CommitBookingError> {
  const seats: Seat[] = [];
  const busyWrites: BusyWrite[] = [];
  const decided = decision.appointment.seats;
  for (let index = 0; index < decided.length; index++) {
    const seat = decided[index] as EcsSeat;
    // Seats are decided in request order, each at its requested start: the
    // request's own instant is the seat's.
    const startMs = framed.startsMs[index] ?? null;
    const legacy =
      startMs === null ? null : toLegacySeat(seat, startMs, snapshot);
    if (startMs === null || legacy === null) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }
    seats.push(legacy);
    // The projection records what is actually taken, pads included — the
    // seat's chair time, on its shop day.
    busyWrites.push({
      barberId: seat.barberId,
      dayKey: decision.appointment.localDate,
      interval: Interval.of(
        startMs - seat.setupMinutes * 60_000,
        startMs + (seat.durationMinutes + seat.cleanupMinutes) * 60_000,
      ),
    });
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
    decision.appointment.bookingStatus === BookingStatus.Confirmed
      ? built.value.confirm()
      : ok(built.value);
  if (appointment.isFailure()) {
    return fail(new CommitBookingInvariantError(appointment.error));
  }
  return ok({ appointment: appointment.value, busyWrites });
}

/** The relationship dictionary → the legacy lowercase value. */
const RELATIONSHIP: Readonly<
  Record<SubjectRelationship, 'self' | 'companion' | 'client'>
> = {
  [SubjectRelationship.Self]: 'self',
  [SubjectRelationship.Companion]: 'companion',
  [SubjectRelationship.Client]: 'client',
};

/** One decided seat → the legacy `Seat`; `null` if a figure the system admitted does not rebuild. */
function toLegacySeat(
  seat: EcsSeat,
  startMs: number,
  snapshot: BookingSnapshot,
): Seat | null {
  const id = SeatId.create(seat.seatId);
  const serviceId = ServiceId.create(seat.serviceId);
  const barberId = BarberId.create(seat.barberId);
  const startsAt = ZonedDateTime.fromMillis(startMs, snapshot.zone);
  const price = Money.fromMinorUnitsAndCode(seat.priceCents, seat.currency);
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
    setupMinutes: seat.setupMinutes,
    cleanupMinutes: seat.cleanupMinutes,
  };
  const terms = ServiceTerms.create(price.value, seat.durationMinutes, pads);
  if (terms.isFailure()) return null;

  let variantId: ServiceVariantId | null = null;
  if (seat.variantId !== null) {
    const parsed = ServiceVariantId.create(seat.variantId);
    if (parsed.isFailure()) return null;
    variantId = parsed.value;
  }

  const catalogTerms =
    seat.catalogPriceCents === null
      ? null
      : catalogTermsOf(seat, snapshot.services, barberId.value, variantId);

  let subject: SeatSubject;
  if (seat.seatSubject === EcsSeatSubject.Account) {
    const userId = UserId.create(seat.subjectUserId);
    if (userId.isFailure()) return null;
    subject = SeatSubject.account(
      userId.value,
      RELATIONSHIP[seat.subjectRelationship],
    );
  } else {
    const label = SeatLabel.create(seat.guestLabel);
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
      seat.barberPreference === BarberPreference.Any
        ? BarberPref.any()
        : seat.barberPreference === BarberPreference.Specific
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
  if (seat.catalogPriceCents === null || seat.catalogDurationMinutes === null) {
    return null;
  }
  const catalogPrice = Money.fromMinorUnitsAndCode(
    seat.catalogPriceCents,
    seat.currency,
  );
  if (catalogPrice.isFailure()) return null;
  const catalog = ServiceTerms.create(
    catalogPrice.value,
    seat.catalogDurationMinutes,
    {
      setupMinutes: seat.setupMinutes,
      cleanupMinutes: seat.cleanupMinutes,
    },
  );
  return catalog.isSuccess() ? catalog.value : null;
}
