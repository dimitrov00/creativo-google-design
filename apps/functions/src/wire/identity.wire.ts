import {
  type IdentityCall,
  OtpCode,
  OtpDestinationType,
  RegistrationField,
  type RegistrationFields,
} from '@core/components';
import { IdentifierChannel, OtpId, Result } from '@core/primitives';
import {
  AccountsError,
  type CompleteRegistrationError,
  CompleteRegistrationRefusalCode,
  IdentityError,
  IdentityErrorCode,
  PhoneError,
  PhoneErrorCode,
  PhoneInvalidReason,
  PipelineError,
  type RegistrationProfileError,
  type RequestOtpError,
  type UpdateProfileError,
  type VerifyOtpError,
} from '@core/errors';
import type {
  CompleteRegistrationAnswer,
  CompleteRegistrationCommand,
  RequestOtpAnswer,
  RequestOtpCommand,
  UpdateProfileAnswer,
  UpdateProfileCommand,
  VerifyOtpAnswer,
  VerifyOtpCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerUserId } from '../lib/booking/caller-roles';
import {
  field,
  isRecord,
  isStoreFailure,
  storeFailure,
  type WireRequest,
} from './wire-read';

/**
 * THE IDENTITY CALLABLES' WIRE (Phase 4a 4A-4) — flipped with the web's
 * `callableClient`: the requests are the call components of `IdentityCall`,
 * the answers theirs, a refusal its ecs-core struct.
 *
 * - **In:** `requestOtpChallenge` `{ identifierChannel, identifier }`
 *   (`identifierChannel` is NEVER refused — `PHONE` is an SMS, anything
 *   else an e-mail), `verifyOtpChallenge` `{ challengeId, code }`,
 *   `completeRegistration` `{ identifierChannel, identifier, fields }` (the
 *   verified caller first, before the payload), `updateProfile`
 *   `{ firstName, lastName, birthDate }` off a verified caller. A payload
 *   the callable cannot read is `IDENTITY_INVALID_INPUT` with today's
 *   `reason` (its `reason` words the field by its new name).
 * - **Out:** `{ challengeId, devCode }` (`devCode` only under the emulator,
 *   else `null`), `{ sessionKind: 'NEW' | 'RETURNING', customToken }`,
 *   `{ customToken }`, `{ changed }`.
 * - **Refusals:** one function per OTP callable turns the pipeline refusals
 *   whose meaning is the callable's own into their successors (an Auth
 *   failure as `IDENTITY_TOKEN_MINTING_FAILURE` /
 *   `IDENTITY_CLAIMS_PROMOTION_FAILURE`, a refused adoption as the token
 *   failure, an identifier as the invalid input it always answered, the
 *   registration's birth date wrapping its cause); every other refusal
 *   leaves as itself. The registration's refused profile leaves as the
 *   aggregate it always was, each nested refusal the successor of its
 *   legacy nested code. A store failure is no refusal: it is thrown, for
 *   the edge to track and answer as the callable's coded
 *   `IDENTITY_REPOSITORY_FAILURE`.
 */

/** A non-blank text field, or `null`. */
function filledText(source: unknown, name: string): string | null {
  const value = field(source, name);
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// ── requestOtpChallenge ─────────────────────────────────────────────────

/**
 * `{ identifierChannel, identifier }` → the command. The channel is never
 * refused (`PHONE` → SMS, anything else → e-mail); a blank `identifier` is
 * `'missing or empty destination'` — checked on the UNTRIMMED text's trim;
 * the text itself is handed on untrimmed for the pipeline's single trim
 * (F2-10).
 */
export function decodeRequestOtp(
  request: WireRequest,
): Result<RequestOtpCommand, EdgeError> {
  const identifier = field(request.data, 'identifier');
  if (typeof identifier !== 'string' || identifier.trim().length === 0) {
    return Result.err(
      IdentityError.invalidInput('missing or empty destination'),
    );
  }
  return Result.ok({
    otpDestinationType:
      field(request.data, 'identifierChannel') === IdentifierChannel.Phone
        ? OtpDestinationType.Sms
        : OtpDestinationType.Email,
    rawDestination: identifier,
  });
}

/**
 * `{ challengeId, devCode }` — `devCode` only when `exposeDevCode` (the root
 * passes the `FUNCTIONS_EMULATOR` gate): there is no inbox for the e2e
 * suite to read a real code from, and production never forwards it.
 */
export function encodeRequestOtpAnswer(
  answer: RequestOtpAnswer,
  exposeDevCode: boolean,
): IdentityCall.RequestOtpAnswer {
  return {
    challengeId: answer.otpId,
    devCode: exposeDevCode ? answer.rawCode : null,
  };
}

/** A `requestOtp` refusal (a store failure thrown). */
export function requestOtpRefusal(error: RequestOtpError): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  if (PipelineError.isPipelineError(error))
    return IdentityError.otpSendFailure();
  if (error.errorCode === IdentityErrorCode.IdentifierInvalid) {
    return IdentityError.invalidInput(
      error.identifierKind === IdentifierChannel.Phone
        ? 'invalid phone destination'
        : 'invalid email destination',
    );
  }
  return error;
}

