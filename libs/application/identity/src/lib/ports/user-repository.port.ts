import { Result } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/models';
import type { User } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { OtpDestination } from './otp-destination';

/**
 * The contact-channel stub `verifyOtpChallenge` provisions the moment a
 * brand-new destination verifies — nothing but the Auth uid and the login
 * channel exists yet (names/roles/status arrive with
 * `completeRegistration`, which writes the real `domain/accounts` `User`).
 */
export interface ProvisionedUser {
  readonly id: UserId;
  readonly email: string | null;
  readonly phone: string | null;
}

/**
 * What a destination lookup reads back off `users/{uid}` — deliberately
 * NOT a reconstituted `domain/accounts` `User`: the OTP flows only ever
 * need the uid (session binding), the contact channels (merge on
 * re-registration), the stored birthday (preserved across an idempotent
 * `completeRegistration` re-run) and whether registration has completed
 * (claims keying). Keeping the read model this thin means a login never
 * fails on profile-field re-validation.
 */
export interface UserRecordSnapshot extends ProvisionedUser {
  /** Stored ISO `YYYY-MM-DD` birthday, if the registered profile has one. */
  readonly birthDate: string | null;
  /**
   * Whether `completeRegistration` has written the full accounts-shape
   * profile — the activation key `verifyOtpChallenge` mints claims off
   * (`active` vs `onboarding`).
   */
  readonly registered: boolean;
}

/**
 * Backend-only, `apps/functions`-consumed repository over `users/{uid}` —
 * lives in `identity` (not `accounts`, despite the name) so functions and
 * web share one contract source. The write side speaks the REAL
 * `domain/accounts` `User`: since the greenfield schema unification the
 * server persists exactly the shape the web's `FirestoreProfileAdapter`
 * (`libs/infrastructure/firestore`) reconstitutes — there is no separate
 * server-side user shape anymore.
 */
export interface UserRepositoryPort {
  /** First-time signup: writes the pre-registration contact-channel stub. */
  provision(user: ProvisionedUser): Promise<Result<void, RepositoryError>>;

  findByDestination(
    destination: OtpDestination,
  ): Promise<Result<UserRecordSnapshot | null, RepositoryError>>;

  /**
   * `completeRegistration`'s activation write — replaces the stub with the
   * full accounts-domain profile document.
   */
  saveRegistered(user: User): Promise<Result<void, RepositoryError>>;
}
