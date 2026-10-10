import type { IdentifierKind } from './identifier.data';

/**
 * The identity context's error codes — the dotted codes of
 * `libs/domain/identity/src/lib/*.errors.ts` and the identity flow machines,
 * reused as is, collapsed from `DomainError` subclasses into one dictionary
 * of plain structs (blueprint §2.4, §2.7). Every non-`code` field is an i18n
 * parameter, so each one is an i18n-safe scalar (infrastructure Q5); the
 * translated keys (`errors.identity.*` in the en/bg tables) keep their
 * strings.
 *
 * The first four are the OTP verdicts (`IdentityError.Otp`): payload-free on
 * purpose — a `wrong_code` never smuggles the next entity state into an
 * error value; the incremented attempt is `OtpSystem.recordAttempt(otp)`, a
 * separate pure step. The rest are raised at the identity edge guards
 * (`ParsedIdentifier.parse`, `OtpCode.parse`, `AuthClaims.active`,
 * `AuthStrategy.parse`) and by AgeSystem and the two flow machines.
 */
export const IdentityErrorCode = {
  /** The challenge was already used — a code is good for one sign-in. */
  OtpAlreadyConsumed: 'identity.otp.already_consumed',
  /** Past `expiresAtMs`. */
  OtpExpired: 'identity.otp.expired',
  /** `attemptCount` reached the stored `maxAttempts`. */
  OtpLockedOut: 'identity.otp.locked_out',
  /** The typed code does not match the stored hash. */
  OtpWrongCode: 'identity.otp.wrong_code',
  /** Neither a phone number nor an e-mail address of the asked kind. */
  IdentifierInvalid: 'identity.identifier.invalid',
  /** Not exactly six ASCII digits. */
  OtpCodeInvalid: 'identity.otp_code.invalid',
  /** Not a real calendar date. */
  BirthDateInvalid: 'identity.birth_date.invalid',
  /** A birth date after today, in the tenant zone. */
  BirthDateInFuture: 'identity.birth_date.in_future',
  /** Younger than the registration minimum (16). */
  BirthDateTooYoung: 'identity.birth_date.too_young',
  /** Older than the plausible maximum (120). */
  BirthDateTooOld: 'identity.birth_date.too_old',
  /** Active claims with no role — "active but roleless" is unrepresentable. */
  AuthClaimsEmptyRoles: 'identity.auth_claims.empty_roles',
  AuthStrategyUnknownKind: 'identity.auth_strategy.unknown_kind',
  AuthStrategyUnknownField: 'identity.auth_strategy.unknown_field',
  AuthStrategyRequiredEmpty: 'identity.auth_strategy.required_empty',
  /** Every strategy must require a phone — the shop always needs a contact channel. */
  AuthStrategyPhoneMissing: 'identity.auth_strategy.phone_missing',
  /** A policy figure that is not a positive integer (`field` names which). */
  AuthStrategyInvalidPolicy: 'identity.auth_strategy.invalid_policy',
  /** An event the auth flow does not accept in its current step. */
  AuthFlowInvalidTransition: 'identity.auth_flow.invalid_transition',
  /** An event the onboarding flow does not accept in its current step. */
  OnboardingFlowInvalidTransition:
    'identity.onboarding_flow.invalid_transition',
} as const;
export type IdentityErrorCode =
  (typeof IdentityErrorCode)[keyof typeof IdentityErrorCode];

/** The policy figures an `AuthStrategy` validates — the `invalid_policy` param. */
export const AuthPolicyField = {
  TtlMinutes: 'ttlMinutes',
  MaxAttempts: 'maxAttempts',
  SessionDays: 'sessionDays',
} as const;
export type AuthPolicyField =
  (typeof AuthPolicyField)[keyof typeof AuthPolicyField];

