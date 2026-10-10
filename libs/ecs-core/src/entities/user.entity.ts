import type { AccountStatus } from '../components/account-status.data';
import type { BirthDate } from '../components/birth-date.data';
import type { Email } from '../components/email.data';
import type { E164 } from '../components/phone-number.data';
import type { Registration } from '../components/registration.data';
import type { Role } from '../components/role.data';

/**
 * A user account's id — the Firebase Auth uid, which is also the
 * `users/{uid}` document id. The ONE `UserId` brand of the codebase
 * (blueprint §2.4, §9 D8: ecs-core is the identity brand home).
 */
export type UserId = string & { readonly __brand: unique symbol };

export const UserId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): UserId => raw as UserId,
} as const;

/**
 * The archetype of `users/{uid}` — **flat**, the stored keys of
 * `firestore-user-repository.ts:89-99` / `profile.adapter.ts:112-139` (§9
 * D19: zero rules, index or seed churn). The document body is this type
 * minus `id`.
 *
 * One type for both stored states: the `provisioned` stub (`verifyOtp`'s
 * first sign-in) is written with EVERY key present — names `null`, `roles`
 * and `searchPrefixes` empty, `accountStatus` active — and the `registered`
 * body `completeRegistration` writes over it. Declared changes (§3.1): the
 * new `registration` tag, and `status` → `accountStatus` with `untilMs`.
 * `phone` is a plain E.164 string (the `findByDestination` query key) and
 * `birthDate` a plain `'YYYY-MM-DD'` (the rules' regex). No `createdAtMs`:
 * no writer stores one.
 */
export type UserEntity = {
  readonly id: UserId;
  readonly registration: Registration;
  readonly phone: E164 | null;
  /** `null` only while provisioned. */
  readonly firstName: string | null;
  /** `null` only while provisioned. */
  readonly lastName: string | null;
  /** `[]` while provisioned. */
  readonly roles: readonly Role[];
  /** `active` while provisioned. */
  readonly accountStatus: AccountStatus;
  readonly email: Email | null;
  readonly birthDate: BirthDate | null;
  /** The lower-cased full name the clientele list orders by. */
  readonly searchName: string | null;
  /** Every searchable prefix (name tokens, phone digits, e-mail) — `[]` while provisioned. */
  readonly searchPrefixes: readonly string[];
};

/**
 * The profile helpers a user's names need — a companion, not a nested
 * component (blueprint §2.4): names stay flat on `UserEntity`.
 */
export const Profile = {
  /**
   * First and last name, space-joined and trimmed (`User.fullName`); a
   * provisioned stub with no names reads as `''`.
   */
  fullName(user: Pick<UserEntity, 'firstName' | 'lastName'>): string {
    return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  },
} as const;
