import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  BarberId,
  type LocationDayHours,
  LocationId,
  Service,
  ServiceId,
  ServiceTerms,
} from '@creativo/domain/catalog';
import {
  Appointment,
  BarberPref,
  BookingContact,
  type BookingContactProps,
  BookingPolicy,
  CalendarDay,
  type ChairTime,
  Interval,
  PENDING,
  Seat,
  SeatId,
  SeatLabel,
  type SeatIdPair,
  type SeatSlot,
  SeatSubject,
  ScheduleException,
  StaffScheduleHistory,
  StandingDoubleSeatings,
  buildDayWindows,
  labelSharedByTwoGuests,
  paddedBusy,
  shopDayHours,
  windowsAt,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import type { AppointmentPlacement } from '@creativo/application/booking';
import {
  CommitBookingBarberNotRosteredError,
  CommitBookingBeyondHorizonError,
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingInvariantError,
  CommitBookingShopUnavailableError,
  CommitBookingSlotUnavailableError,
  CommitBookingTooSoonError,
} from './commit-booking.errors';
import {
  CommitBookingDuplicateGuestLabelError,
  CommitBookingPersonDoubleBookedError,
} from './decide-booking.errors';
import { partyAdmissible } from './party-admission';

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

/** `${barberId}__${dayKey}` — the busy projection's composite key. */
function busyKey(barberId: string, dayKey: string): string {
  return `${barberId}__${dayKey}`;
}

/**
 * Decide whether a requested booking may be written, and what writing it
 * means. Pure: every fact comes from `snapshot` and `deps`, so the whole
 * server-side authority is unit-testable without an emulator.
 *
 * ### What the server re-derives rather than trusts
 * The client sends WHAT it wants and WHO it wants it from. Everything that
 * determines whether that is legal, and what it costs, is recomputed here:
 *
 * - **Terms** come from `Service.termsFor(barberId, variantId)`, so the price
 *   and duration are the catalog's. A client naming its own price would book
 *   a 40 € fade for nothing; one naming its own duration would book over the
 *   next appointment.
 * - **The owner** comes from the verified auth token, never the payload — so
 *   nobody books in someone else's name.
 * - **Windows** come from `buildDayWindows` against the roster and the shop's
 *   published hours, so a seat cannot be placed at a time nobody works.
 * - **Conflicts** are re-checked per person: the UI locks conflicting
 *   services, and a UI is not an enforcement boundary.
 * - **People** are re-counted: no write puts one person in two chairs at
 *   once anew (`CommitBookingPersonDoubleBookedError`; a pair a rebuilt
 *   visit already held stands, by seat id: `deps.standing`), and two guests
 *   the client tells apart may not share the label that is their only
 *   identity (`CommitBookingDuplicateGuestLabelError`, the domain's
 *   `labelSharedByTwoGuests`).
 * - **Collisions** are checked against the busy set read in this transaction,
 *   which is what makes two people racing for 14:00 resolve to one winner.
 */
export function decideBooking(
  request: DecideBookingRequest,
  snapshot: BookingSnapshot,
  deps: DecideBookingDeps,
): Result<BookingDecision, CommitBookingError> {
  const locationIdResult = LocationId.create(request.locationId);
  if (locationIdResult.isFailure()) {
    // A blank id names no shop: the one "no usable shop" answer the store's
    // load gives a shop it cannot find.
    return fail(
      new CommitBookingShopUnavailableError(request.locationId, 'not_found'),
    );
  }
  const locationId = locationIdResult.value;

  // A walk-in the shop entered itself has no owner at all — see
  // `DecideBookingDeps.ownerUserId`. `toSubject` still refuses a `self` seat
  // without one, so "nobody owns this" can never become "anybody may claim it".
  let owner: UserId | null = null;
  if (deps.ownerUserId !== null) {
    const ownerResult = UserId.create(deps.ownerUserId);
    if (ownerResult.isFailure()) {
      return fail(new CommitBookingInvalidInputError('ownerUserId'));
    }
    owner = ownerResult.value;
  }

  // Two guests the client tells apart must not share a label: `personKey`
  // would read them as ONE person — counted once, their services judged
  // together, one of them in two chairs. Asked before anything counts people,
  // by the domain's own rule (the one `BookingParty.sharedLabel` reads), so
  // the flow and the server can never disagree about what "shared" means.
  const sharedLabel = labelSharedByTwoGuests(namedGuestsOf(request.seats));
  if (sharedLabel !== null) {
    return fail(new CommitBookingDuplicateGuestLabelError(sharedLabel.value));
  }

  // EVERY REFUSAL THAT DOES NOT DEPEND ON THE TIME, in one place
  // (`partyAdmissible`, round 6): nobody to seat, too many people, a
  // service unknown or not offered here, a variant missing or undeclared,
  // two services one person may not have together. The waitlist asks the
  // same function when a request is made and before every notification, so
  // it never promises what this refuses. A "person" is a subject: the
  // booker, each account companion and each distinctly-labelled guest. A
  // seat whose terms staff fixed (`termsOverrides`) is CARRIED: it survives
  // its service retiring or gaining variants since it was booked — the
  // frozen book the staff edit exists to unfreeze.
  const admission = partyAdmissible(
    request.seats.map((seat) => ({
      personKey: personKey(seat.subject),
      serviceId: seat.serviceId,
      variantId: seat.variantId,
      carried: deps.termsOverrides?.has(seat.lineId) === true,
    })),
    snapshot.services,
    deps.policy,
    {
      locationId,
      allowConflictingServices: deps.allowConflictingServices === true,
    },
  );
  if (admission.isFailure()) return fail(admission.error);

  const notBeforeMs = deps.now.toMillis() + deps.policy.minLeadMinutes * 60_000;
  const horizonEnd = deps.policy.horizonEndFrom(
    CalendarDay.fromZonedDateTime(deps.now),
  );

  /** Per barber+day, the spans THIS booking claims — for the projection write. */
  const busyWrites: BusyWrite[] = [];
  const seats: Seat[] = [];
  /** Every sold slot so far, whose, and which seat — "one person, one chair". */
  const seated: SeatSlot[] = [];
  /**
   * The double seatings the visit already held (`deps.standing`), and the
   * ones its last save broke while that save may still be undone
   * (`deps.stood`).
   */
  const standing = standingDoubleSeatingsOf(deps.standing ?? []).union(
    StandingDoubleSeatings.ofPairs(deps.stood ?? []),
  );

  for (const [index, requested] of request.seats.entries()) {
    const override = deps.termsOverrides?.get(requested.lineId);
    // eslint-disable-next-line security/detect-object-injection -- `index` is this very loop's index over `request.seats`, which `admission` was built from in order.
    const admitted = admission.value[index];
    // Unreachable: one admitted entry per requested seat, in order.
    if (admitted === undefined) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }
    const { service, variantId } = admitted;

    const barberIdResult = BarberId.create(requested.barberId);
    const serviceIdResult = ServiceId.create(requested.serviceId);
    if (barberIdResult.isFailure() || serviceIdResult.isFailure()) {
      return fail(new CommitBookingInvalidInputError('seat identifiers'));
    }
    const barberId = barberIdResult.value;

    const startResult = ZonedDateTime.fromISO(
      requested.startIso,
      snapshot.zone,
    );
    if (startResult.isFailure()) {
      return fail(new CommitBookingInvalidInputError('startIso'));
    }
    const start = startResult.value;

    if (!deps.allowOutsideWindow && start.toMillis() < notBeforeMs) {
      return fail(new CommitBookingTooSoonError(deps.policy.minLeadMinutes));
    }

    const day = CalendarDay.fromZonedDateTime(start);
    if (!deps.allowOutsideWindow && horizonEnd.isBefore(day)) {
      return fail(
        new CommitBookingBeyondHorizonError(deps.policy.horizonMonths),
      );
    }

    // SERVER-RESOLVED terms — the whole point of the round trip. The catalog
    // answers first, always; an override then replaces the numbers staff are
    // allowed to fix, and what the catalog said is kept beside them.
    const catalogTerms = service?.termsFor(barberId, variantId) ?? null;
    const resolved = resolveTerms(catalogTerms, override);
    if (resolved.isFailure()) return fail(resolved.error);
    const { terms, provenance } = resolved.value;

    const subjectResult = toSubject(requested, owner);
    if (subjectResult.isFailure()) return fail(subjectResult.error);

    const seatIdResult = SeatId.create(deps.nextId());
    if (seatIdResult.isFailure()) {
      return fail(new CommitBookingInvalidInputError('seatId'));
    }

    const seat = Seat.of({
      id: seatIdResult.value,
      subject: subjectResult.value,
      serviceId: serviceIdResult.value,
      variantId,
      barberId,
      terms,
      catalogTerms: provenance,
      startsAt: start,
      pref:
        requested.barberPref === 'any'
          ? BarberPref.any()
          : requested.barberPref === 'specific'
            ? BarberPref.specific(barberId)
            : null,
    });
    seats.push(seat);

    // ONE PERSON, ONE CHAIR AT A TIME (owner decision, 2026-09-25) — on the
    // SOLD minutes, the rule the grid offers times by (`sitsTwiceAt`). Every
    // path decides through here, the shop's included: nobody's pen can put a
    // person in two chairs, and a cut then a beard, back to back, is fine.
    // Only a NEW overlap is refused (round 5): a pair of seats the rebuilt
    // visit already held, by id, stands wherever the edit put it
    // (`deps.standing`), and a seat the edit adds is judged in full.
    const sold: SeatSlot = {
      seatId: seat.id.value,
      personKey: personKey(requested.subject),
      slot: seat.soldTime(),
    };
    if (standing.seatsTwiceAnew(seated, sold)) {
      return fail(new CommitBookingPersonDoubleBookedError(sold.personKey));
    }
    seated.push(sold);

    // The chair is held for setup + service + cleanup; the client is sold the
    // service alone. Availability is checked against the former — the seat's
    // own statement of it, the span the projection records.
    const occupied = seat.chairTime();

    const placement = checkPlacement({
      barberId,
      locationId,
      day,
      occupied,
      snapshot,
      startIso: requested.startIso,
      allowOutsideWindow: deps.allowOutsideWindow === true,
      allowOverlap: deps.allowOverlap === true,
    });
    if (placement.isFailure()) return fail(placement.error);

    busyWrites.push({
      barberId: barberId.value,
      dayKey: day.key(),
      // The projection records what is actually taken, pads included: a
      // reader that only saw the sold slot would offer the cleanup minutes
      // to the next client.
      interval: occupied,
    });
  }

  // The contact is validated HERE, with the rest of the request, so an
  // unreachable number is refused before an appointment exists rather than
  // discovered when the shop tries to call. Absent is allowed (a booking
  // still works without one); present-and-broken is not.
  let contact: BookingContact | null = null;
  if (request.contact) {
    const contactResult = BookingContact.create(request.contact);
    if (contactResult.isFailure()) {
      return fail(new CommitBookingInvalidInputError('contact'));
    }
    contact = contactResult.value;
  }

  const appointmentResult = deps.allowOutsideWindow
    ? // The shop's own placement, so the FUTURE-START invariant is not asked.
      // `Appointment.create` refuses a start that is not after `now`, which is
      // right for a booking being made and wrong for a visit being corrected:
      // the party is in the chair, the clock has passed their start, and
      // "nudge them fifteen minutes" must not be refused on the grounds that
      // ten o'clock has already happened. `bookedAt` and `status` are
      // placeholders here — the staff path restores the appointment's real
      // ones, exactly as it restores the contact and the arrival stamp.
      Appointment.reconstitute({
        id: request.attemptId ?? deps.nextId(),
        locationId: locationId.value,
        seats,
        status: PENDING,
        bookedAt: deps.now,
        contact,
        bookedFromAppointmentId: request.bookedFromAppointmentId ?? null,
      })
    : Appointment.create({
        id: request.attemptId ?? deps.nextId(),
        locationId: locationId.value,
        seats,
        // `now` becomes the appointment's `bookedAt` — the booking instant, and
        // the denominator of every lead-time figure. It is the transaction's own
        // clock reading, so the number is the server's, not the caller's.
        now: deps.now,
        contact,
        bookedFromAppointmentId: request.bookedFromAppointmentId ?? null,
      });
  if (appointmentResult.isFailure()) {
    // This is where a party's own seats colliding on one barber is caught,
    // and where a mixed-currency cart dies.
    return fail(new CommitBookingInvariantError(appointmentResult.error));
  }

  // Auto-confirm (owner ruling 2026-08-07, `BookingPolicy.autoConfirm`,
  // default on). `Appointment.create` always stamps `pending` because a
  // booking's ACCEPTANCE is tenant policy, not a domain invariant — so the
  // policy is applied here, at the one place a booking comes into existence.
  //
  // Note what this does NOT say: `confirmed` means the shop accepted the
  // booking, never that the client is standing there. Arrival is its own
  // stamp (`Appointment.arrivedAt`), which is exactly why turning this on
  // does not cost the front desk its signal.
  // Staff placement CONFIRMS (2026-09-08): the shop that put the booking on
  // its own book has already accepted it, and a walk-in left `pending` would
  // wait on nobody. The staff-edit path discards this status anyway — it
  // restores the stored one — so only creation is affected.
  const appointment =
    deps.policy.autoConfirm || deps.allowOutsideWindow
      ? appointmentResult.value.confirm()
      : ok(appointmentResult.value);
  if (appointment.isFailure()) {
    return fail(new CommitBookingInvariantError(appointment.error));
  }

  return ok({ appointment: appointment.value, busyWrites });
}

