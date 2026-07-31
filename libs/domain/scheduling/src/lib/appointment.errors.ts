import { DomainError } from '@creativo/domain/kernel';

export class AppointmentEmptySeatsError extends DomainError {
  override readonly code = 'scheduling.appointment.empty_seats' as const;
  constructor() {
    super('An appointment must have at least one seat');
  }
}

export class AppointmentMultipleSelfSeatsError extends DomainError {
  override readonly code =
    'scheduling.appointment.multiple_self_seats' as const;
  constructor() {
    super('An appointment may have at most one "self" seat');
  }
}

export class AppointmentPastStartTimeError extends DomainError {
  override readonly code = 'scheduling.appointment.past_start_time' as const;
  constructor() {
    super('A new appointment cannot be scheduled to start in the past');
  }
}

/**
 * Two seats want the same barber at overlapping times — physically
 * impossible, and the ONE invariant that per-seat barbers make necessary.
 *
 * Note what it deliberately permits: the same barber on two seats that do
 * NOT overlap. "Father and son, same barber, back to back" is a real
 * booking the shop wants to take, so the rule is about collision, not about
 * repetition (owner ruling 2026-07-29).
 */
export class AppointmentBarberDoubleBookedError extends DomainError {
  override readonly code =
    'scheduling.appointment.barber_double_booked' as const;
  constructor(public readonly barberId: string) {
    super(
      `Barber "${barberId}" is booked for two overlapping seats in this appointment`,
      { barberId },
    );
  }
}

/** Seats priced in two currencies — a data error, never a feature. */
export class AppointmentMixedCurrencyError extends DomainError {
  override readonly code = 'scheduling.appointment.mixed_currency' as const;
  constructor(
    public readonly expected: string,
    public readonly found: string,
  ) {
    super(
      `An appointment's seats must share one currency: expected ${expected}, found ${found}`,
      { expected, found },
    );
  }
}

export class AppointmentInvalidTransitionError extends DomainError {
  override readonly code = 'scheduling.appointment.invalid_transition' as const;
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot transition an appointment from "${from}" to "${to}"`, {
      from,
      to,
    });
  }
}

export class AppointmentEmptyCancellationReasonError extends DomainError {
  override readonly code =
    'scheduling.appointment.empty_cancellation_reason' as const;
  constructor() {
    super('A cancellation reason cannot be empty');
  }
}
