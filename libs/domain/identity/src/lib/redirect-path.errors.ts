import { DomainError } from '@creativo/domain/kernel';

export class RedirectPathUnsafeError extends DomainError {
  readonly code = 'identity.redirect_path.unsafe' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a safe in-app redirect path`, { attempted });
  }
}
