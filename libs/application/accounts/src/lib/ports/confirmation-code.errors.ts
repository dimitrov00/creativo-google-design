import { DomainError } from '@creativo/domain/kernel';

export class InvalidConfirmationCodeError extends DomainError {
  readonly code = 'accounts.confirmation_code.invalid' as const;
  constructor() {
    super('Confirmation code must be a 6-digit string');
  }
}
