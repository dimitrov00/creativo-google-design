import {
  Money,
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  EmptyIdError as CatalogEmptyIdError,
} from '@creativo/domain/catalog';
import {
  AppointmentBarberDoubleBookedError,
  AppointmentEmptyCancellationReasonError,
  AppointmentEmptySeatsError,
  AppointmentInvalidTransitionError,
  AppointmentMixedCurrencyError,
  AppointmentMultipleSelfSeatsError,
  AppointmentPastStartTimeError,
} from './appointment.errors';
import {
  AppointmentStatus,
  AppointmentStatusKind,
  CONFIRMED,
  COMPLETED,
  NO_SHOW,
  PENDING,
  canTransition,
  cancelled,
} from './appointment-status';
import { BookingContact } from './booking-contact';
import { AppointmentId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Seat } from './seat';
import { TimeSlot } from './time-slot';

export type AppointmentError =
  | EmptyIdError
  | CatalogEmptyIdError
  | AppointmentEmptySeatsError
  | AppointmentMultipleSelfSeatsError
  | AppointmentBarberDoubleBookedError
  | AppointmentMixedCurrencyError
  | AppointmentPastStartTimeError;

export interface CreateAppointmentProps {
  id: string;
  locationId: string;
  seats: Seat[];
  now: ZonedDateTime;
  /**
   * Who the shop calls about this booking, and what they should know first.
   * Nullable: appointments written before contacts existed have none, and a
   * staff-entered walk-in may genuinely have nobody to call.
   */
  contact?: BookingContact | null;
}

export interface ReconstituteAppointmentProps {
  id: string;
  locationId: string;
  seats: Seat[];
  status: AppointmentStatus;
  contact?: BookingContact | null;
}

/**
 * **Aggregate root.** A booked visit to one location, carrying one or more
 * `Seat`s (a party of N is one `Appointment`, N seats — the appointment is
 * the consistency boundary). `status` is a discriminated union
 * (`AppointmentStatus`), never a status string plus a separate optional
 * `cancellationReason` — see `docs/architecture/domain-model.md`. Every
 * transition method returns a **new** instance and defers to
 * `canTransition` (the single source of truth for the lifecycle graph)
 * rather than re-encoding it.
 *
 * ### What moved onto the seats, and why
 * The root used to hold ONE `barberId` and ONE `timeSlot` for the whole
 * party. The product needs a party to be served in whichever arrangement
 * the shop can offer (owner ruling 2026-07-29) — different barbers in
 * parallel, or the same barber back to back — so both moved to `Seat`.
 *
 * `locationId` stays on the root: one appointment is one physical visit to
 * one shop. That is a real invariant, not a simplification.
 *
 * `timeSlot` stays as an ACCESSOR, now derived — the envelope from the
 * earliest seat start to the latest seat end. Deriving rather than storing
 * means the party block and the seats can never disagree; persistence may
 * still mirror it as a query field, but the seats remain the truth.
 */
export class Appointment {
  private constructor(
    readonly id: AppointmentId,
    readonly locationId: LocationId,
    readonly seats: readonly Seat[],
    readonly status: AppointmentStatus,
    /**
     * A SNAPSHOT of the contact details this booking was made with — never a
     * pointer to the profile, which is free to change afterwards. See
     * `BookingContact`. Authority still rides on `ownerUserId`; this is who
     * to phone, not who owns anything.
     */
    readonly contact: BookingContact | null = null,
  ) {}

  /** New appointment — starts `pending`; the party must begin in the future. */
  static create(
    props: CreateAppointmentProps,
  ): Result<Appointment, AppointmentError[]> {
    const earliest = Appointment.earliestStart(props.seats);
    if (earliest && !earliest.isAfter(props.now)) {
      return fail([new AppointmentPastStartTimeError()]);
    }
    return Appointment.build({ ...props, status: PENDING });
  }

  /** Rebuild from persistence — same field validation, skips the future-start invariant. */
  static reconstitute(
    props: ReconstituteAppointmentProps,
  ): Result<Appointment, AppointmentError[]> {
    return Appointment.build(props);
  }

  private static build(props: {
    id: string;
    locationId: string;
    seats: Seat[];
    status: AppointmentStatus;
    contact?: BookingContact | null;
  }): Result<Appointment, AppointmentError[]> {
    const idResult = AppointmentId.create(props.id);
    const locationIdResult = LocationId.create(props.locationId);

    const combined = combineAll([idResult, locationIdResult] as const);
    const seatErrors = Appointment.validateSeats(props.seats);
    if (combined.isFailure() || seatErrors.length > 0) {
      const errors: AppointmentError[] = combined.isFailure()
        ? [...combined.error]
        : [];
      errors.push(...seatErrors);
      return fail(errors);
    }
    const [id, locationId] = combined.value;

    return ok(
      new Appointment(
        id,
        locationId,
        props.seats,
        props.status,
        props.contact ?? null,
      ),
    );
  }

