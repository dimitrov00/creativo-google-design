import type {
  AccountLifecycle,
  BirthDate,
  Email,
  E164,
  RegistrationState,
  Role,
  SearchFields,
} from '@core/components';
import type { UserId } from '@core/primitives';

/**
 * The identity slice of `users/{uid}` — the ACCOUNT (D29): the id (the
 * Firebase Auth uid), where registration stands, the sign-in contact and
 * names, and the roles. Every field at the root, `null` where a provisioned
 * stub has nothing yet (`phone`/`email` hold only the login channel; names
 * and birth date `null`; roles `[]`). `phone` is a plain E.164 string (the
 * `findByDestination` query key) and `birthDate` a plain `'YYYY-MM-DD'`
 * (the rules' regex). No `createdAtUtcMs`: no writer stores one. No link
 * to a customer — the link lives on the `Customer` (D29).
 */
export type UserMeta = {
  readonly id: UserId;
  readonly registrationState: RegistrationState;
  readonly phone: E164 | null;
  /** `null` only while provisioned. */
  readonly firstName: string | null;
  /** `null` only while provisioned. */
  readonly lastName: string | null;
  /** `[]` while provisioned. */
  readonly roles: readonly Role[];
  readonly email: Email | null;
  readonly birthDate: BirthDate | null;
};

/**
 * The archetype of `users/{uid}` — **flat** (Law 6): the identity slice, the
 * account lifecycle (`accountStatus`, and a block's `blockReason` /
 * `blockedUntilUtcMs`, at the root) and the clientele search keys. One type
 * for both stored states: the `PROVISIONED` stub (`verifyOtp`'s first
 * sign-in) is written with EVERY key present and the `REGISTERED` body
 * `completeRegistration` writes over it. The document body is this type
 * minus `id`; until the identity flip the stored bytes are today's (the
 * shims convert).
 */
export type User = UserMeta & AccountLifecycle & SearchFields;

/**
 * The profile helpers a user's names need — a companion, not a nested
 * component (blueprint §2.4): names stay flat on `User`.
 */
export const Profile = {
  /**
   * First and last name, space-joined and trimmed (`User.fullName`); a
   * provisioned stub with no names reads as `''`.
   */
  fullName(user: Pick<User, 'firstName' | 'lastName'>): string {
    return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  },
} as const;
