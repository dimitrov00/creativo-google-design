import { DomainError } from '@creativo/domain/kernel';

export class BirthDateInvalidError extends DomainError {
  readonly code = 'identity.birth_date.invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a real calendar date`, { attempted });
  }
}

export class BirthDateInFutureError extends DomainError {
  readonly code = 'identity.birth_date.in_future' as const;
  constructor(public readonly attempted: string) {
    super(`Birth date "${attempted}" is in the future`, { attempted });
  }
}

export class BirthDateTooYoungError extends DomainError {
  readonly code = 'identity.birth_date.too_young' as const;
  constructor(
    public readonly age: number,
    public readonly minAge: number,
  ) {
    super(`Age ${age} is below the minimum of ${minAge}`, { age, minAge });
  }
}

export class BirthDateTooOldError extends DomainError {
  readonly code = 'identity.birth_date.too_old' as const;
  constructor(
    public readonly age: number,
    public readonly maxAge: number,
  ) {
    super(`Age ${age} exceeds the maximum of ${maxAge}`, { age, maxAge });
  }
}

export type BirthDateError =
  | BirthDateInvalidError
  | BirthDateInFutureError
  | BirthDateTooYoungError
  | BirthDateTooOldError;