// ── verifyOtpChallenge ──────────────────────────────────────────────────

/**
 * `{ challengeId, code }` → the command, the refusals in today's order: a
 * blank `challengeId`, then a `code` that is not exactly six ASCII digits
 * (untrimmed — `' 123456'` is refused), then an id that is no document id.
 */
export function decodeVerifyOtp(
  request: WireRequest,
): Result<VerifyOtpCommand, EdgeError> {
  const challengeId = field(request.data, 'challengeId');
  const code = field(request.data, 'code');
  if (typeof challengeId !== 'string' || challengeId.trim().length === 0) {
    return Result.err(IdentityError.invalidInput('missing or empty otpId'));
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return Result.err(
      IdentityError.invalidInput('code must be a 6-digit string'),
    );
  }
  const otpId = OtpId.parse(challengeId);
  if (!otpId.ok) return Result.err(IdentityError.invalidInput('invalid otpId'));
  const otpCode = OtpCode.parse(code);
  if (!otpCode.ok) {
    return Result.err(
      IdentityError.invalidInput('code must be a 6-digit string'),
    );
  }
  return Result.ok({ otpId: otpId.value, code: otpCode.value });
}

/** `{ sessionKind, customToken }` — the SCREAMING `SessionKind`. */
export function encodeVerifyOtpAnswer(
  answer: VerifyOtpAnswer,
): IdentityCall.VerifyOtpAnswer {
  return {
    sessionKind: answer.sessionKind,
    customToken: answer.customToken,
  };
}

/** A `verifyOtp` refusal (a store failure thrown). */
export function verifyOtpRefusal(error: VerifyOtpError): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  if (PipelineError.isPipelineError(error))
    return IdentityError.tokenMintingFailure();
  // A refused adoption answers as a failed provisioning (F2-9).
  if (error.errorCode === IdentityErrorCode.OtpAccountConflict) {
    return IdentityError.tokenMintingFailure();
  }
  return error;
}

// ── completeRegistration ────────────────────────────────────────────────

/** The about step's fields, every key present: a text as sent, anything else not sent. */
function registrationFieldsOf(raw: unknown): RegistrationFields {
  const textOf = (name: RegistrationField): string | null => {
    const value = field(raw, name);
    return typeof value === 'string' ? value : null;
  };
  return {
    [RegistrationField.Phone]: textOf(RegistrationField.Phone),
    [RegistrationField.Email]: textOf(RegistrationField.Email),
    [RegistrationField.FirstName]: textOf(RegistrationField.FirstName),
    [RegistrationField.LastName]: textOf(RegistrationField.LastName),
    [RegistrationField.BirthDate]: textOf(RegistrationField.BirthDate),
  };
}

/**
 * The verified caller first (`IDENTITY_REGISTRATION_UNAUTHENTICATED`, before
 * the payload is read), then the payload checks in today's order: an
 * object, an `identifierChannel` of `PHONE` or `EMAIL`, a non-blank
 * `identifier`, a `fields` object.
 */
export function decodeCompleteRegistration(
  request: WireRequest,
): Result<CompleteRegistrationCommand, EdgeError> {
  const caller = callerUserId(request);
  if (caller === null) {
    return Result.err(IdentityError.registrationUnauthenticated());
  }
  const payload = request.data;
  if (payload === null || typeof payload !== 'object') {
    return Result.err(IdentityError.invalidInput('payload must be an object'));
  }
  const channel = field(payload, 'identifierChannel');
  if (
    channel !== IdentifierChannel.Phone &&
    channel !== IdentifierChannel.Email
  ) {
    return Result.err(
      IdentityError.invalidInput(
        'identifierChannel must be "PHONE" or "EMAIL"',
      ),
    );
  }
  const identifier = filledText(payload, 'identifier');
  if (identifier === null) {
    return Result.err(
      IdentityError.invalidInput('missing or empty identifier'),
    );
  }
  const fields = field(payload, 'fields');
  if (!isRecord(fields)) {
    return Result.err(IdentityError.invalidInput('missing fields'));
  }
  return Result.ok({
    callerUserId: caller,
    identifierChannel: channel,
    rawIdentifier: identifier,
    fields: registrationFieldsOf(fields),
  });
}