  private static validateSeats(seats: Seat[]): AppointmentError[] {
    const errors: AppointmentError[] = [];
    if (seats.length === 0) {
      errors.push(new AppointmentEmptySeatsError());
      // Every remaining rule is about relationships BETWEEN seats, so with
      // none there is nothing further to say.
      return errors;
    }

    const selfSeats = seats.filter(
      (s) => s.subject.kind === 'account' && s.subject.relationship === 'self',
    );
    if (selfSeats.length > 1) {
      errors.push(new AppointmentMultipleSelfSeatsError());
    }

    // One barber cannot be in two chairs at once. Reported once per barber,
    // however many pairs collide — the booker needs to know WHO, not how
    // many ways the schedule is impossible.
    const doubleBooked = new Set<string>();
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const a = seats[i] as Seat;
        const b = seats[j] as Seat;
        if (a.collidesWith(b)) doubleBooked.add(a.barberId.value);
      }
    }
    for (const barberId of doubleBooked) {
      errors.push(new AppointmentBarberDoubleBookedError(barberId));
    }

    const expected = (seats[0] as Seat).terms.price.currencyCode();
    for (const seat of seats) {
      const found = seat.terms.price.currencyCode();
      if (found !== expected) {
        errors.push(new AppointmentMixedCurrencyError(expected, found));
        break;
      }
    }

    return errors;
  }

  // ── Derived party facts ───────────────────────────────────────────────

  /**
   * The party block: earliest seat start to latest seat end. For a parallel
   * arrangement this is the longest seat; for a sequential one it spans the
   * whole chain. Derived, never stored — see the class doc.
   */
  get timeSlot(): TimeSlot {
    const starts = this.seats.map((seat) => seat.slot.start);
    const ends = this.seats.map((seat) => seat.slot.end);
    const start = starts.reduce((a, b) => (b.isBefore(a) ? b : a));
    const end = ends.reduce((a, b) => (a.isBefore(b) ? b : a));
    const result = TimeSlot.create({
      startIso: start.toISO(),
      endIso: end.toISO(),
      zone: start.zoneName,
    });
    // Unreachable: `seats` is non-empty by invariant and every seat's own
    // slot already satisfies start < end, so the envelope does too.
    if (result.isFailure()) throw new Error('unreachable: invalid envelope');
    return result.value;
  }

  /** Who is working this appointment, deduped, in seat order. */
  barberIds(): readonly BarberId[] {
    const seen = new Set<string>();
    const ids: BarberId[] = [];
    for (const seat of this.seats) {
      if (seen.has(seat.barberId.value)) continue;
      seen.add(seat.barberId.value);
      ids.push(seat.barberId);
    }
    return ids;
  }

  /** The longest single seat — NOT the envelope, which a sequential party stretches. */
  longestSeatMinutes(): number {
    return Math.max(...this.seats.map((seat) => seat.durationMinutes()));
  }

  /**
   * What the party owes before discounts, folded from the seats' own
   * snapshots. Total rather than a `Result`: one shared currency is an
   * invariant enforced at build, so there is no failure left to report.
   */
  subtotal(): Money {
    return this.seats
      .map((seat) => seat.terms.price)
      .reduce((total, price) => {
        const sum = total.add(price);
        // Unreachable: `validateSeats` rejects a mixed-currency appointment
        // at build, so `add` cannot mismatch here.
        if (sum.isFailure()) throw new Error('unreachable: mixed currency');
        return sum.value;
      });
  }

  private static earliestStart(seats: readonly Seat[]): ZonedDateTime | null {
    if (seats.length === 0) return null;
    return seats
      .map((seat) => seat.slot.start)
      .reduce((a, b) => (b.isBefore(a) ? b : a));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  confirm(): Result<Appointment, AppointmentInvalidTransitionError> {
    return this.transition('confirmed', CONFIRMED);
  }

  complete(): Result<Appointment, AppointmentInvalidTransitionError> {
    return this.transition('completed', COMPLETED);
  }

  markNoShow(): Result<Appointment, AppointmentInvalidTransitionError> {
    return this.transition('no_show', NO_SHOW);
  }

  cancel(
    reason: string,
  ): Result<
    Appointment,
    AppointmentInvalidTransitionError | AppointmentEmptyCancellationReasonError
  > {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      return fail(new AppointmentEmptyCancellationReasonError());
    }
    return this.transition('cancelled', cancelled(trimmed));
  }

  private transition(
    to: AppointmentStatusKind,
    next: AppointmentStatus,
  ): Result<Appointment, AppointmentInvalidTransitionError> {
    if (!canTransition(this.status, to)) {
      return fail(new AppointmentInvalidTransitionError(this.status.kind, to));
    }
    return ok(new Appointment(this.id, this.locationId, this.seats, next));
  }
}
