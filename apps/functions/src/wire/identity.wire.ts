import {
  AuthStrategyKind,
  OtpCode,
  OtpDestinationType,
  RegistrationField,
  type RegistrationFields,
  SessionKind,
} from '@core/components';
import {
  AccountsError,
  CompleteRegistrationRefusalCode,
  IdentifierChannel,
  IdentityError,
  IdentityErrorCode,
  OtpId,
  PhoneErrorCode,
  type PipelineError,
  PipelineErrorCode,
  type RegistrationProfileError,
  type RepositoryError,
  RepositoryErrorCode,
  Result,
  UserId,
} from '@core/primitives';
import {
  type CompleteRegistrationAnswer,
  type CompleteRegistrationCommand,
  type CompleteRegistrationError,
  type RequestOtpAnswer,
  type RequestOtpCommand,
  type RequestOtpError,
  type UpdateProfileAnswer,
  type UpdateProfileCommand,
  type UpdateProfileError,
  type VerifyOtpAnswer,
  type VerifyOtpCommand,
  type VerifyOtpError,
} from '@core/pipelines';
import { type EdgeError, LegacyWireCode } from '../edge';
import type { WireRequest } from './booking.wire';
import { storeFailure } from './waitlist.wire';

/**
 * THE IDENTITY CALLABLES' WIRE (identity flip (2), F2-3) — frozen in both
 * directions until Phase 4 flips it with `callableClient`.
 *
 * - **In:** one decoder per callable turns today's JSON into the pipeline
 *   command and answers today's `invalid_input` refusals itself, in today's
 *   order and with today's `reason` strings: `requestOtpChallenge`
 *   `{ channelKey?, kind, value }` (`kind` is NEVER refused — `'phone'` is
 *   an SMS, anything else an e-mail), `verifyOtpChallenge`
 *   `{ challengeId, code }`, `completeRegistration` `{ kind, value, fields }`
 *   (the verified caller first, before the payload). The new `updateProfile`
 *   reads `{ firstName?, lastName?, birthDate? }` off a verified caller.
 * - **Out:** one encoder per callable answers today's JSON —
 *   `{ challengeId, devCode? }` (`devCode` only under the emulator),
 *   `{ sessionKind: 'new' | 'returning', customToken }`, `{ customToken }`,
 *   and the new `{ changed }`.
 * - **Refusals:** one function per OTP callable turns a pipeline's ecs-core
 *   refusal back into today's undotted `LegacyWireCode` — the status and
 *   `details` byte for byte (`EDGE_WIRE` spells them): the channel mismatch
 *   with its lowercase `requested` / `strategyKind` params, an Auth failure
 *   as `token_minting_failure` / `claims_promotion_failure`, a refused
 *   adoption as `token_minting_failure`, the registration aggregate as
 *   `user_validation_failed` with today's nested codes, the birth date as
 *   `registration_birth_date_invalid` wrapping its cause. The `HttpsError`
 *   MESSAGE is not frozen: it becomes the wire code, as for every flipped
 *   callable (no client reads it). A store failure is no refusal: it is
 *   thrown, for the edge to track and answer as the callable's coded
 *   `repository_failure` — today's answer to every store failure of these
 *   three handlers. `updateProfile` is a new wire: its ecs-core refusals
 *   leave as themselves.
 */

/** A field of an untrusted object by name — no dynamic index. */
function field(source: unknown, name: string): unknown {
  return source !== null && typeof source === 'object'
    ? Object.getOwnPropertyDescriptor(source, name)?.value
    : undefined;
}

/** The verified caller's uid, or `null`. */
function callerOf(request: WireRequest): UserId | null {
  const uid = UserId.parse(request.auth?.uid ?? '');
  return uid.ok ? uid.value : null;
}

/** Today's `invalid_input` refusal with its `reason`. */
function invalidInput(reason: string): EdgeError {
  return { code: LegacyWireCode.InvalidInput, reason };
}

/** A legacy wire refusal (`{ code }` / `{ code, params }`), as the shared table spells it. */
function legacy(
  code: LegacyWireCode,
  fields: Readonly<Record<string, unknown>> = {},
): EdgeError {
  return { code, ...fields };
}

const STORE_FAILURES: ReadonlySet<string> = new Set(
  Object.values(RepositoryErrorCode),
);
const PIPELINE_FAILURES: ReadonlySet<string> = new Set(
  Object.values(PipelineErrorCode),
);

function isStoreFailure(error: {
  readonly errorCode: string;
}): error is RepositoryError {
  return STORE_FAILURES.has(error.errorCode);
}

function isPipelineFailure(error: {
  readonly errorCode: string;
}): error is PipelineError {
  return PIPELINE_FAILURES.has(error.errorCode);
}