/**
 * The terms this seat is actually written with, plus the catalog's answer
 * when the two differ.
 *
 * Three cases, and none of them is "trust the caller": no override at all is
 * the catalog verbatim (every client commit); an override on top of a live
 * catalog row is a staff edit, and the catalog row is kept as provenance; an
 * override with no catalog row left is a booking whose service has since been
 * retired, and there is nothing to compare it to.
 */
function resolveTerms(
  catalog: ServiceTerms | null,
  override: StaffTermsOverride | undefined,
): Result<
  { terms: ServiceTerms; provenance: ServiceTerms | null },
  CommitBookingError
> {
  if (!override) {
    if (!catalog) return fail(new CommitBookingInvalidInputError('terms'));
    return ok({ terms: catalog, provenance: null });
  }

  const currencyCode =
    override.currencyCode ?? catalog?.price.currencyCode() ?? '';
  const minorUnits = override.priceMinorUnits ?? catalog?.price.toMinorUnits();
  const durationMinutes = override.durationMinutes ?? catalog?.durationMinutes;
  if (minorUnits === undefined || durationMinutes === undefined) {
    return fail(new CommitBookingInvalidInputError('terms'));
  }

  const price = Money.fromMinorUnitsAndCode(minorUnits, currencyCode);
  if (price.isFailure()) {
    return fail(new CommitBookingInvalidInputError('priceMinorUnits'));
  }
  const terms = ServiceTerms.create(price.value, durationMinutes, {
    // Padding is chair geometry, not a price, and no command changes it —
    // whichever of the two answers the caller carried forward is the one the
    // busy projection was drawn from.
    setupMinutes: override.setupMinutes ?? catalog?.setupMinutes ?? 0,
    cleanupMinutes: override.cleanupMinutes ?? catalog?.cleanupMinutes ?? 0,
  });
  if (terms.isFailure()) {
    return fail(new CommitBookingInvalidInputError('durationMinutes'));
  }

  return ok({
    terms: terms.value,
    // Equal terms are not an override — a move that changes nothing about the
    // money must not start claiming the catalog was overruled.
    provenance: catalog && !catalog.equals(terms.value) ? catalog : null,
  });
}

