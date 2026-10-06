import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { User, UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The signed-in person's own `users/{uid}` profile.
 *
 * `null` means "no registered profile yet": the document is absent, or it is
 * still the contact-only stub `verifyOtp` provisions before registration
 * fills in the names.
 */
export interface ProfilePort {
  getProfile(userId: UserId): Promise<Result<User | null, RepositoryError>>;
  /**
   * Live. Server-side writes (a pause's `status`, a staff correction of the
   * names) arrive without a re-fetch, so nothing has to remember to refresh.
   */
  observeProfile(
    userId: UserId,
  ): Observable<Result<User | null, RepositoryError>>;
  /**
   * Saves the fields the owner may edit: the names and the birth date (plus
   * the search index derived from them). `roles`, `status`, `phone` and
   * `email` on the passed `User` are ignored: roles and status are written
   * server-side only, and phone and e-mail change only through the OTP
   * contact-change flow (`CONTACT_CHANGE_PORT`). Updates an existing
   * profile; creating one is registration's job, so a missing profile fails.
   */
  saveProfile(user: User): Promise<Result<void, RepositoryError>>;
}

export const PROFILE_PORT = new InjectionToken<ProfilePort>('ProfilePort');
