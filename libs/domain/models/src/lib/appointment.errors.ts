import { DomainError, InvalidDateTimeError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

export class InvalidAppointmentTimeRangeError extends DomainError {
  readonly code = 'invalid_appointment_time_range' as const;
  constructor() {
    super('Appointment end must be after start');
  }
}

export class AppointmentNotInFutureError extends DomainError {
  readonly code = 'appointment_not_in_future' as const;
  constructor() {
    super('New appointments must start in the future');
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = 'invalid_appointment_transition' as const;
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot transition appointment from "${from}" to "${to}"`, {
      from,
      to,
    });
  }
}

export type ScheduleAppointmentError =
  | EmptyIdError
  | InvalidDateTimeError
  | InvalidAppointmentTimeRangeError
  | AppointmentNotInFutureError;
