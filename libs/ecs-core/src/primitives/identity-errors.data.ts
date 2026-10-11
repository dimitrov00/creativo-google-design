import type { IdentifierChannel } from './identifier-channel.data';

/**
 * The identity context's error codes — the codes of
 * `libs/domain/identity/src/lib/*.errors.ts` and the identity flow machines,
 * collapsed from `DomainError` subclasses into one dictionary of flat
 * structs discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with the
 * `IDENTITY_` prefix (flatten-spec §4.2). Every non-`errorCode` field is an
 * i18n parameter, so each one is an i18n-safe scalar (infrastructure Q5);
 * the UI looks them up as `errors.<errorCode>`, and the edge still sends the
 * legacy dotted code on the wire until Phase 4 (§4.3).
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
  OtpAlreadyConsumed: 'IDENTITY_OTP_ALREADY_CONSUMED',
  /** Past `expiresAtUtcMs`. */
  OtpExpired: 'IDENTITY_OTP_EXPIRED',
  /** `attemptCount` reached the stored `maxAttempts`. */
  OtpLockedOut: 'IDENTITY_OTP_LOCKED_OUT',
  /** The typed code does not match the stored hash. */
  OtpWrongCode: 'IDENTITY_OTP_WRONG_CODE',
  /** Neither a phone number nor an e-mail address of the asked kind. */
  IdentifierInvalid: 'IDENTITY_IDENTIFIER_INVALID',
  /** Not exactly six ASCII digits. */
  OtpCodeInvalid: 'IDENTITY_OTP_CODE_INVALID',
  /** Not a real calendar date. */
  BirthDateInvalid: 'IDENTITY_BIRTH_DATE_INVALID',
  /** A birth date after today. */
  BirthDateInFuture: 'IDENTITY_BIRTH_DATE_IN_FUTURE',
  /** Younger than the registration minimum (16). */
  BirthDateTooYoung: 'IDENTITY_BIRTH_DATE_TOO_YOUNG',
  /** Older than the plausible maximum (120). */
  BirthDateTooOld: 'IDENTITY_BIRTH_DATE_TOO_OLD',
  /** Active claims with no role — "active but roleless" is unrepresentable. */
  AuthClaimsEmptyRoles: 'IDENTITY_AUTH_CLAIMS_EMPTY_ROLES',
  AuthStrategyUnknownKind: 'IDENTITY_AUTH_STRATEGY_UNKNOWN_KIND',
  AuthStrategyUnknownField: 'IDENTITY_AUTH_STRATEGY_UNKNOWN_FIELD',
  AuthStrategyRequiredEmpty: 'IDENTITY_AUTH_STRATEGY_REQUIRED_EMPTY',
  /** Every strategy must require a phone — the shop always needs a contact channel. */
  AuthStrategyPhoneMissing: 'IDENTITY_AUTH_STRATEGY_PHONE_MISSING',
  /** A policy figure that is not a positive integer (`field` names which). */
  AuthStrategyInvalidPolicy: 'IDENTITY_AUTH_STRATEGY_INVALID_POLICY',
  /** An event the auth flow does not accept in its current step. */
  AuthFlowInvalidTransition: 'IDENTITY_AUTH_FLOW_INVALID_TRANSITION',
  /** An event the onboarding flow does not accept in its current step. */
  OnboardingFlowInvalidTransition:
    'IDENTITY_ONBOARDING_FLOW_INVALID_TRANSITION',
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
  errorCode: IdentityErrorCode.OtpAlreadyConsumed,
};
const OTP_EXPIRED: IdentityError.OtpExpired = {
  errorCode: IdentityErrorCode.OtpExpired,
};
const OTP_LOCKED_OUT: IdentityError.OtpLockedOut = {
  errorCode: IdentityErrorCode.OtpLockedOut,
};
const OTP_WRONG_CODE: IdentityError.OtpWrongCode = {
  errorCode: IdentityErrorCode.OtpWrongCode,
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
    identifierKind: IdentifierChannel,
    attempted: string,
  ): IdentityError.IdentifierInvalid {
    return {
      errorCode: IdentityErrorCode.IdentifierInvalid,
      identifierKind,
      attempted,
    };
  },
  otpCodeInvalid(attempted: string): IdentityError.OtpCodeInvalid {
    return { errorCode: IdentityErrorCode.OtpCodeInvalid, attempted };
  },
  birthDateInvalid(attempted: string): IdentityError.BirthDateInvalid {
    return { errorCode: IdentityErrorCode.BirthDateInvalid, attempted };
  },
  birthDateInFuture(attempted: string): IdentityError.BirthDateInFuture {
    return { errorCode: IdentityErrorCode.BirthDateInFuture, attempted };
  },
  birthDateTooYoung(
    age: number,
    minAge: number,
  ): IdentityError.BirthDateTooYoung {
    return { errorCode: IdentityErrorCode.BirthDateTooYoung, age, minAge };
  },
  birthDateTooOld(age: number, maxAge: number): IdentityError.BirthDateTooOld {
    return { errorCode: IdentityErrorCode.BirthDateTooOld, age, maxAge };
  },
  authClaimsEmptyRoles(): IdentityError.AuthClaimsEmptyRoles {
    return { errorCode: IdentityErrorCode.AuthClaimsEmptyRoles };
  },
  authStrategyUnknownKind(
    received: string,
  ): IdentityError.AuthStrategyUnknownKind {
    return { errorCode: IdentityErrorCode.AuthStrategyUnknownKind, received };
  },
  authStrategyUnknownField(
    received: string,
  ): IdentityError.AuthStrategyUnknownField {
    return { errorCode: IdentityErrorCode.AuthStrategyUnknownField, received };
  },
  authStrategyRequiredEmpty(): IdentityError.AuthStrategyRequiredEmpty {
    return { errorCode: IdentityErrorCode.AuthStrategyRequiredEmpty };
  },
  authStrategyPhoneMissing(): IdentityError.AuthStrategyPhoneMissing {
    return { errorCode: IdentityErrorCode.AuthStrategyPhoneMissing };
  },
  authStrategyInvalidPolicy(
    field: AuthPolicyField,
  ): IdentityError.AuthStrategyInvalidPolicy {
    return { errorCode: IdentityErrorCode.AuthStrategyInvalidPolicy, field };
  },
  authFlowInvalidTransition(
    from: string,
    event: string,
  ): IdentityError.AuthFlowInvalidTransition {
    return {
      errorCode: IdentityErrorCode.AuthFlowInvalidTransition,
      from,
      event,
    };
  },
  onboardingFlowInvalidTransition(
    from: string,
    event: string,
  ): IdentityError.OnboardingFlowInvalidTransition {
    return {
      errorCode: IdentityErrorCode.OnboardingFlowInvalidTransition,
      from,
      event,
    };
  },

  /** Narrows an error to one code — `IdentityError.is(e, IdentityErrorCode.OtpExpired)`. */
  is<C extends IdentityErrorCode>(
    error: IdentityError,
    errorCode: C,
  ): error is Extract<IdentityError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },

  /** One of the four OTP verdicts — what `OtpSystem.verify` refuses with. */
  isOtp(error: IdentityError): error is IdentityError.Otp {
    return (
      error.errorCode === IdentityErrorCode.OtpAlreadyConsumed ||
      error.errorCode === IdentityErrorCode.OtpExpired ||
      error.errorCode === IdentityErrorCode.OtpLockedOut ||
      error.errorCode === IdentityErrorCode.OtpWrongCode
    );
  },
} as const;

