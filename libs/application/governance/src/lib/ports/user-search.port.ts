import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { Email, UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export interface UserSearchResult {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email: Email | null;
}

export interface UserSearchPort {
  /** `query` is genuinely free text an admin typed — not a domain concept, so it stays a plain string. Results carry real branded ids/VOs. */
  search(
    query: string,
  ): Promise<Result<readonly UserSearchResult[], RepositoryError>>;
}

export const USER_SEARCH_PORT = new InjectionToken<UserSearchPort>(
  'UserSearchPort',
);