/** The lowercase channel word of today's `requested` param. */
const LEGACY_CHANNEL: { readonly [C in IdentifierChannel]: string } = {
  [IdentifierChannel.Phone]: 'phone',
  [IdentifierChannel.Email]: 'email',
};

/** The lowercase strategy kind of today's `strategyKind` param. */
const LEGACY_STRATEGY_KIND: ReadonlyMap<string, string> = new Map([
  [AuthStrategyKind.PhoneOtp, 'phone_otp'],
  [AuthStrategyKind.EmailOtp, 'email_otp'],
  [AuthStrategyKind.EmailLink, 'email_link'],
]);

const IDENTITY_CODES: ReadonlySet<string> = new Set(
  Object.values(IdentityErrorCode),
);

function isIdentityError(error: {
  readonly errorCode: string;
}): error is IdentityError {
  return IDENTITY_CODES.has(error.errorCode);
}

// ── requestOtpChallenge ─────────────────────────────────────────────────

/**
 * `{ channelKey?, kind, value }` → the command. `channelKey` is redundant
 * (the pipeline keys the window off the parsed destination); `kind` is
 * never refused (`'phone'` → SMS, absent or garbage → e-mail); a blank
 * `value` is `'missing or empty destination'` — checked on the UNTRIMMED
 * text's trim, before the channel; the text itself is handed on untrimmed
 * for the pipeline's single trim (F2-10).
 */
export function decodeRequestOtp(
  request: WireRequest,
): Result<RequestOtpCommand, EdgeError> {
  const value = field(request.data, 'value');
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Result.err(invalidInput('missing or empty destination'));
  }
  return Result.ok({
    otpDestinationType:
      field(request.data, 'kind') === 'phone'
        ? OtpDestinationType.Sms
        : OtpDestinationType.Email,
    rawDestination: value,
  });
}

/**
 * `{ challengeId, devCode? }` — `devCode` only when `exposeDevCode` (the
 * root passes the `FUNCTIONS_EMULATOR` gate): there is no inbox for the e2e
 * suite to read a real code from, and production never forwards it.
 */
export function encodeRequestOtpAnswer(
  answer: RequestOtpAnswer,
  exposeDevCode: boolean,
): { readonly challengeId: string; readonly devCode?: string } {
  return {
    challengeId: answer.otpId,
    ...(exposeDevCode ? { devCode: answer.rawCode } : {}),
  };
}

/** A `requestOtp` refusal in today's words (a store failure thrown). */
export function requestOtpRefusal(error: RequestOtpError): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  if (isPipelineFailure(error)) return legacy(LegacyWireCode.OtpSendFailure);
  if (!isIdentityError(error)) return error;
  switch (error.errorCode) {
    case IdentityErrorCode.OtpChannelMismatch:
      return legacy(LegacyWireCode.OtpChannelMismatch, {
        requested: LEGACY_CHANNEL[error.requested],
        strategyKind:
          LEGACY_STRATEGY_KIND.get(error.authStrategyKind) ??
          error.authStrategyKind.toLowerCase(),
      });
    case IdentityErrorCode.IdentifierInvalid:
      return invalidInput(
        error.identifierKind === IdentifierChannel.Phone
          ? 'invalid phone destination'
          : 'invalid email destination',
      );
    case IdentityErrorCode.OtpRateLimited:
      return legacy(LegacyWireCode.OtpRateLimited);
    default:
      return error;
  }
}

// ── verifyOtpChallenge ──────────────────────────────────────────────────

/**
 * `{ challengeId, code }` → the command, today's refusals in today's order:
 * a blank `challengeId`, then a `code` that is not exactly six ASCII
 * digits (untrimmed — `' 123456'` is refused, as today), then an id that
 * is no document id.
 */
export function decodeVerifyOtp(
  request: WireRequest,
): Result<VerifyOtpCommand, EdgeError> {
  const challengeId = field(request.data, 'challengeId');
  const code = field(request.data, 'code');
  if (typeof challengeId !== 'string' || challengeId.trim().length === 0) {
    return Result.err(invalidInput('missing or empty otpId'));
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return Result.err(invalidInput('code must be a 6-digit string'));
  }
  const otpId = OtpId.parse(challengeId);
  if (!otpId.ok) return Result.err(invalidInput('invalid otpId'));
  const otpCode = OtpCode.parse(code);
  if (!otpCode.ok) {
    return Result.err(invalidInput('code must be a 6-digit string'));
  }
  return Result.ok({ otpId: otpId.value, code: otpCode.value });
}