export namespace IdentityError {
  /** The four OTP verdicts — `OtpSystem.verify`'s whole error type. */
  export type Otp =
    OtpAlreadyConsumed | OtpExpired | OtpLockedOut | OtpWrongCode;

  export type OtpAlreadyConsumed = {
    readonly errorCode: typeof IdentityErrorCode.OtpAlreadyConsumed;
  };
  export type OtpExpired = {
    readonly errorCode: typeof IdentityErrorCode.OtpExpired;
  };
  export type OtpLockedOut = {
    readonly errorCode: typeof IdentityErrorCode.OtpLockedOut;
  };
  export type OtpWrongCode = {
    readonly errorCode: typeof IdentityErrorCode.OtpWrongCode;
  };
  export type IdentifierInvalid = {
    readonly errorCode: typeof IdentityErrorCode.IdentifierInvalid;
    /** The channel the raw text was read as (a param typed by the renamed tag, N12). */
    readonly identifierKind: IdentifierChannel;
    readonly attempted: string;
  };
  export type OtpCodeInvalid = {
    readonly errorCode: typeof IdentityErrorCode.OtpCodeInvalid;
    readonly attempted: string;
  };
  export type BirthDateInvalid = {
    readonly errorCode: typeof IdentityErrorCode.BirthDateInvalid;
    readonly attempted: string;
  };
  export type BirthDateInFuture = {
    readonly errorCode: typeof IdentityErrorCode.BirthDateInFuture;
    readonly attempted: string;
  };
  export type BirthDateTooYoung = {
    readonly errorCode: typeof IdentityErrorCode.BirthDateTooYoung;
    readonly age: number;
    readonly minAge: number;
  };
  export type BirthDateTooOld = {
    readonly errorCode: typeof IdentityErrorCode.BirthDateTooOld;
    readonly age: number;
    readonly maxAge: number;
  };
  export type AuthClaimsEmptyRoles = {
    readonly errorCode: typeof IdentityErrorCode.AuthClaimsEmptyRoles;
  };
  export type AuthStrategyUnknownKind = {
    readonly errorCode: typeof IdentityErrorCode.AuthStrategyUnknownKind;
    readonly received: string;
  };
  export type AuthStrategyUnknownField = {
    readonly errorCode: typeof IdentityErrorCode.AuthStrategyUnknownField;
    readonly received: string;
  };
  export type AuthStrategyRequiredEmpty = {
    readonly errorCode: typeof IdentityErrorCode.AuthStrategyRequiredEmpty;
  };
  export type AuthStrategyPhoneMissing = {
    readonly errorCode: typeof IdentityErrorCode.AuthStrategyPhoneMissing;
  };
  export type AuthStrategyInvalidPolicy = {
    readonly errorCode: typeof IdentityErrorCode.AuthStrategyInvalidPolicy;
    readonly field: AuthPolicyField;
  };
  export type AuthFlowInvalidTransition = {
    readonly errorCode: typeof IdentityErrorCode.AuthFlowInvalidTransition;
    readonly from: string;
    readonly event: string;
  };
  export type OnboardingFlowInvalidTransition = {
    readonly errorCode: typeof IdentityErrorCode.OnboardingFlowInvalidTransition;
    readonly from: string;
    readonly event: string;
  };
}
