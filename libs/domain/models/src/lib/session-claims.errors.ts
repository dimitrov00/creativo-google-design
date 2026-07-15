import { DomainError } from '@creativo/domain/kernel';

export class InvalidClaimsError extends DomainError {
  readonly code = 'invalid_session_claims' as const;
  constructor(public readonly reason: string) {
    super(`Invalid session claims: ${reason}`, { reason });
  }
}