/**
 * Is this exact span placeable for this barber?
 *
 * Two questions, and both must be re-asked here rather than inherited from
 * the client's grid: is the barber rostered for it (windows), and is anyone
 * else already in it (busy, padded by that barber's turnaround).
 *
 * ### The staff relaxations are refusals REMOVED, not checks re-run
 * `allowOutsideWindow` drops the roster question entirely — `roster-window.ts`
 * rules that what the windows describe is what a CLIENT may be offered, never
 * a bound on what can exist. `allowOverlap` drops the collision question, and
 * only once the sheet has said so out loud. Neither weakens the other: staff
 * placing an 08:00 regular still cannot silently sit on somebody else's 08:00.
 */
function checkPlacement(input: {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly day: CalendarDay;
  readonly occupied: Interval;
  readonly snapshot: BookingSnapshot;
  readonly startIso: string;
  readonly allowOutsideWindow: boolean;
  readonly allowOverlap: boolean;
}): Result<void, CommitBookingError> {
  const {
    barberId,
    locationId,
    day,
    occupied,
    snapshot,
    startIso,
    allowOutsideWindow,
    allowOverlap,
  } = input;

  const schedule = snapshot.schedules.get(barberId.value);
  if (!schedule && !allowOutsideWindow) {
    return fail(
      new CommitBookingBarberNotRosteredError(barberId.value, day.key()),
    );
  }

  if (schedule && !allowOutsideWindow) {
    // Windows for the whole day, then narrowed to the shop being booked. A
    // barber's day can span two shops, and a Center booking may only use a
    // Center window — their Mladost afternoon is somebody else's capacity.
    const exception = snapshot.exceptions.get(
      busyKey(barberId.value, day.key()),
    );
    const windows = windowsAt(
      buildDayWindows({
        day,
        schedule: schedule.history,
        exceptions: exception ? [exception] : [],
        shopHours: new Map([
          [locationId.value, shopDayHours(day, locationId, snapshot.shopHours)],
        ]),
      }),
      locationId,
    );
    if (windows.length === 0) {
      return fail(
        new CommitBookingBarberNotRosteredError(barberId.value, day.key()),
      );
    }

    const inAWindow = windows.some((window) =>
      Interval.contains(window.interval, occupied),
    );
    if (!inAWindow) {
      // Rostered that day, but not for this span — the client was offered a
      // time that the roster does not actually cover, so it is refused with the
      // recoverable code: re-picking from a fresh grid is the fix.
      return fail(
        new CommitBookingSlotUnavailableError(barberId.value, startIso),
      );
    }
  }

  if (allowOverlap) return ok(undefined);

  // A barber with no roster document has no declared turnaround either, and
  // zero is the honest reading: the reset time is a fact about the chair, and
  // inventing one would block a neighbour that nothing says is blocked.
  //
  // Padded by `paddedBusy`, the rule the grid's read is held to as well
  // (`AvailabilityReader.observeDay`), so the client is offered exactly the
  // gaps this check lets through — a rebuilt visit's own chairs handed back
  // first (`BookingSnapshot.release`), on both sides.
  const taken = paddedBusy({
    barberId,
    spans: snapshot.busy.get(busyKey(barberId.value, day.key())) ?? [],
    turnaroundMinutes: schedule?.turnaroundMinutes ?? 0,
    release: snapshot.release,
  });
  if (taken.some((interval) => Interval.overlaps(interval, occupied))) {
    return fail(
      new CommitBookingSlotUnavailableError(barberId.value, startIso),
    );
  }

  return ok(undefined);
}

