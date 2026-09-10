import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { Email, UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export interface UserSearchResult {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email: Email | null;
  /** E.164, when the profile has one — the number a booking's contact needs. */
  readonly phone: string | null;
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

/**
 * What the desk typed, in the form the index holds it (owner, 2026-09-09:
 * search by name, number or mail). A number arrives with spaces, dashes,
 * a plus or a `00` prefix — the index holds digits only, so a query that
 * is a number becomes its digits. Anything else is lowercased text.
 */
export function normalizeSearchQuery(rawQuery: string): string {
  const trimmed = rawQuery.trim();
  if (/^[+\d][\d\s().-]*$/.test(trimmed)) {
    return trimmed.replace(/\D/g, '').replace(/^00/, '');
  }
  return trimmed.toLowerCase();
}

/** A query that is a phone number, by shape. */
export function looksLikePhone(rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  return (
    /^[+\d][\d\s().-]*$/.test(trimmed) && trimmed.replace(/\D/g, '').length >= 5
  );
}
