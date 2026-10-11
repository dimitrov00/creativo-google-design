import type { Observable } from 'rxjs';
import type { RepositoryError, Result, UserId } from '@core/primitives';
import type { Role } from '@core/components';
import type { User } from '@core/entities';

/**
 * The accounts context's ports (blueprint §4.1, §4.2) over `users/{uid}` —
 * the flat `User` straight from `snap.data()` (§9 D19), no mapper and
 * no search-result view model. Profile WRITES are the `updateProfile`
 * callable (SearchFieldsSystem derives `searchName`/`searchPrefixes` inside
 * its transaction), never a port here. No contact-change ports: §9 D12(b),
 * contact change is not shipped.
 */

/**
 * The staff client search — `searchPrefixes array-contains prefix`,
 * `orderBy searchName`, at most `limit` (index #8,
 * `user-search.adapter.ts:62-63`). `prefix` is already normalised by
 * SearchFieldsSystem (lower-cased name token, or phone digits).
 */
export type SearchUsers = (
  prefix: string,
  limit: number,
) => Promise<Result<readonly User[], RepositoryError>>;

/** `users/{uid}`, live — `null` before the account's first sign-in writes the stub. */
export type ObserveProfile = (
  userId: UserId,
) => Observable<Result<User | null, RepositoryError>>;

/**
 * The STORED roles of `users/{uid}` — the server's second check behind a
 * token claim (`run-backfill.ts:715-728` re-reads them for `sysadmin`), and
 * the `loadCallerRoles` read of `transitionAppointment`, `updateProfile`
 * and the impersonation pipelines (§4.1). `[]` for an unknown uid.
 */
export type LoadCallerRoles = (
  userId: UserId,
) => Promise<Result<readonly Role[], RepositoryError>>;

/** The accounts context's port catalogue; each root binds the `Pick` it implements. */
export type AccountsPorts = {
  readonly searchUsers: SearchUsers;
  readonly observeProfile: ObserveProfile;
  readonly loadCallerRoles: LoadCallerRoles;
};