/**
 * One key per person on the cart, whatever seats they hold.
 *
 * A guest is keyed by the label as it is STORED — trimmed, the way
 * `SeatLabel` keeps it — so « Иван» and «Иван» are the one person they will
 * be on the appointment, not two people until the write.
 */
function personKey(subject: RequestedSeat['subject']): string {
  switch (subject.kind) {
    case 'self':
      return 'self';
    case 'companion':
      return `account:${subject.userId}`;
    case 'guest':
      return `guest:${subject.label.trim()}`;
  }
}

/**
 * The visit as it stood (`DecideBookingDeps.standing`) → the double
 * seatings it already held, keyed by the same `personKey` every request
 * seat is counted by. The sold span is the seat's service minutes from its
 * start, the span `Seat.soldTime` reads.
 *
 * Exported for the staff edit, which asks it of the visit before AND after
 * its batch to learn which pairs the batch broke (`brokenBy`) — the same
 * people counted the same way as the decision counts them.
 */
export function standingDoubleSeatingsOf(
  standing: readonly StandingSeat[],
): StandingDoubleSeatings {
  if (standing.length === 0) return StandingDoubleSeatings.none();
  return StandingDoubleSeatings.of(
    standing.map((seat) => ({
      seatId: seat.id,
      personKey: personKey(seat.subject),
      slot: Interval.of(
        seat.startMs,
        seat.startMs + seat.durationMinutes * 60_000,
      ),
    })),
  );
}

