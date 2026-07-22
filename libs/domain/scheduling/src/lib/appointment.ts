import {
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
  AppointmentEmptyCancellationReasonError,
  AppointmentEmptySeatsError,
  AppointmentInvalidTransitionError,
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
import { AppointmentId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Seat } from './seat';
import { TimeSlot } from './time-slot';

export type AppointmentError =
  | EmptyIdError
  | CatalogEmptyIdError
  | AppointmentEmptySeatsError
  | AppointmentMultipleSelfSeatsError
  | AppointmentPastStartTimeError;

export interface CreateAppointmentProps {
  id: string;
  barberId: string;
  locationId: string;
  timeSlot: TimeSlot;
  seats: Seat[];
  now: ZonedDateTime;
}

export interface ReconstituteAppointmentProps {
  id: string;
  barberId: string;
  locationId: string;
  timeSlot: TimeSlot;
  seats: Seat[];
  status: AppointmentStatus;
}

/**
 * **Aggregate root.** A booked slot with one barber at one location,
 * carrying one or more `Seat`s (a party of N is one `Appointment`, N
 * seats — the appointment is the consistency boundary). `status` is a
 * discriminated union (`AppointmentStatus`), never a status string plus a
 * separate optional `cancellationReason` — see `docs/architecture/domain-model.md`.
 * Every transition method returns a **new** instance and defers to
 * `canTransition` (the single source of truth for the lifecycle graph)
 * rather than re-encoding it.
 */
export class Appointment {
  private constructor(
    readonly id: AppointmentId,
    readonly barberId: BarberId,
    readonly locationId: LocationId,
    readonly timeSlot: TimeSlot,
    readonly seats: readonly Seat[],
    readonly status: AppointmentStatus,
  ) {}

  /** New appointment — starts `pending`; the slot must be in the future. */
  static create(
    props: CreateAppointmentProps,
  ): Result<Appointment, AppointmentError[]> {
    if (!props.timeSlot.start.isAfter(props.now)) {
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
    barberId: string;
    locationId: string;
    timeSlot: TimeSlot;
    seats: Seat[];
    status: AppointmentStatus;
  }): Result<Appointment, AppointmentError[]> {
    const idResult = AppointmentId.create(props.id);
    const barberIdResult = BarberId.create(props.barberId);
    const locationIdResult = LocationId.create(props.locationId);

    const combined = combineAll([
      idResult,
      barberIdResult,
      locationIdResult,
    ] as const);
    const seatErrors = Appointment.validateSeats(props.seats);
    if (combined.isFailure() || seatErrors.length > 0) {
      const errors: AppointmentError[] = combined.isFailure()
        ? [...combined.error]
        : [];
      errors.push(...seatErrors);
      return fail(errors);
    }
    const [id, barberId, locationId] = combined.value;

    return ok(
      new Appointment(
        id,
        barberId,
        locationId,
        props.timeSlot,
        props.seats,
        props.status,
      ),
    );
  }

  private static validateSeats(seats: Seat[]): AppointmentError[] {
    const errors: AppointmentError[] = [];
    if (seats.length === 0) {
      errors.push(new AppointmentEmptySeatsError());
    }
    const selfSeats = seats.filter(
      (s) => s.subject.kind === 'account' && s.subject.relationship === 'self',
    );
    if (selfSeats.length > 1) {
      errors.push(new AppointmentMultipleSelfSeatsError());
    }
    return errors;
  }

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
    return ok(
      new Appointment(
        this.id,
        this.barberId,
        this.locationId,
        this.timeSlot,
        this.seats,
        next,
      ),
    );
  }
}
