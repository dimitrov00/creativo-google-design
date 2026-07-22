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