/**
 * The guests this request tells apart, as the domain's label rule reads
 * them: each seat of a guest the client NAMED (`guestKey`), under the label
 * it will be stored as. Two seats under one label and one key are one guest
 * with two services; a seat with no key is read the way the label alone
 * reads it, and a label that is not one is refused by name later
 * (`toSubject`), so it has nothing to share.
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

function toSubject(
  requested: RequestedSeat,
  ownerUserId: UserId | null,
): Result<SeatSubject, CommitBookingError> {
  if (requested.subject.kind === 'self') {
    // Bound to the TOKEN, so a payload cannot book in someone else's name —
    // and refused outright when there is no token to bind to, because the
    // `self` seat IS the owner's seat.
    if (ownerUserId === null) {
      return fail(new CommitBookingInvalidInputError('ownerUserId'));
    }
    return ok(SeatSubject.account(ownerUserId, 'self'));
  }
  if (requested.subject.kind === 'companion') {
    // Only ever the stored person a staff edit carries forward — see
    // `RequestedSeat.subject`.
    const companion = UserId.create(requested.subject.userId);
    if (companion.isFailure()) {
      return fail(new CommitBookingInvalidInputError('companion'));
    }
    return ok(SeatSubject.account(companion.value, 'companion'));
  }
  const label = SeatLabel.create(requested.subject.label);
  if (label.isFailure()) {
    return fail(new CommitBookingInvalidInputError('guest label'));
  }
  return ok(SeatSubject.anonymous(label.value));
}
