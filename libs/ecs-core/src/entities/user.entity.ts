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
 * `findUserByDestination` query key) and `birthDate` a plain `'YYYY-MM-DD'`
 * (the rules' regex). No `createdAtUtcMs`: no writer stores one. No link
 * to a customer — the link lives on the `Customer` (D29).
 */
export type UserMeta = {
  readonly id: UserId;
  readonly registrationState: RegistrationState;
  /** `[]` while provisioned. */
  readonly roles: readonly Role[];
  readonly birthDate: BirthDate | null;
};

/**
 * The account's names and sign-in contact — the fields a first-booking
 * client record copies (F1-5), under their kept key names.
 */
export type AccountContact = {
  readonly phone: E164 | null;
  /** `null` only while provisioned. */
  readonly firstName: string | null;
  /** `null` only while provisioned. */
  readonly lastName: string | null;
  readonly email: Email | null;
};

/**
 * The archetype of `users/{uid}` — **flat** (Law 6): the identity slice, the
 * account lifecycle (`accountStatus`, and a block's `blockReason` /
 * `blockedUntilUtcMs`, at the root) and the clientele search keys. One type
 * for both stored states: the `PROVISIONED` stub (`verifyOtp`'s first
 * sign-in, `RegistrationSystem.provision`) is created with EVERY key
 * present and the `REGISTERED` body `completeRegistration` sets over it
 * (`RegistrationSystem.register`). The document body is this type minus
 * `id`, byte for byte — the server's `WriteOp` plans and the web's
 * `snap.data()` read and write it as is, with no mapper.
 */
export type User = UserMeta & AccountContact & AccountLifecycle & SearchFields;

/**
 * The owner-editable keys of `users/{uid}` — the rules' owner allowlist,
 * verbatim (`firstName`, `lastName`, `birthDate`, `searchName`,
 * `searchPrefixes`). The answer of `ProfileEditSystem.decide` and the
 * argument shape of the `WriteOwnProfile` port (F2-17): a named record, not
 * a `Pick<User, …>`, so a rename is one compiler-checked change. A
 * REGISTERED owner's names are never `null`, so neither are these; the
 * search keys are recomputed from the STORED contact channels on every
 * edit (the owner cannot change `phone` or `email`).
 */
export type OwnerProfileFields = {
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: BirthDate | null;
} & SearchFields;

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