export type IdentityError =
  | IdentityError.Otp
  | IdentityError.IdentifierInvalid
  | IdentityError.OtpCodeInvalid
  | IdentityError.BirthDateInvalid
  | IdentityError.BirthDateInFuture
  | IdentityError.BirthDateTooYoung
  | IdentityError.BirthDateTooOld
  | IdentityError.AuthClaimsEmptyRoles
  | IdentityError.AuthStrategyUnknownKind
  | IdentityError.AuthStrategyUnknownField
  | IdentityError.AuthStrategyRequiredEmpty
  | IdentityError.AuthStrategyPhoneMissing
  | IdentityError.AuthStrategyInvalidPolicy
  | IdentityError.AuthFlowInvalidTransition
  | IdentityError.OnboardingFlowInvalidTransition;

/** Shared, payload-free OTP verdicts: one struct per code, never rebuilt. */
const OTP_ALREADY_CONSUMED: IdentityError.OtpAlreadyConsumed = {
  code: IdentityErrorCode.OtpAlreadyConsumed,
};
const OTP_EXPIRED: IdentityError.OtpExpired = {
  code: IdentityErrorCode.OtpExpired,
};
const OTP_LOCKED_OUT: IdentityError.OtpLockedOut = {
  code: IdentityErrorCode.OtpLockedOut,
};
const OTP_WRONG_CODE: IdentityError.OtpWrongCode = {
  code: IdentityErrorCode.OtpWrongCode,
};

export const IdentityError = {
  otpAlreadyConsumed(): IdentityError.OtpAlreadyConsumed {
    return OTP_ALREADY_CONSUMED;
  },
  otpExpired(): IdentityError.OtpExpired {
    return OTP_EXPIRED;
  },
  otpLockedOut(): IdentityError.OtpLockedOut {
    return OTP_LOCKED_OUT;
  },
  otpWrongCode(): IdentityError.OtpWrongCode {
    return OTP_WRONG_CODE;
  },
  identifierInvalid(
    identifierKind: IdentifierKind,
    attempted: string,
  ): IdentityError.IdentifierInvalid {
    return {
      code: IdentityErrorCode.IdentifierInvalid,
      identifierKind,
      attempted,
    };
  },
  otpCodeInvalid(attempted: string): IdentityError.OtpCodeInvalid {
    return { code: IdentityErrorCode.OtpCodeInvalid, attempted };
  },
  birthDateInvalid(attempted: string): IdentityError.BirthDateInvalid {
    return { code: IdentityErrorCode.BirthDateInvalid, attempted };
  },
  birthDateInFuture(attempted: string): IdentityError.BirthDateInFuture {
    return { code: IdentityErrorCode.BirthDateInFuture, attempted };
  },
  birthDateTooYoung(
    age: number,
    minAge: number,
  ): IdentityError.BirthDateTooYoung {
    return { code: IdentityErrorCode.BirthDateTooYoung, age, minAge };
  },
  birthDateTooOld(age: number, maxAge: number): IdentityError.BirthDateTooOld {
    return { code: IdentityErrorCode.BirthDateTooOld, age, maxAge };
  },
  authClaimsEmptyRoles(): IdentityError.AuthClaimsEmptyRoles {
    return { code: IdentityErrorCode.AuthClaimsEmptyRoles };
  },
  authStrategyUnknownKind(
    received: string,
  ): IdentityError.AuthStrategyUnknownKind {
    return { code: IdentityErrorCode.AuthStrategyUnknownKind, received };
  },
  authStrategyUnknownField(
    received: string,
  ): IdentityError.AuthStrategyUnknownField {
    return { code: IdentityErrorCode.AuthStrategyUnknownField, received };
  },
  authStrategyRequiredEmpty(): IdentityError.AuthStrategyRequiredEmpty {
    return { code: IdentityErrorCode.AuthStrategyRequiredEmpty };
  },
  authStrategyPhoneMissing(): IdentityError.AuthStrategyPhoneMissing {
    return { code: IdentityErrorCode.AuthStrategyPhoneMissing };
  },
  authStrategyInvalidPolicy(
    field: AuthPolicyField,
  ): IdentityError.AuthStrategyInvalidPolicy {
    return { code: IdentityErrorCode.AuthStrategyInvalidPolicy, field };
  },
  authFlowInvalidTransition(
    from: string,
    event: string,
  ): IdentityError.AuthFlowInvalidTransition {
    return { code: IdentityErrorCode.AuthFlowInvalidTransition, from, event };
  },
  onboardingFlowInvalidTransition(
    from: string,
    event: string,
  ): IdentityError.OnboardingFlowInvalidTransition {
    return {
      code: IdentityErrorCode.OnboardingFlowInvalidTransition,
      from,
      event,
    };
  },

  /** Narrows an error to one code — `IdentityError.is(e, IdentityErrorCode.OtpExpired)`. */
  is<C extends IdentityErrorCode>(
    error: IdentityError,
    code: C,
  ): error is Extract<IdentityError, { readonly code: C }> {
    return error.code === code;
  },

  /** One of the four OTP verdicts — what `OtpSystem.verify` refuses with. */
  isOtp(error: IdentityError): error is IdentityError.Otp {
    return (
      error.code === IdentityErrorCode.OtpAlreadyConsumed ||
      error.code === IdentityErrorCode.OtpExpired ||
      error.code === IdentityErrorCode.OtpLockedOut ||
      error.code === IdentityErrorCode.OtpWrongCode
    );
  },
} as const;

