import {
  PhoneNumber,
  Result,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { Email } from './email';
import { FirstName } from './first-name';
import { LastName } from './last-name';
import { UserId } from './ids';
import { User } from './user';
import { UserAccountValidationError } from './user-account.errors';

/**
 * The lifecycle-staged record for a uid, ported from v2's
 * `UserAccount.ts`. A uid passes through two persisted stages that are
 * NOT the same shape:
 *
 *   - `provisioned` — a foothold written the instant auth succeeds,
 *     BEFORE registration/onboarding completes. Not a `User` (no roles,
 *     no status) — just enough to attach later data to the uid.
 *   - `registered`  — wraps the full `User` aggregate once onboarding
 *     completes.
 *
 * Modeled as a discriminated union (rather than one half-populated
 * `User` shape with optional fields) so the illegal "User aggregate
 * missing its roles/status" state is unrepresentable.
 *
 * No TS `namespace` (this repo's ESLint config bans it) — v2's
 * `UserAccount.Provisioned`/`.Registered` nested types are plain
 * top-level `UserAccountProvisioned`/`UserAccountRegistered` interfaces
 * here instead, same flat-union precedent as `AppointmentStatus`.
 *
 * Deviation from v2: v2's `Provisioned.channel: Identifier` (the
 * identity-context union of phone-or-email auth channels) is narrowed to
 * this context's own `PhoneNumber` directly — `Identifier` lives in the
 * not-yet-built `identity` bounded context, and this pass's `accounts`
 * lib has no dependency on it. `User.phone` already carries the same
 * "always has a reach-out phone number" invariant v2 documents on
 * `User.Contact`, so the narrowing preserves the actual business rule.
 */
export interface UserAccountProvisionedProfile {
  readonly firstName?: FirstName;
  readonly lastName?: LastName;
  readonly email?: Email;
}

export interface UserAccountProvisioned {
  readonly kind: 'provisioned';
  readonly id: UserId;
  readonly phone: PhoneNumber;
  readonly profile?: UserAccountProvisionedProfile;
  /** `true` once the person themselves confirmed the channel (vs a staff-typed number). */
  readonly contactVerified: boolean;
}

export interface UserAccountRegistered {
  readonly kind: 'registered';
  readonly user: User;
}

export type UserAccount = UserAccountProvisioned | UserAccountRegistered;

/** Raw, untrusted shape a `Provisioned` account is built from. */
export interface ProvisionedProps {
  id: string;
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  contactVerified?: boolean;
}

export const UserAccount = {
  /**
   * Validating factory for the `provisioned` variant — the raw-primitive
   * entry point (id/phone/optional profile strings all come from an
   * OTP/auth adapter, unvalidated).
   */
  provisioned(
    props: ProvisionedProps,
  ): Result<UserAccountProvisioned, UserAccountValidationError[]> {
    const idResult = UserId.create(props.id);
    const phoneResult = PhoneNumber.create(props.phone);
    const firstNameResult: Result<
      FirstName | null,
      UserAccountValidationError
    > = props.firstName ? FirstName.create(props.firstName) : ok(null);
    const lastNameResult: Result<LastName | null, UserAccountValidationError> =
      props.lastName ? LastName.create(props.lastName) : ok(null);
    const emailResult: Result<Email | null, UserAccountValidationError> =
      props.email ? Email.create(props.email) : ok(null);

    const combined = combineAll([
      idResult,
      phoneResult,
      firstNameResult,
      lastNameResult,
      emailResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, phone, firstName, lastName, email] = combined.value;

    const hasProfile =
      firstName !== null || lastName !== null || email !== null;
    const profile: UserAccountProvisionedProfile | undefined = hasProfile
      ? {
          ...(firstName !== null && { firstName }),
          ...(lastName !== null && { lastName }),
          ...(email !== null && { email }),
        }
      : undefined;

    return ok({
      kind: 'provisioned',
      id,
      phone,
      ...(profile !== undefined && { profile }),
      contactVerified: props.contactVerified ?? false,
    });
  },

  /**
   * Pure wrapper for the `registered` variant — takes an already-built
   * `User` (validated by `User.create`/`User.reconstitute`), so there is
   * no raw-primitive entry point here and no `Result` needed.
   */
  registered(user: User): UserAccountRegistered {
    return { kind: 'registered', user };
  },

  isProvisioned(account: UserAccount): account is UserAccountProvisioned {
    return account.kind === 'provisioned';
  },

  /** Narrow to the registered variant — the only one carrying a `User`. */
  isRegistered(account: UserAccount): account is UserAccountRegistered {
    return account.kind === 'registered';
  },
} as const;
