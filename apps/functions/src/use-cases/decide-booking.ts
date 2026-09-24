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
  ServiceVariantId,
  servicesConflict,
} from '@creativo/domain/catalog';
import {
  Appointment,
  BarberPref,
  BookingContact,
  type BookingContactProps,
  BookingPolicy,
  CalendarDay,
  Interval,
  PENDING,
  Seat,
  SeatId,
  SeatLabel,
  SeatSubject,
  ScheduleException,
  StaffScheduleHistory,
  buildDayWindows,
  shopDayHours,
  windowsAt,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import {
  CommitBookingBarberNotRosteredError,
  CommitBookingBeyondHorizonError,
  CommitBookingConflictingServicesError,
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingInvariantError,
  CommitBookingPartyTooLargeError,
  CommitBookingServiceNotAtLocationError,
  CommitBookingSlotUnavailableError,
  CommitBookingTooSoonError,
  CommitBookingUnknownServiceError,
} from './commit-booking.errors';

/** One seat as the client asked for it — see `CommitBookingSeatRequest`. */
export interface RequestedSeat {
  readonly lineId: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  /**
   * What the client ASKED for, beside the barber they were given. Absent
   * reads as `specific` — the conservative default, because it means staff
   * phone before moving the booking rather than moving it silently.
   */
  readonly barberPref?: 'any' | 'specific';
  readonly startIso: string;
  readonly subject:
    | { readonly kind: 'self' }
    | { readonly kind: 'guest'; readonly label: string };
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
 * trip exists to prevent. `deps` is assembled server-side by a use case that
 * has already checked the caller works the book, so a privilege that lives
 * here cannot be reached from the wire at all.
 */
export interface StaffTermsOverride {
  readonly priceMinorUnits?: number;
  readonly currencyCode?: string;
  readonly durationMinutes?: number;
  readonly setupMinutes?: number;
  readonly cleanupMinutes?: number;
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
 * - **Collisions** are checked against the busy set read in this transaction,
 *   which is what makes two people racing for 14:00 resolve to one winner.
 */
export function decideBooking(
  request: DecideBookingRequest,
  snapshot: BookingSnapshot,
  deps: DecideBookingDeps,
): Result<BookingDecision, CommitBookingError> {
  if (request.seats.length === 0) {
    return fail(new CommitBookingInvalidInputError('seats'));
  }

  const locationIdResult = LocationId.create(request.locationId);
  if (locationIdResult.isFailure()) {
    return fail(new CommitBookingInvalidInputError('locationId'));
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

  // A "person" is a subject: the booker plus each distinctly-labelled guest.
  // Counted from the request rather than trusted from a field, because the
  // cap is a rule and the client is not where rules live.
  const partyLabels = new Set<string>();
  for (const seat of request.seats) {
    partyLabels.add(
      seat.subject.kind === 'self' ? 'self' : `guest:${seat.subject.label}`,
    );
  }
  if (partyLabels.size > deps.policy.maxPartySize) {
    return fail(new CommitBookingPartyTooLargeError(deps.policy.maxPartySize));
  }

  const servicesById = new Map(
    snapshot.services.map((service) => [service.id.value, service]),
  );

  const notBeforeMs = deps.now.toMillis() + deps.policy.minLeadMinutes * 60_000;
  const horizonEnd = deps.policy.horizonEndFrom(
    CalendarDay.fromZonedDateTime(deps.now),
  );

  /** Per barber+day, the spans THIS booking claims — for the projection write. */
  const busyWrites: BusyWrite[] = [];
  const seats: Seat[] = [];
  /** Services already asked for, per person — the conflict check's input. */
  const servicesByPerson = new Map<string, Service[]>();

  for (const requested of request.seats) {
    const override = deps.termsOverrides?.get(requested.lineId);
    const service = servicesById.get(requested.serviceId) ?? null;
    if (!service) {
      // A seat whose terms staff already fixed survives its service leaving
      // the catalogue: the appointment EXISTS, its terms are a snapshot taken
      // at commit, and the shop must still be able to move a booking for a
      // service it retired last month. Without this a deactivated seasonal
      // service freezes every booking of it forever — the exact frozen book
      // this write path exists to unfreeze. Everything the catalogue row
      // would have decided (location, variant, conflicts) is skipped with
      // it, because there is no row left to decide from.
      if (!override) {
        return fail(new CommitBookingUnknownServiceError(requested.serviceId));
      }
    } else if (!service.servesLocation(locationId)) {
      // `servesLocation`, not a hand-rolled `some`: an EMPTY `locationIds` is
      // the catalog's "every location", and reading it as "nowhere" refuses
      // every service the shop never bothered to scope.
      return fail(
        new CommitBookingServiceNotAtLocationError(
          requested.serviceId,
          locationId.value,
        ),
      );
    }

    const barberIdResult = BarberId.create(requested.barberId);
    const serviceIdResult = ServiceId.create(requested.serviceId);
    if (barberIdResult.isFailure() || serviceIdResult.isFailure()) {
      return fail(new CommitBookingInvalidInputError('seat identifiers'));
    }
    const barberId = barberIdResult.value;

    let variantId: ServiceVariantId | null = null;
    if (requested.variantId !== null) {
      const variantIdResult = ServiceVariantId.create(requested.variantId);
      if (variantIdResult.isFailure()) {
        return fail(new CommitBookingInvalidInputError('variantId'));
      }
      const chosen = variantIdResult.value;
      variantId = chosen;
      // A variant the service does not declare is unreachable through the UI,
      // so it is either a stale tab or a forged payload. Either way the terms
      // it would resolve to are not the ones the user saw.
      if (
        service &&
        !service.variants.some((variant) => variant.id.equals(chosen))
      ) {
        return fail(new CommitBookingInvalidInputError('variantId'));
      }
    } else if (service && service.variants.length > 0 && !override) {
      // The catalog offers a choice that moves the price; committing without
      // one would silently charge `baseTerms`.
      //
      // ⚠ An OVERRIDE is the exception, and it is the same argument the
      // retired-service branch above already makes. A staff edit carries the
      // seat's terms forward wholesale, so `resolveTerms` never consults the
      // catalog and there is no `baseTerms` to charge by accident. Refusing
      // here froze appointments that already exist: every seat booked before
      // its service gained a variant is legitimately `variantId: null`, and
      // this branch made every one of them permanently un-draggable — the
      // exact frozen book `staffEditAppointment` exists to unfreeze.
      //
      // Safe because `termsOverrides` lives on `deps`, not on the request:
      // the staff use case is its only producer, so no browser payload can
      // reach this and a client commit still cannot skip its variant.
      return fail(new CommitBookingInvalidInputError('variantId'));
    }

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

    if (service) {
      const person =
        requested.subject.kind === 'self'
          ? 'self'
          : `guest:${requested.subject.label}`;
      const existing = servicesByPerson.get(person) ?? [];
      for (const other of existing) {
        if (
          !deps.allowConflictingServices &&
          servicesConflict(service, other, snapshot.services)
        ) {
          return fail(
            new CommitBookingConflictingServicesError(
              service.id.value,
              other.id.value,
            ),
          );
        }
      }
      servicesByPerson.set(person, [...existing, service]);
    }

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
          : BarberPref.specific(barberId),
    });
    seats.push(seat);

    // The chair is held for setup + service + cleanup; the client is sold the
    // service alone. Availability is checked against the former.
    const occupied = Interval.of(
      start.toMillis() - terms.setupMinutes * 60_000,
      seat.endsAt().toMillis() + terms.cleanupMinutes * 60_000,
    );

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
  const turnaround = schedule?.turnaroundMinutes ?? 0;
  const taken = (
    snapshot.busy.get(busyKey(barberId.value, day.key())) ?? []
  ).map((interval) => Interval.pad(interval, turnaround, turnaround));
  if (taken.some((interval) => Interval.overlaps(interval, occupied))) {
    return fail(
      new CommitBookingSlotUnavailableError(barberId.value, startIso),
    );
  }

  return ok(undefined);
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
  const label = SeatLabel.create(requested.subject.label);
  if (label.isFailure()) {
    return fail(new CommitBookingInvalidInputError('guest label'));
  }
  return ok(SeatSubject.anonymous(label.value));
}
