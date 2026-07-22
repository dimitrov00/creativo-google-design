import {
  PhoneNumber,
  Result,
  ZonedDateTime,
  combine,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { AccountStatus } from './account-status';
import { BirthDate } from './birth-date';
import { BirthDateError } from './birth-date.errors';
import { Email } from './email';
import { FirstName } from './first-name';
import { LastName } from './last-name';
import { UserId } from './ids';
import { InvalidUserRoleError } from './user-role.errors';
import { UserRole, isStaff as isStaffRoleSet, isUserRole } from './user-role';
import { EmptyRolesError, UserValidationError } from './user.errors';

/**
 * Raw, untrusted shape a `User` is built from — the one door primitive
 * values enter this aggregate through. `status` is the one exception:
 * it's an already-validated `AccountStatus` domain value (its own
 * constructors — `AccountStatus.active()`/`.blocked(...)` — can't
 * produce an invalid instance), not a raw string, so it needs no
 * re-validation here.
 */
export interface UserProps {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  /** Non-empty; validated against the `UserRole` vocabulary. */
  roles: string[];
  status: AccountStatus;
  email?: string;
  /** ISO calendar date (`YYYY-MM-DD`). Optional — collected at onboarding. */
  birthDate?: string;
}

type BuildMode = 'create' | 'reconstitute';

/**
 * **Aggregate root** of the accounts context — the profile-layer user.
 * Enriches this repo's existing `models/user.ts` foundation-pass shape
 * with the fields the migration blueprint calls for: a mandatory
 * `PhoneNumber` (v2 invariant — every user has a reach-out channel
 * regardless of which strategy authenticated them), `FirstName`/
 * `LastName` instead of a single free-text `displayName`, a non-empty
 * `roles` set, a live `AccountStatus`, and an optional `BirthDate`.
 */
export class User {
  private constructor(
    readonly id: UserId,
    readonly phone: PhoneNumber,
    readonly firstName: FirstName,
    readonly lastName: LastName,
    readonly roles: readonly UserRole[],
    readonly status: AccountStatus,
    readonly email: Email | null,
    readonly birthDate: BirthDate | null,
  ) {}

  /**
   * New-instance factory — enforces creation-time invariants (birth date,
   * if given, must currently imply an age of 16–120).
   */
  static create(
    props: UserProps,
    today: ZonedDateTime,
  ): Result<User, UserValidationError[]> {
    return User.build(props, today, 'create');
  }

  /**
   * Persistence-rebuild factory — same field validation, but a stored
   * birth date only has its calendar-date format re-checked, not the
   * 16–120 creation-time age window (see `BirthDate.reconstitute`).
   */
  static reconstitute(
    props: UserProps,
    today: ZonedDateTime,
  ): Result<User, UserValidationError[]> {
    return User.build(props, today, 'reconstitute');
  }

  private static build(
    props: UserProps,
    today: ZonedDateTime,
    mode: BuildMode,
  ): Result<User, UserValidationError[]> {
    const idResult = UserId.create(props.id);
    const phoneResult = PhoneNumber.create(props.phone);
    const firstNameResult = FirstName.create(props.firstName);
    const lastNameResult = LastName.create(props.lastName);
    const emailResult: Result<Email | null, UserValidationError> = props.email
      ? Email.create(props.email)
      : ok(null);

    // Both of these already produce an *array* of errors (BirthDate's own
    // multi-error factory, and `combine` over the roles list) — folded
    // into `errors` below with a spread instead of through `combineAll`,
    // which expects every member's error to be a single item, not itself
    // an array (see `docs/architecture/domain-model.md`'s `combineAll`
    // caveat, and this repo's `Staff`/`User` `.build()` methods).
    const rolesResult = User.validateRoles(props.roles);
    const birthDateResult: Result<BirthDate | null, BirthDateError[]> =
      props.birthDate === undefined
        ? ok(null)
        : mode === 'create'
          ? BirthDate.create(props.birthDate, today)
          : BirthDate.reconstitute(props.birthDate, today);

    const combined = combineAll([
      idResult,
      phoneResult,
      firstNameResult,
      lastNameResult,
      emailResult,
    ] as const);

    const errors: UserValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];
    if (rolesResult.isFailure()) {
      errors.push(...rolesResult.error);
    }
    if (birthDateResult.isFailure()) {
      errors.push(...birthDateResult.error);
    }
    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      rolesResult.isFailure() ||
      birthDateResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, phone, firstName, lastName, email] = combined.value;
    return ok(
      new User(
        id,
        phone,
        firstName,
        lastName,
        rolesResult.value,
        props.status,
        email,
        birthDateResult.value,
      ),
    );
  }

  private static validateRoles(
    raw: readonly string[],
  ): Result<UserRole[], (InvalidUserRoleError | EmptyRolesError)[]> {
    const parsed = combine(
      raw.map((r): Result<UserRole, InvalidUserRoleError> =>
        isUserRole(r) ? ok(r) : fail(new InvalidUserRoleError(r)),
      ),
    );
    if (parsed.isFailure()) {
      return parsed;
    }
    if (parsed.value.length === 0) {
      return fail([new EmptyRolesError()]);
    }
    return parsed;
  }

  /** Whether this user's role set grants access to the staff area. */
  isStaff(): boolean {
    return isStaffRoleSet(this.roles);
  }

  hasRole(role: UserRole): boolean {
    return this.roles.includes(role);
  }

  /** Trimmed full name from first + last. */
  fullName(): string {
    return `${this.firstName.value} ${this.lastName.value}`.trim();
  }
}
