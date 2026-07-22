import { DomainError } from '@creativo/domain/kernel';

export class FirstNameTooShortError extends DomainError {
  override readonly code = 'accounts.first_name.too_short' as const;
  constructor(
    public readonly attempted: string,
    public readonly minLength: number,
  ) {
    super(
      `First name must be at least ${minLength} characters: "${attempted}"`,
      { attempted, minLength },
    );
  }
}