/** The session kinds as today's wire spells them (lowercase until Phase 4). */
const LEGACY_SESSION_KIND: {
  readonly [K in SessionKind]: 'new' | 'returning';
} = {
  [SessionKind.New]: 'new',
  [SessionKind.Returning]: 'returning',
};

/** `{ sessionKind, customToken }`, today's keys and lowercase values. */
export function encodeVerifyOtpAnswer(answer: VerifyOtpAnswer): {
  readonly sessionKind: 'new' | 'returning';
  readonly customToken: string;
} {
  return {
    sessionKind: LEGACY_SESSION_KIND[answer.sessionKind],
    customToken: answer.customToken,
  };
}

/** A `verifyOtp` refusal in today's words (a store failure thrown). */
export function verifyOtpRefusal(error: VerifyOtpError): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  if (isPipelineFailure(error)) {
    return legacy(LegacyWireCode.TokenMintingFailure);
  }
  if (!isIdentityError(error)) return error;
  switch (error.errorCode) {
    case IdentityErrorCode.OtpNotFound:
      return legacy(LegacyWireCode.OtpNotFound);
    case IdentityErrorCode.OtpAlreadyConsumed:
      return legacy(LegacyWireCode.OtpAlreadyConsumed);
    case IdentityErrorCode.OtpExpired:
      return legacy(LegacyWireCode.OtpExpired);
    case IdentityErrorCode.OtpLockedOut:
      return legacy(LegacyWireCode.OtpLockedOut);
    case IdentityErrorCode.OtpWrongCode:
      return legacy(LegacyWireCode.OtpIncorrectCode);
    case IdentityErrorCode.OtpDestinationCorrupted:
      return legacy(LegacyWireCode.OtpDestinationCorrupted);
    // A refused adoption answers as today's failed provisioning (F2-9).
    case IdentityErrorCode.OtpAccountConflict:
      return legacy(LegacyWireCode.TokenMintingFailure);
    default:
      return error;
  }
}

// ── completeRegistration ────────────────────────────────────────────────

/** The about step's fields, every key present: a text as sent, anything else not sent. */
function registrationFieldsOf(raw: unknown): RegistrationFields {
  const text = (name: RegistrationField): string | null => {
    const value = field(raw, name);
    return typeof value === 'string' ? value : null;
  };
  return {
    [RegistrationField.Phone]: text(RegistrationField.Phone),
    [RegistrationField.Email]: text(RegistrationField.Email),
    [RegistrationField.FirstName]: text(RegistrationField.FirstName),
    [RegistrationField.LastName]: text(RegistrationField.LastName),
    [RegistrationField.BirthDate]: text(RegistrationField.BirthDate),
  };
}

/**
 * The verified caller first (`registration_unauthenticated`, before the
 * payload is read), then today's payload checks in today's order: an
 * object, a `kind` of `'phone'` or `'email'`, a non-blank `value`, a
 * `fields` object.
 */
export function decodeCompleteRegistration(
  request: WireRequest,
): Result<CompleteRegistrationCommand, EdgeError> {
  const callerUserId = callerOf(request);
  if (callerUserId === null) {
    return Result.err(
      completeRegistrationRefusal(IdentityError.registrationUnauthenticated()),
    );
  }
  const payload = request.data;
  if (payload === null || typeof payload !== 'object') {
    return Result.err(invalidInput('payload must be an object'));
  }
  const kind = field(payload, 'kind');
  if (kind !== 'phone' && kind !== 'email') {
    return Result.err(invalidInput('kind must be "phone" or "email"'));
  }
  const value = field(payload, 'value');
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Result.err(invalidInput('missing or empty value'));
  }
  const fields = field(payload, 'fields');
  if (fields === null || typeof fields !== 'object') {
    return Result.err(invalidInput('missing fields'));
  }
  return Result.ok({
    callerUserId,
    identifierChannel:
      kind === 'phone' ? IdentifierChannel.Phone : IdentifierChannel.Email,
    rawIdentifier: value,
    fields: registrationFieldsOf(fields),
  });
}

/** `{ customToken }`. */
export function encodeCompleteRegistrationAnswer(
  answer: CompleteRegistrationAnswer,
): { readonly customToken: string } {
  return { customToken: answer.customToken };
}

/** The birth-date refusals — wrapped as `registration_birth_date_invalid`, their cause nested. */
const BIRTH_DATE_CODES: ReadonlySet<string> = new Set([
  IdentityErrorCode.BirthDateInvalid,
  IdentityErrorCode.BirthDateInFuture,
  IdentityErrorCode.BirthDateTooYoung,
  IdentityErrorCode.BirthDateTooOld,
]);

