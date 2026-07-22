import { DomainError } from '@creativo/domain/kernel';

export class LastNameTooShortError extends DomainError {
  override readonly code = 'accounts.last_name.too_short' as const;
  constructor(
    public readonly attempted: string,
    public readonly minLength: number,
  ) {
    super(
      `Last name must be at least ${minLength} characters: "${attempted}"`,
      { attempted, minLength },
    );
  }
}
