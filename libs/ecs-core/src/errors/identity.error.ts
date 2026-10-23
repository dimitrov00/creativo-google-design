import type { AccountsError } from './accounts.error';
import type { IdentifierChannel } from '@core/primitives';
import type { PhoneError } from './phone.error';

/**
 * The identity context's error codes — the codes of the legacy identity
 * domain's `*.errors.ts` (deleted in Phase 4b) and of the identity flow
 * machines, collapsed from `DomainError` subclasses into one dictionary of
 * flat structs discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with
 * the `IDENTITY_` prefix (flatten-spec §4.2). Every non-`errorCode` field is
 * an i18n parameter, so each one is an i18n-safe scalar (infrastructure Q5);
 * the UI looks them up as `errors.<errorCode>`, and the edge sends the code
 * itself on the wire (Phase 4a 4A-4).
 *
 * The first four are the OTP verdicts (`IdentityError.Otp`): payload-free on
 * purpose — a `wrong_code` never smuggles the next entity state into an
 * error value; the incremented attempt is `OtpSystem.recordAttempt(otp)`, a
 * separate pure step. The edge-guard codes are raised by
 * `ParsedIdentifier.parse`, `OtpCode.parse`, `AuthClaims.active`,
 * `AuthStrategy.parse`, AgeSystem and the two flow machines. The nine from
 * `OtpChannelMismatch` to `RegistrationFieldMissing` (identity flip (2),
 * F2-4) are the refusals of the `requestOtp`, `verifyOtp` and
 * `completeRegistration` pipelines that no dictionary spelled before; the
 * callables' own faults follow them (Phase 4a 4A-4), and the web's own two
 * failure words close the dictionary (Phase 4b, 4B-4: no pipeline raises
 * them, so they stay outside the {@link IdentityError} union and their edge
 * rows are inert). Their context fields are scalars: the errors tier imports
 * only primitives, never a component (Law 8), so a component value rides as
 * its plain string (`IdentifierChannel` is a primitives tag).
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
  /** The deployment's strategy challenges another channel than the one asked for. */
  OtpChannelMismatch: 'IDENTITY_OTP_CHANNEL_MISMATCH',
  /** An open challenge for the destination is younger than the resend window. */
  OtpRateLimited: 'IDENTITY_OTP_RATE_LIMITED',
  /** No `otps/{id}` — an unknown or purged challenge. */
  OtpNotFound: 'IDENTITY_OTP_NOT_FOUND',
  /** The stored `destination` no longer parses as its `otpDestinationType`. */
  OtpDestinationCorrupted: 'IDENTITY_OTP_DESTINATION_CORRUPTED',
  /**
   * The uid Auth answered for the destination owns a `users` document that
   * is registered, or carries another contact — never adopted, never signed
   * into (F2-9).
   */
  OtpAccountConflict: 'IDENTITY_OTP_ACCOUNT_CONFLICT',
  /** `completeRegistration` called without a signed-in session. */
  RegistrationUnauthenticated: 'IDENTITY_REGISTRATION_UNAUTHENTICATED',
  /** The identifier's account is not the caller's own. */
  RegistrationForbidden: 'IDENTITY_REGISTRATION_FORBIDDEN',
  /** No account holds the identifier — there is nothing to register. */
  RegistrationUserNotFound: 'IDENTITY_REGISTRATION_USER_NOT_FOUND',
  /** A field the deployment's strategy requires is absent or blank (`field` names it). */
  RegistrationFieldMissing: 'IDENTITY_REGISTRATION_FIELD_MISSING',
  /*
   * The OTP and registration callables' own faults and payload refusals —
   * the successors of the undotted wire codes retired in Phase 4a (4A-4).
   */
  /** A payload the callable could not read — `reason` says what (was `invalid_input`). */
  InvalidInput: 'IDENTITY_INVALID_INPUT',
  /** A store failure of an identity callable (was `repository_failure`). */
  RepositoryFailure: 'IDENTITY_REPOSITORY_FAILURE',
  /** The challenge could not be delivered (was `otp_send_failure`). */
  OtpSendFailure: 'IDENTITY_OTP_SEND_FAILURE',
  /** Auth could not mint the sign-in token (was `token_minting_failure`). */
  TokenMintingFailure: 'IDENTITY_TOKEN_MINTING_FAILURE',
  /** Auth could not promote the registered session's claims (was `claims_promotion_failure`). */
  ClaimsPromotionFailure: 'IDENTITY_CLAIMS_PROMOTION_FAILURE',
  /** The registration's birth date was refused — its cause nested in `errors` (was `registration_birth_date_invalid`). */
  RegistrationBirthDateInvalid: 'IDENTITY_REGISTRATION_BIRTH_DATE_INVALID',
  /*
   * The web's own failure words (Phase 4b, 4B-4) — the successors of the
   * dotted i18n keys the onboarding, profile and auth pages read.
   */
  /**
   * The session carries no phone number or email (or no account) to
   * register or save against — the onboarding and profile stores word it;
   * no pipeline raises it (succeeds a retired dotted i18n key —
   * `docs/architecture/flips/phase-4b-delete.md` §2 row 4).
   */
  IdentifierMissing: 'IDENTITY_IDENTIFIER_MISSING',
  /**
   * An auth or onboarding call failed and the server named no code the
   * surface words — the auth and onboarding pages' own generic copy; no
   * pipeline raises it (succeeds a retired dotted i18n key —
   * `docs/architecture/flips/phase-4b-delete.md` §2 row 5).
   */
  CallFailed: 'IDENTITY_CALL_FAILED',
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
  | IdentityError.OnboardingFlowInvalidTransition
  | IdentityError.OtpChannelMismatch
  | IdentityError.OtpRateLimited
  | IdentityError.OtpNotFound
  | IdentityError.OtpDestinationCorrupted
  | IdentityError.OtpAccountConflict
  | IdentityError.RegistrationUnauthenticated
  | IdentityError.RegistrationForbidden
  | IdentityError.RegistrationUserNotFound
  | IdentityError.RegistrationFieldMissing;

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
  /**
   * `requested` is the channel the caller asked for; `authStrategyKind` the
   * deployment strategy's kind, as its plain string (an `AuthStrategyKind`
   * value — a component dictionary this tier never imports).
   */
  otpChannelMismatch(
    requested: IdentifierChannel,
    authStrategyKind: string,
  ): IdentityError.OtpChannelMismatch {
    return {
      errorCode: IdentityErrorCode.OtpChannelMismatch,
      requested,
      authStrategyKind,
    };
  },
  otpRateLimited(): IdentityError.OtpRateLimited {
    return { errorCode: IdentityErrorCode.OtpRateLimited };
  },
  otpNotFound(): IdentityError.OtpNotFound {
    return { errorCode: IdentityErrorCode.OtpNotFound };
  },
  otpDestinationCorrupted(): IdentityError.OtpDestinationCorrupted {
    return { errorCode: IdentityErrorCode.OtpDestinationCorrupted };
  },
  otpAccountConflict(): IdentityError.OtpAccountConflict {
    return { errorCode: IdentityErrorCode.OtpAccountConflict };
  },
  registrationUnauthenticated(): IdentityError.RegistrationUnauthenticated {
    return { errorCode: IdentityErrorCode.RegistrationUnauthenticated };
  },
  registrationForbidden(): IdentityError.RegistrationForbidden {
    return { errorCode: IdentityErrorCode.RegistrationForbidden };
  },
  registrationUserNotFound(): IdentityError.RegistrationUserNotFound {
    return { errorCode: IdentityErrorCode.RegistrationUserNotFound };
  },
  /** `field` is the missing `RegistrationField` value, as its plain string. */
  registrationFieldMissing(
    field: string,
  ): IdentityError.RegistrationFieldMissing {
    return { errorCode: IdentityErrorCode.RegistrationFieldMissing, field };
  },
  invalidInput(reason: string): IdentityError.InvalidInput {
    return { errorCode: IdentityErrorCode.InvalidInput, reason };
  },
  repositoryFailure(): IdentityError.RepositoryFailure {
    return { errorCode: IdentityErrorCode.RepositoryFailure };
  },
  otpSendFailure(): IdentityError.OtpSendFailure {
    return { errorCode: IdentityErrorCode.OtpSendFailure };
  },
  tokenMintingFailure(): IdentityError.TokenMintingFailure {
    return { errorCode: IdentityErrorCode.TokenMintingFailure };
  },
  claimsPromotionFailure(): IdentityError.ClaimsPromotionFailure {
    return { errorCode: IdentityErrorCode.ClaimsPromotionFailure };
  },
  registrationBirthDateInvalid(
    errors: readonly IdentityError.BirthDate[],
  ): IdentityError.RegistrationBirthDateInvalid {
    return {
      errorCode: IdentityErrorCode.RegistrationBirthDateInvalid,
      errors,
    };
  },
  identifierMissing(): IdentityError.IdentifierMissing {
    return { errorCode: IdentityErrorCode.IdentifierMissing };
  },
  callFailed(): IdentityError.CallFailed {
    return { errorCode: IdentityErrorCode.CallFailed };
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
  export type OtpChannelMismatch = {
    readonly errorCode: typeof IdentityErrorCode.OtpChannelMismatch;
    readonly requested: IdentifierChannel;
    /** The deployment strategy's `AuthStrategyKind`, as its plain string. */
    readonly authStrategyKind: string;
  };
  export type OtpRateLimited = {
    readonly errorCode: typeof IdentityErrorCode.OtpRateLimited;
  };
  export type OtpNotFound = {
    readonly errorCode: typeof IdentityErrorCode.OtpNotFound;
  };
  export type OtpDestinationCorrupted = {
    readonly errorCode: typeof IdentityErrorCode.OtpDestinationCorrupted;
  };
  export type OtpAccountConflict = {
    readonly errorCode: typeof IdentityErrorCode.OtpAccountConflict;
  };
  export type RegistrationUnauthenticated = {
    readonly errorCode: typeof IdentityErrorCode.RegistrationUnauthenticated;
  };
  export type RegistrationForbidden = {
    readonly errorCode: typeof IdentityErrorCode.RegistrationForbidden;
  };
  export type RegistrationUserNotFound = {
    readonly errorCode: typeof IdentityErrorCode.RegistrationUserNotFound;
  };
  export type RegistrationFieldMissing = {
    readonly errorCode: typeof IdentityErrorCode.RegistrationFieldMissing;
    /** The `RegistrationField` value, as its plain string. */
    readonly field: string;
  };
  /** The four birth-date refusals — what a registration's wrapper nests. */
  export type BirthDate =
    BirthDateInvalid | BirthDateInFuture | BirthDateTooYoung | BirthDateTooOld;
  export type InvalidInput = {
    readonly errorCode: typeof IdentityErrorCode.InvalidInput;
    /** What could not be read, in words for the log (`'missing or empty otpId'`). */
    readonly reason: string;
  };
  export type RepositoryFailure = {
    readonly errorCode: typeof IdentityErrorCode.RepositoryFailure;
  };
  export type OtpSendFailure = {
    readonly errorCode: typeof IdentityErrorCode.OtpSendFailure;
  };
  export type TokenMintingFailure = {
    readonly errorCode: typeof IdentityErrorCode.TokenMintingFailure;
  };
  export type ClaimsPromotionFailure = {
    readonly errorCode: typeof IdentityErrorCode.ClaimsPromotionFailure;
  };
  export type RegistrationBirthDateInvalid = {
    readonly errorCode: typeof IdentityErrorCode.RegistrationBirthDateInvalid;
    /** The cause — the one birth-date refusal, as today's wrapper nested it. */
    readonly errors: readonly BirthDate[];
  };
  export type IdentifierMissing = {
    readonly errorCode: typeof IdentityErrorCode.IdentifierMissing;
  };
  export type CallFailed = {
    readonly errorCode: typeof IdentityErrorCode.CallFailed;
  };
}

/** Every refusal a registration profile can collect, in today's order. */
export type RegistrationProfileError =
  AccountsError | PhoneError | IdentityError;

/** Why a registration's profile was refused — the ONLY source of these strings, the field `errorCode`. */
export const CompleteRegistrationRefusalCode = {
  /** The settled profile failed its checks — every refusal collected, in today's order. */
  ProfileInvalid: 'IDENTITY_REGISTRATION_PROFILE_INVALID',
} as const;
export type CompleteRegistrationRefusalCode =
  (typeof CompleteRegistrationRefusalCode)[keyof typeof CompleteRegistrationRefusalCode];

/**
 * The aggregate refusal of the registered profile (today's
 * `user_validation_failed`): a flat struct whose one 1-to-N field is the
 * list of the profile's refusals, which the edge words one by one.
 */
export type CompleteRegistrationRefusal = {
  readonly errorCode: typeof CompleteRegistrationRefusalCode.ProfileInvalid;
  readonly errors: readonly RegistrationProfileError[];
};
