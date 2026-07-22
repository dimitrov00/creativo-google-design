import { DomainError } from '@creativo/domain/kernel';

export class InvalidLocaleError extends DomainError {
  override readonly code = 'governance.locale.invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a supported locale`, { attempted });
  }
}
