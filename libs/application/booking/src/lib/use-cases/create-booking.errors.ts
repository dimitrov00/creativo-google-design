import { DomainError, InvalidTimeZoneError } from '@creativo/domain/kernel';
import { AppointmentError, EmptyIdError } from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';

export class CreateBookingValidationFailure extends DomainError {
  readonly code = 'booking.create_booking.validation_failed' as const;
  constructor(
    public readonly errors: readonly (AppointmentError | EmptyIdError)[],
  ) {
    super('Booking validation failed');
  }
}

export class CreateBookingRepositoryFailure extends DomainError {
  readonly code = 'booking.create_booking.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the new appointment');
  }
}

export type CreateBookingError =
  | CreateBookingValidationFailure
  | CreateBookingRepositoryFailure
  | InvalidTimeZoneError;
