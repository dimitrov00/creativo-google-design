import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  BarberId,
  type LocationDayHours,
  LocationId,
  Service,
  ServiceId,
  ServiceVariantId,
  servicesConflict,
} from '@creativo/domain/catalog';
import {
  Appointment,
  BookingPolicy,
  CalendarDay,
  Interval,
  Seat,
  SeatId,
  SeatLabel,
  SeatSubject,
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
  readonly startIso: string;
  readonly subject:
    | { readonly kind: 'self' }
    | { readonly kind: 'guest'; readonly label: string };
}

export interface DecideBookingRequest {
  readonly locationId: string;
  readonly seats: readonly RequestedSeat[];
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

export interface DecideBookingDeps {
  readonly now: ZonedDateTime;
  readonly policy: BookingPolicy;
  readonly nextId: () => string;
  readonly ownerUserId: string;
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

  const ownerResult = UserId.create(deps.ownerUserId);
  if (ownerResult.isFailure()) {
    return fail(new CommitBookingInvalidInputError('ownerUserId'));
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
  const horizonEnd = horizonEndDay(deps.now, deps.policy.horizonDays);

  /** Per barber+day, the spans THIS booking claims — for the projection write. */
  const busyWrites: BusyWrite[] = [];
  const seats: Seat[] = [];
  /** Services already asked for, per person — the conflict check's input. */
  const servicesByPerson = new Map<string, Service[]>();

  for (const requested of request.seats) {
    const service = servicesById.get(requested.serviceId);
    if (!service) {
      return fail(new CommitBookingUnknownServiceError(requested.serviceId));
    }
    // `servesLocation`, not a hand-rolled `some`: an EMPTY `locationIds` is
    // the catalog's "every location", and reading it as "nowhere" refuses
    // every service the shop never bothered to scope.
    if (!service.servesLocation(locationId)) {
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
      if (!service.variants.some((variant) => variant.id.equals(chosen))) {
        return fail(new CommitBookingInvalidInputError('variantId'));
      }
    } else if (service.variants.length > 0) {
      // The catalog offers a choice that moves the price; committing without
      // one would silently charge `baseTerms`.
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

    if (start.toMillis() < notBeforeMs) {
      return fail(new CommitBookingTooSoonError(deps.policy.minLeadMinutes));
    }

    const day = CalendarDay.fromZonedDateTime(start);
    if (horizonEnd.isBefore(day)) {
      return fail(new CommitBookingBeyondHorizonError(deps.policy.horizonDays));
    }

    // SERVER-RESOLVED terms — the whole point of the round trip.
    const terms = service.termsFor(barberId, variantId);

    const person =
      requested.subject.kind === 'self'
        ? 'self'
        : `guest:${requested.subject.label}`;
    const existing = servicesByPerson.get(person) ?? [];
    for (const other of existing) {
      if (servicesConflict(service, other, snapshot.services)) {
        return fail(
          new CommitBookingConflictingServicesError(
            service.id.value,
            other.id.value,
          ),
        );
      }
    }
    servicesByPerson.set(person, [...existing, service]);

    const subjectResult = toSubject(requested, ownerResult.value);
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
      startsAt: start,
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

  const appointmentResult = Appointment.create({
    id: deps.nextId(),
    locationId: locationId.value,
    seats,
    now: deps.now,
  });
  if (appointmentResult.isFailure()) {
    // This is where a party's own seats colliding on one barber is caught,
    // and where a mixed-currency cart dies.
    return fail(new CommitBookingInvariantError(appointmentResult.error));
  }

  return ok({ appointment: appointmentResult.value, busyWrites });
}

/**
 * Is this exact span placeable for this barber?
 *
 * Two questions, and both must be re-asked here rather than inherited from
 * the client's grid: is the barber rostered for it (windows), and is anyone
 * else already in it (busy, padded by that barber's turnaround).
 */
function checkPlacement(input: {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly day: CalendarDay;
  readonly occupied: Interval;
  readonly snapshot: BookingSnapshot;
  readonly startIso: string;
}): Result<void, CommitBookingError> {
  const { barberId, locationId, day, occupied, snapshot, startIso } = input;

  const schedule = snapshot.schedules.get(barberId.value);
  if (!schedule) {
    return fail(
      new CommitBookingBarberNotRosteredError(barberId.value, day.key()),
    );
  }

  // Windows for the whole day, then narrowed to the shop being booked. A
  // barber's day can span two shops, and a Center booking may only use a
  // Center window — their Mladost afternoon is somebody else's capacity.
  const windows = windowsAt(
    buildDayWindows({
      day,
      schedule: schedule.history,
      exceptions: [],
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

  const taken = (
    snapshot.busy.get(busyKey(barberId.value, day.key())) ?? []
  ).map((interval) =>
    Interval.pad(
      interval,
      schedule.turnaroundMinutes,
      schedule.turnaroundMinutes,
    ),
  );
  if (taken.some((interval) => Interval.overlaps(interval, occupied))) {
    return fail(
      new CommitBookingSlotUnavailableError(barberId.value, startIso),
    );
  }

  return ok(undefined);
}

function toSubject(
  requested: RequestedSeat,
  ownerUserId: UserId,
): Result<SeatSubject, CommitBookingError> {
  if (requested.subject.kind === 'self') {
    // Bound to the TOKEN, so a payload cannot book in someone else's name.
    return ok(SeatSubject.account(ownerUserId, 'self'));
  }
  const label = SeatLabel.create(requested.subject.label);
  if (label.isFailure()) {
    return fail(new CommitBookingInvalidInputError('guest label'));
  }
  return ok(SeatSubject.anonymous(label.value));
}

/** The last bookable day — walked in calendar days, never `+ n × 24h`. */
function horizonEndDay(now: ZonedDateTime, horizonDays: number): CalendarDay {
  let cursor = CalendarDay.fromZonedDateTime(now);
  for (let index = 0; index < horizonDays; index++) {
    cursor = cursor.next();
  }
  return cursor;
}
