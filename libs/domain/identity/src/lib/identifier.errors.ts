import { DomainError } from '@creativo/domain/kernel';

export class IdentifierInvalidError extends DomainError {
  readonly code = 'identity.identifier.invalid' as const;
  constructor(
    public readonly kind: 'phone' | 'email',
    public readonly attempted: string,
  ) {
    super(`"${attempted}" is not a valid ${kind} identifier`, {
      kind,
      attempted,
    });
  }
}
