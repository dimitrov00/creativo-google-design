import { DomainError, PhoneNumberInvalidError } from '@creativo/domain/kernel';

export class BlankVenuePhoneDisplayError extends DomainError {
  readonly code = 'catalog.venue_phone.blank_display' as const;
  constructor() {
    super('Venue phone display text cannot be blank');
  }
}

export type VenuePhoneValidationError =
  PhoneNumberInvalidError | BlankVenuePhoneDisplayError;