/** `{ customToken }`. */
export function encodeCompleteRegistrationAnswer(
  answer: CompleteRegistrationAnswer,
): IdentityCall.CompleteRegistrationAnswer {
  return { customToken: answer.customToken };
}

/** The birth-date refusals — wrapped as `IDENTITY_REGISTRATION_BIRTH_DATE_INVALID`, their cause nested. */
const BIRTH_DATE_CODES: ReadonlySet<string> = new Set([
  IdentityErrorCode.BirthDateInvalid,
  IdentityErrorCode.BirthDateInFuture,
  IdentityErrorCode.BirthDateTooYoung,
  IdentityErrorCode.BirthDateTooOld,
]);

function isBirthDateRefusal(
  error: IdentityError,
): error is IdentityError.BirthDate {
  return BIRTH_DATE_CODES.has(error.errorCode);
}

/**
 * One refusal of the registered profile as its aggregate nests it — each
 * the successor of the legacy nested code: an unsupported country is the
 * invalid phone (`reason: 'invalid-country'`), a birth date in the future
 * the invalid one (`attempted`); every other refusal as itself.
 */
function nestedProfileRefusal(
  error: RegistrationProfileError,
): RegistrationProfileError {
  switch (error.errorCode) {
    case PhoneErrorCode.CountryUnsupported:
      return PhoneError.invalid(
        error.attempted,
        PhoneInvalidReason.InvalidCountry,
      );
    case IdentityErrorCode.BirthDateInFuture:
      return IdentityError.birthDateInvalid(error.attempted);
    default:
      return error;
  }
}

/** A `completeRegistration` refusal (a store failure thrown). */
export function completeRegistrationRefusal(
  error: CompleteRegistrationError,
): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  if (PipelineError.isPipelineError(error))
    return IdentityError.claimsPromotionFailure();
  if (error.errorCode === CompleteRegistrationRefusalCode.ProfileInvalid) {
    return { ...error, errors: error.errors.map(nestedProfileRefusal) };
  }
  if (error.errorCode === IdentityErrorCode.IdentifierInvalid) {
    return IdentityError.invalidInput('invalid identifier value');
  }
  if (isBirthDateRefusal(error)) {
    return IdentityError.registrationBirthDateInvalid([error]);
  }
  return error;
}

// ── updateProfile ───────────────────────────────────────────────────────

/** An edit field: text as sent, absent or `null` as `null` (keep), anything else a refusal. */
type EditField = { readonly text: string | null; readonly valid: boolean };

function editFieldOf(raw: unknown, name: string): EditField {
  const value = field(raw, name);
  if (value === undefined || value === null) return { text: null, valid: true };
  return typeof value === 'string'
    ? { text: value, valid: true }
    : { text: null, valid: false };
}

/**
 * `{ firstName, lastName, birthDate }` (`ProfileEdits`) off a verified
 * caller: no caller → `ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED`; a field
 * present but not text → `ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED`; a
 * `null` field keeps the stored value (there is no clearing).
 */
export function decodeUpdateProfile(
  request: WireRequest,
): Result<UpdateProfileCommand, EdgeError> {
  const caller = callerUserId(request);
  if (caller === null) {
    return Result.err(AccountsError.updateProfileUnauthenticated());
  }
  const firstName = editFieldOf(request.data, 'firstName');
  const lastName = editFieldOf(request.data, 'lastName');
  const birthDate = editFieldOf(request.data, 'birthDate');
  if (!firstName.valid || !lastName.valid || !birthDate.valid) {
    return Result.err(AccountsError.updateProfileValidationFailed());
  }
  return Result.ok({
    callerUserId: caller,
    edits: {
      firstName: firstName.text,
      lastName: lastName.text,
      birthDate: birthDate.text,
    },
  });
}

/** `{ changed }`. */
export function encodeUpdateProfileAnswer(
  answer: UpdateProfileAnswer,
): IdentityCall.UpdateProfileAnswer {
  return { changed: answer.changed };
}

/** An `updateProfile` refusal: its ecs-core code as itself (a store failure thrown). */
export function updateProfileRefusal(error: UpdateProfileError): EdgeError {
  if (isStoreFailure(error)) throw storeFailure(error);
  return error;
}
