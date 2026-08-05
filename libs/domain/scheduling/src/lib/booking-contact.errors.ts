import { DomainError } from '@creativo/domain/kernel';

/** The name the shop will call out. Empty is not a person. */
export class BookingContactEmptyNameError extends DomainError {
  readonly code = 'booking.contact.empty_name';

  constructor() {
    super('A name is required for the booking.');
  }
}

/** The phone did not parse — the shop's only reliable way to reach someone. */
export class BookingContactInvalidPhoneError extends DomainError {
  readonly code = 'booking.contact.invalid_phone';

  constructor(readonly rawValue: string) {
    super(`"${rawValue}" is not a valid phone number.`, { rawValue });
  }
}

/** The address did not parse. Optional overall, but not optionally valid. */
export class BookingContactInvalidEmailError extends DomainError {
  readonly code = 'booking.contact.invalid_email';

  constructor(readonly rawValue: string) {
    super(`"${rawValue}" is not a valid email address.`, { rawValue });
  }
}

/**
 * The note the shop reads before the chair. Bounded because it is displayed
 * in a row on a staff screen and stored on every appointment — a field with
 * no ceiling is a field somebody pastes a novel into.
 */
export class BookingContactNoteTooLongError extends DomainError {
  readonly code = 'booking.contact.note_too_long';

  constructor(readonly maxLength: number) {
    super(`A note can be at most ${maxLength} characters.`, {
      maxLength: String(maxLength),
    });
  }
}

export type BookingContactError =
  | BookingContactEmptyNameError
  | BookingContactInvalidPhoneError
  | BookingContactInvalidEmailError
  | BookingContactNoteTooLongError;
