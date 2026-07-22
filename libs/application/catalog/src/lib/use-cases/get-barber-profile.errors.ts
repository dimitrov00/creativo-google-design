import { DomainError } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

export class BarberNotFoundError extends DomainError {
  readonly code = 'catalog.get_barber_profile.not_found' as const;
  constructor() {
    super('No such barber.');
  }
}

export class GetBarberProfileRepositoryFailure extends DomainError {
  readonly code = 'catalog.get_barber_profile.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to load the barber profile');
  }
}

export type GetBarberProfileError =
  BarberNotFoundError | GetBarberProfileRepositoryFailure;
