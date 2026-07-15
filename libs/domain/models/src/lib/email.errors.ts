import { DomainError } from '@creativo/domain/kernel';

export class InvalidEmailError extends DomainError {
  readonly code = 'invalid_email' as const;
  constructor(public readonly rawValue: string) {
    super(`Invalid email: ${rawValue}`, { rawValue });
  }
}
