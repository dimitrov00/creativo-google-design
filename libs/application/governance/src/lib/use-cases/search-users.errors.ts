import { DomainError } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

export class SearchQueryTooShortError extends DomainError {
  readonly code = 'governance.search_users.query_too_short' as const;
  constructor(public readonly minLength: number) {
    super(`Search query must be at least ${minLength} characters`, {
      minLength,
    });
  }
}

export class SearchUsersRepositoryFailure extends DomainError {
  readonly code = 'governance.search_users.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('User search failed');
  }
}

export type SearchUsersError =
  SearchQueryTooShortError | SearchUsersRepositoryFailure;