/**
 * One refusal of the registered profile as today's aggregate nested it —
 * the accounts aggregate's own codes: a phone as `phone_number_invalid`
 * with its `attempted` and `reason`, the age window as
 * `accounts.birth_date.*`; the names, the e-mail and the roles leave as the
 * table spells their accounts codes.
 */
function legacyProfileRefusal(error: RegistrationProfileError): EdgeError {
  switch (error.errorCode) {
    case PhoneErrorCode.Invalid:
      return legacy(LegacyWireCode.PhoneNumberInvalid, {
        attempted: error.attempted,
        reason: error.reason,
      });
    case PhoneErrorCode.CountryUnsupported:
      return legacy(LegacyWireCode.PhoneNumberInvalid, {
        attempted: error.attempted,
        reason: 'invalid-country',
      });
    case IdentityErrorCode.BirthDateTooYoung:
      return legacy(LegacyWireCode.AccountsBirthDateTooYoung, {
        age: error.age,
        minAge: error.minAge,
      });
    case IdentityErrorCode.BirthDateTooOld:
      return legacy(LegacyWireCode.AccountsBirthDateTooOld, {
        age: error.age,
        maxAge: error.maxAge,
      });
    case IdentityErrorCode.BirthDateInvalid:
    case IdentityErrorCode.BirthDateInFuture:
      return legacy(LegacyWireCode.AccountsBirthDateInvalid, {
        attempted: error.attempted,
      });
    default:
      return error;
  }
}

/** A `completeRegistration` refusal in today's words (a store failure thrown). */
export function completeRegistrationRefusal(
  error: CompleteRegistrationError,
): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  if (isPipelineFailure(error)) {
    return legacy(LegacyWireCode.ClaimsPromotionFailure);
  }
  if (error.errorCode === CompleteRegistrationRefusalCode.ProfileInvalid) {
    return legacy(LegacyWireCode.UserValidationFailed, {
      errors: error.errors.map(legacyProfileRefusal),
    });
  }
  if (!isIdentityError(error)) return error;
  if (BIRTH_DATE_CODES.has(error.errorCode)) {
    return legacy(LegacyWireCode.RegistrationBirthDateInvalid, {
      errors: [error],
    });
  }
  switch (error.errorCode) {
    case IdentityErrorCode.RegistrationUnauthenticated:
      return legacy(LegacyWireCode.RegistrationUnauthenticated);
    case IdentityErrorCode.RegistrationFieldMissing:
      return legacy(LegacyWireCode.RegistrationFieldMissing, {
        field: error.field,
      });
    case IdentityErrorCode.IdentifierInvalid:
      return invalidInput('invalid identifier value');
    case IdentityErrorCode.RegistrationUserNotFound:
      return legacy(LegacyWireCode.RegistrationUserNotFound);
    case IdentityErrorCode.RegistrationForbidden:
      return legacy(LegacyWireCode.RegistrationForbidden);
    default:
      return error;
  }
}

// ── updateProfile (a new wire) ──────────────────────────────────────────

/** An edit field: text as sent, absent as `null` (keep), anything else a refusal. */
type EditField = { readonly text: string | null; readonly valid: boolean };

function editFieldOf(raw: unknown, name: string): EditField {
  const value = field(raw, name);
  if (value === undefined) return { text: null, valid: true };
  return typeof value === 'string'
    ? { text: value, valid: true }
    : { text: null, valid: false };
}

/**
 * `{ firstName?, lastName?, birthDate? }` off a verified caller: no caller
 * → `ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED`; a field present but not text
 * → `ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED`; an absent field keeps the
 * stored value (there is no clearing).
 */
export function decodeUpdateProfile(
  request: WireRequest,
): Result<UpdateProfileCommand, EdgeError> {
  const callerUserId = callerOf(request);
  if (callerUserId === null) {
    return Result.err(AccountsError.updateProfileUnauthenticated());
  }
  const firstName = editFieldOf(request.data, 'firstName');
  const lastName = editFieldOf(request.data, 'lastName');
  const birthDate = editFieldOf(request.data, 'birthDate');
  if (!firstName.valid || !lastName.valid || !birthDate.valid) {
    return Result.err(AccountsError.updateProfileValidationFailed());
  }
  return Result.ok({
    callerUserId,
    edits: {
      firstName: firstName.text,
      lastName: lastName.text,
      birthDate: birthDate.text,
    },
  });
}

/** `{ changed }`. */
export function encodeUpdateProfileAnswer(answer: UpdateProfileAnswer): {
  readonly changed: boolean;
} {
  return { changed: answer.changed };
}

/** An `updateProfile` refusal: its ecs-core code as itself (a store failure thrown). */
export function updateProfileRefusal(error: UpdateProfileError): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  return error;
}