export namespace IdentityError {
  /** The four OTP verdicts — `OtpSystem.verify`'s whole error type. */
  export type Otp =
    OtpAlreadyConsumed | OtpExpired | OtpLockedOut | OtpWrongCode;

  export type OtpAlreadyConsumed = {
    readonly code: typeof IdentityErrorCode.OtpAlreadyConsumed;
  };
  export type OtpExpired = {
    readonly code: typeof IdentityErrorCode.OtpExpired;
  };
  export type OtpLockedOut = {
    readonly code: typeof IdentityErrorCode.OtpLockedOut;
  };
  export type OtpWrongCode = {
    readonly code: typeof IdentityErrorCode.OtpWrongCode;
  };
  export type IdentifierInvalid = {
    readonly code: typeof IdentityErrorCode.IdentifierInvalid;
    readonly identifierKind: IdentifierKind;
    readonly attempted: string;
  };
  export type OtpCodeInvalid = {
    readonly code: typeof IdentityErrorCode.OtpCodeInvalid;
    readonly attempted: string;
  };
  export type BirthDateInvalid = {
    readonly code: typeof IdentityErrorCode.BirthDateInvalid;
    readonly attempted: string;
  };
  export type BirthDateInFuture = {
    readonly code: typeof IdentityErrorCode.BirthDateInFuture;
    readonly attempted: string;
  };
  export type BirthDateTooYoung = {
    readonly code: typeof IdentityErrorCode.BirthDateTooYoung;
    readonly age: number;
    readonly minAge: number;
  };
  export type BirthDateTooOld = {
    readonly code: typeof IdentityErrorCode.BirthDateTooOld;
    readonly age: number;
    readonly maxAge: number;
  };
  export type AuthClaimsEmptyRoles = {
    readonly code: typeof IdentityErrorCode.AuthClaimsEmptyRoles;
  };
  export type AuthStrategyUnknownKind = {
    readonly code: typeof IdentityErrorCode.AuthStrategyUnknownKind;
    readonly received: string;
  };
  export type AuthStrategyUnknownField = {
    readonly code: typeof IdentityErrorCode.AuthStrategyUnknownField;
    readonly received: string;
  };
  export type AuthStrategyRequiredEmpty = {
    readonly code: typeof IdentityErrorCode.AuthStrategyRequiredEmpty;
  };
  export type AuthStrategyPhoneMissing = {
    readonly code: typeof IdentityErrorCode.AuthStrategyPhoneMissing;
  };
  export type AuthStrategyInvalidPolicy = {
    readonly code: typeof IdentityErrorCode.AuthStrategyInvalidPolicy;
    readonly field: AuthPolicyField;
  };
  export type AuthFlowInvalidTransition = {
    readonly code: typeof IdentityErrorCode.AuthFlowInvalidTransition;
    readonly from: string;
    readonly event: string;
  };
  export type OnboardingFlowInvalidTransition = {
    readonly code: typeof IdentityErrorCode.OnboardingFlowInvalidTransition;
    readonly from: string;
    readonly event: string;
  };
}
