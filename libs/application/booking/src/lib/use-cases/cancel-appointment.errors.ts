import { DomainError } from '@creativo/domain/kernel';
import {
  AppointmentEmptyCancellationReasonError,
  AppointmentInvalidTransitionError,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';

export class AppointmentNotFoundError extends DomainError {
  readonly code = 'booking.cancel_appointment.not_found' as const;
  constructor() {
    super('No such appointment.');
  }
}

export class CancelAppointmentRepositoryFailure extends DomainError {
  readonly code = 'booking.cancel_appointment.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export type CancelAppointmentError =
  | AppointmentNotFoundError
  | AppointmentInvalidTransitionError
  | AppointmentEmptyCancellationReasonError
  | CancelAppointmentRepositoryFailure;
