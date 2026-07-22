import { DomainError } from './domain-error';

export class PhoneNumberInvalidError extends DomainError {
  readonly code = 'phone_number_invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a valid phone number`, { attempted });
  }
}
