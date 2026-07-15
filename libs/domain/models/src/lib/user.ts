import { Result, combine, combineAll, fail, ok } from '@creativo/domain/kernel';
import { Email } from './email';
import { InvalidEmailError } from './email.errors';
import { TenantId, UserId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Role } from './role';
import {
  EmptyReferralCodeError,
  NegativeGamificationPointsError,
  UserValidationError,
} from './user.errors';

export interface TenantMembership {
  readonly tenantId: TenantId;
  readonly role: Role;
}

export interface TenantMembershipProps {
  tenantId: string;
  role: Role;
}

export interface UserProps {
  id: string;
  displayName?: string;
  email?: string;
  phone?: string;
  referralCode: string;
  gamificationPoints: number;
  tenantMemberships: TenantMembershipProps[];
}

export class User {
  private constructor(
    readonly id: UserId,
    readonly displayName: string | null,
    readonly email: Email | null,
    readonly phone: string | null,
    readonly referralCode: string,
    readonly gamificationPoints: number,
    readonly tenantMemberships: readonly TenantMembership[],
  ) {}

  static create(props: UserProps): Result<User, UserValidationError[]> {
    return User.build(props);
  }

  static reconstitute(props: UserProps): Result<User, UserValidationError[]> {
    return User.build(props);
  }

  private static build(props: UserProps): Result<User, UserValidationError[]> {
    const idResult = UserId.create(props.id);
    const emailResult: Result<Email | null, InvalidEmailError> = props.email
      ? Email.create(props.email)
      : ok(null);
    const referralCodeResult = User.validateReferralCode(props.referralCode);
    const pointsResult = User.validateGamificationPoints(
      props.gamificationPoints,
    );
    // Already produces an *array* of errors (validates a list, via
    // `combine`) — folded into `errors` below with a spread instead of
    // through `combineAll`, which expects every member's error to be a
    // single item, not itself an array.
    const membershipsResult = combine(
      props.tenantMemberships.map(
        (m): Result<TenantMembership, EmptyIdError> => {
          const tenantIdResult = TenantId.create(m.tenantId);
          if (tenantIdResult.isFailure()) return fail(tenantIdResult.error);
          return ok({ tenantId: tenantIdResult.value, role: m.role });
        },
      ),
    );

    const combined = combineAll([
      idResult,
      emailResult,
      referralCodeResult,
      pointsResult,
    ] as const);
    const errors: UserValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];
    if (membershipsResult.isFailure()) {
      errors.push(...membershipsResult.error);
    }
    if (errors.length > 0) {
      return fail(errors);
    }
    if (combined.isFailure() || membershipsResult.isFailure()) {
      // Unreachable given the check above — narrows both Results to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, email, referralCode, gamificationPoints] = combined.value;
    const tenantMemberships = membershipsResult.value;

    const displayName = props.displayName?.trim();
    const phone = props.phone?.trim();
    return ok(
      new User(
        id,
        displayName && displayName.length > 0 ? displayName : null,
        email,
        phone && phone.length > 0 ? phone : null,
        referralCode,
        gamificationPoints,
        tenantMemberships,
      ),
    );
  }

  private static validateReferralCode(
    raw: string,
  ): Result<string, EmptyReferralCodeError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new EmptyReferralCodeError());
  }

  private static validateGamificationPoints(
    raw: number,
  ): Result<number, NegativeGamificationPointsError> {
    return raw >= 0 ? ok(raw) : fail(new NegativeGamificationPointsError(raw));
  }
}
