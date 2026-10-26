import {
  AuthStrategyKind,
  OtpDestinationType,
  RegistrationField,
  SessionKind,
} from '@core/components';
import { IdentifierChannel, OtpId } from '@core/primitives';
import {
  AccountsError,
  CompleteRegistrationRefusalCode,
  IdentityError,
  IdentityErrorCode,
  PhoneError,
  PhoneInvalidReason,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/errors';
import { type EdgeError, toHttpsError } from '../edge';
import type { WireRequest } from './wire-read';
import {
  completeRegistrationRefusal,
  decodeCompleteRegistration,
  decodeRequestOtp,
  decodeUpdateProfile,
  decodeVerifyOtp,
  encodeCompleteRegistrationAnswer,
  encodeRequestOtpAnswer,
  encodeUpdateProfileAnswer,
  encodeVerifyOtpAnswer,
  requestOtpRefusal,
  updateProfileRefusal,
  verifyOtpRefusal,
} from './identity.wire';

/*
 * THE IDENTITY WIRE, flipped (Phase 4a 4A-4): the requests are the call
 * components of `IdentityCall` (`identifierChannel` + `identifier`, never
 * the legacy `kind` + `value`), the answers theirs (`sessionKind`
 * SCREAMING, `devCode: null` outside the emulator), every refusal the
 * ecs-core struct projected by its code's allowlist — the status kept one
 * for one (the OTP client's retry, lockout and blocked paths read it), the
 * `reason` strings of `IDENTITY_INVALID_INPUT` as the legacy handlers wrote
 * them, renamed fields by their new names.
 */

/** What the client reads of a refusal: the status, the message and the details. */
function wire(error: EdgeError): {
  readonly status: string;
  readonly details: unknown;
} {
  const thrown = toHttpsError(error);
  return { status: thrown.code, details: thrown.details };
}

/** A decoder's refusal, as it leaves. */
function refusalOf<T>(
  decoded:
    | { readonly ok: true; readonly value: T }
    | {
        readonly ok: false;
        readonly error: EdgeError;
      },
) {
  if (decoded.ok) throw new Error('expected a refusal');
  return wire(decoded.error);
}

const request = (data: unknown, uid: string | null = null): WireRequest => ({
  data,
  ...(uid === null ? {} : { auth: { uid, token: {} } }),
});

const invalidInput = (reason: string) => ({
  status: 'invalid-argument',
  details: { errorCode: IdentityErrorCode.InvalidInput, reason },
});

const STORE_DOWN = RepositoryError.readFailed('otps', 'unavailable');

describe('identity wire', () => {
  describe('requestOtpChallenge', () => {
    it('refuses a blank identifier as invalid-argument — `missing or empty destination`', () => {
      for (const data of [
        { identifierChannel: IdentifierChannel.Email, identifier: '   ' },
        { identifierChannel: IdentifierChannel.Email },
        { identifierChannel: IdentifierChannel.Phone, identifier: 42 },
        // The legacy `{ kind, value }` is no request the flipped wire reads.
        { kind: 'email', value: 'a@b.com' },
        null,
        'not an object',
      ]) {
        expect(refusalOf(decodeRequestOtp(request(data)))).toEqual(
          invalidInput('missing or empty destination'),
        );
      }
    });

    it('never refuses `identifierChannel`: `PHONE` is an SMS, anything else — absent, legacy or garbage — an e-mail', () => {
      const of = (identifierChannel: unknown) =>
        decodeRequestOtp(request({ identifierChannel, identifier: 'a@b.com' }));
      expect(of(IdentifierChannel.Phone)).toEqual({
        ok: true,
        value: {
          otpDestinationType: OtpDestinationType.Sms,
          rawDestination: 'a@b.com',
        },
      });
      for (const channel of [
        IdentifierChannel.Email,
        'phone',
        undefined,
        'fax',
        7,
        null,
      ]) {
        expect(of(channel).ok && of(channel)).toMatchObject({
          value: { otpDestinationType: OtpDestinationType.Email },
        });
      }
    });

    it('hands a padded identifier on UNTRIMMED, for the pipeline’s single trim (F2-10)', () => {
      expect(
        decodeRequestOtp(
          request({
            identifierChannel: IdentifierChannel.Email,
            identifier: ' a@b.com ',
          }),
        ),
      ).toEqual({
        ok: true,
        value: {
          otpDestinationType: OtpDestinationType.Email,
          rawDestination: ' a@b.com ',
        },
      });
    });

    it('answers { challengeId, devCode } — the code only behind the emulator gate, else `null`', () => {
      const answer = { otpId: OtpId.of('otp-1'), rawCode: '123456' };
      expect(encodeRequestOtpAnswer(answer, false)).toEqual({
        challengeId: 'otp-1',
        devCode: null,
      });
      expect(encodeRequestOtpAnswer(answer, true)).toEqual({
        challengeId: 'otp-1',
        devCode: '123456',
      });
    });

    it('lets the channel mismatch leave as its struct: the channel asked for and the strategy, by their own names and values', () => {
      expect(
        wire(
          requestOtpRefusal(
            IdentityError.otpChannelMismatch(
              IdentifierChannel.Phone,
              AuthStrategyKind.EmailOtp,
            ),
          ),
        ),
      ).toEqual({
        status: 'failed-precondition',
        details: {
          errorCode: IdentityErrorCode.OtpChannelMismatch,
          requested: IdentifierChannel.Phone,
          authStrategyKind: AuthStrategyKind.EmailOtp,
        },
      });
    });

    it('answers an unparsable destination as invalid-argument with the per-channel reason', () => {
      expect(
        wire(
          requestOtpRefusal(
            IdentityError.identifierInvalid(IdentifierChannel.Phone, '0888'),
          ),
        ),
      ).toEqual(invalidInput('invalid phone destination'));
      expect(
        wire(
          requestOtpRefusal(
            IdentityError.identifierInvalid(IdentifierChannel.Email, 'x'),
          ),
        ),
      ).toEqual(invalidInput('invalid email destination'));
    });

    it('lets the rate limit leave as `resource-exhausted`, carrying the seconds left (OR-9)', () => {
      expect(wire(requestOtpRefusal(IdentityError.otpRateLimited(42)))).toEqual(
        {
          status: 'resource-exhausted',
          details: {
            errorCode: IdentityErrorCode.OtpRateLimited,
            retryAfterSeconds: 42,
          },
        },
      );
    });

    it('answers a failed delivery as internal IDENTITY_OTP_SEND_FAILURE', () => {
      expect(
        wire(
          requestOtpRefusal(PipelineError.bare(PipelineErrorCode.Unavailable)),
        ),
      ).toEqual({
        status: 'internal',
        details: { errorCode: IdentityErrorCode.OtpSendFailure },
      });
    });

    it('lets the deployed sender’s refusal leave as its own failed-precondition IDENTITY_OTP_SEND_UNAVAILABLE — never collapsed to IDENTITY_OTP_SEND_FAILURE (WS-0)', () => {
      const unavailable = wire(
        requestOtpRefusal(IdentityError.otpSendUnavailable()),
      );
      expect(unavailable).toEqual({
        status: 'failed-precondition',
        details: { errorCode: IdentityErrorCode.OtpSendUnavailable },
      });
      // Never the lockout's status, never the retryable failure's code.
      expect(unavailable.status).not.toBe('permission-denied');
      expect(unavailable.details).not.toEqual({
        errorCode: IdentityErrorCode.OtpSendFailure,
      });
      // A failed delivery still collapses, as before.
      expect(
        wire(requestOtpRefusal(PipelineError.bare(PipelineErrorCode.Unknown))),
      ).toEqual({
        status: 'internal',
        details: { errorCode: IdentityErrorCode.OtpSendFailure },
      });
    });

    it('throws a store failure for the edge to track and answer as the callable’s IDENTITY_REPOSITORY_FAILURE', () => {
      expect(() => requestOtpRefusal(STORE_DOWN)).toThrow(STORE_DOWN.errorCode);
      expect(wire(IdentityError.repositoryFailure())).toEqual({
        status: 'internal',
        details: { errorCode: IdentityErrorCode.RepositoryFailure },
      });
    });

    it('sends the errorCode as the message, never a legacy human sentence', () => {
      expect(
        toHttpsError(requestOtpRefusal(IdentityError.otpRateLimited(42)))
          .message,
      ).toBe(IdentityErrorCode.OtpRateLimited);
    });
  });

  describe('verifyOtpChallenge', () => {
    it('refuses a blank challenge id', () => {
      for (const data of [
        { code: '123456' },
        { challengeId: '  ', code: '123456' },
        null,
      ]) {
        expect(refusalOf(decodeVerifyOtp(request(data)))).toEqual(
          invalidInput('missing or empty otpId'),
        );
      }
    });

    it('refuses a code that is not exactly six ASCII digits — untrimmed, as today', () => {
      for (const code of [
        '12345',
        '1234567',
        ' 123456',
        '12a456',
        123456,
        null,
      ]) {
        expect(
          refusalOf(decodeVerifyOtp(request({ challengeId: 'otp-1', code }))),
        ).toEqual(invalidInput('code must be a 6-digit string'));
      }
    });

    it('refuses an id that is no document id', () => {
      expect(
        refusalOf(
          decodeVerifyOtp(request({ challengeId: 'a/b', code: '123456' })),
        ),
      ).toEqual(invalidInput('invalid otpId'));
    });

    it('decodes { challengeId, code } into the command', () => {
      expect(
        decodeVerifyOtp(request({ challengeId: 'otp-1', code: '042917' })),
      ).toEqual({ ok: true, value: { otpId: 'otp-1', code: '042917' } });
    });

    it('answers { sessionKind, customToken } with the SCREAMING kinds', () => {
      expect(
        encodeVerifyOtpAnswer({
          customToken: 't',
          sessionKind: SessionKind.New,
        }),
      ).toEqual({ sessionKind: 'NEW', customToken: 't' });
      expect(
        encodeVerifyOtpAnswer({
          customToken: 't',
          sessionKind: SessionKind.Returning,
        }),
      ).toEqual({ sessionKind: 'RETURNING', customToken: 't' });
    });

    it.each([
      [IdentityError.otpNotFound(), 'not-found', IdentityErrorCode.OtpNotFound],
      [
        IdentityError.otpAlreadyConsumed(),
        'failed-precondition',
        IdentityErrorCode.OtpAlreadyConsumed,
      ],
      [
        IdentityError.otpExpired(),
        'deadline-exceeded',
        IdentityErrorCode.OtpExpired,
      ],
      [
        IdentityError.otpLockedOut(),
        'resource-exhausted',
        IdentityErrorCode.OtpLockedOut,
      ],
      [
        IdentityError.otpWrongCode(),
        'invalid-argument',
        IdentityErrorCode.OtpWrongCode,
      ],
      [
        IdentityError.otpDestinationCorrupted(),
        'internal',
        IdentityErrorCode.OtpDestinationCorrupted,
      ],
      [
        IdentityError.otpAccountConflict(),
        'internal',
        IdentityErrorCode.TokenMintingFailure,
      ],
      [
        PipelineError.bare(PipelineErrorCode.Unknown),
        'internal',
        IdentityErrorCode.TokenMintingFailure,
      ],
    ] as const)('answers %o as %s / %s', (error, status, errorCode) => {
      expect(wire(verifyOtpRefusal(error))).toEqual({
        status,
        details: { errorCode },
      });
    });

    it('throws a store failure', () => {
      expect(() => verifyOtpRefusal(STORE_DOWN)).toThrow();
    });
  });

  describe('completeRegistration', () => {
    it('refuses an unauthenticated caller before reading the payload', () => {
      for (const data of [
        null,
        { identifierChannel: 'FAX' },
        {
          identifierChannel: IdentifierChannel.Phone,
          identifier: '+1',
          fields: {},
        },
      ]) {
        expect(refusalOf(decodeCompleteRegistration(request(data)))).toEqual({
          status: 'unauthenticated',
          details: {
            errorCode: IdentityErrorCode.RegistrationUnauthenticated,
          },
        });
      }
    });

    it('answers the payload refusals in today’s order, each reason naming the field by its new name', () => {
      const of = (data: unknown) =>
        refusalOf(decodeCompleteRegistration(request(data, 'uid_1')));
      expect(of(null)).toEqual(invalidInput('payload must be an object'));
      expect(of('text')).toEqual(invalidInput('payload must be an object'));
      for (const identifierChannel of ['FAX', 'phone', undefined]) {
        expect(of({ identifierChannel, identifier: '' })).toEqual(
          invalidInput('identifierChannel must be "PHONE" or "EMAIL"'),
        );
      }
      expect(
        of({ identifierChannel: IdentifierChannel.Phone, identifier: '  ' }),
      ).toEqual(invalidInput('missing or empty identifier'));
      expect(
        of({
          identifierChannel: IdentifierChannel.Phone,
          identifier: '+14155552671',
        }),
      ).toEqual(invalidInput('missing fields'));
      expect(
        of({
          identifierChannel: IdentifierChannel.Phone,
          identifier: '+14155552671',
          fields: null,
        }),
      ).toEqual(invalidInput('missing fields'));
    });

    it('decodes the command — the verified uid, the channel, the raw identifier, every field present', () => {
      expect(
        decodeCompleteRegistration(
          request(
            {
              identifierChannel: IdentifierChannel.Email,
              identifier: ' Ada@Example.com ',
              fields: { firstName: 'Ada', lastName: 'Lovelace', phone: 7 },
            },
            'uid_1',
          ),
        ),
      ).toEqual({
        ok: true,
        value: {
          callerUserId: 'uid_1',
          identifierChannel: IdentifierChannel.Email,
          rawIdentifier: ' Ada@Example.com ',
          fields: {
            [RegistrationField.Phone]: null,
            [RegistrationField.Email]: null,
            [RegistrationField.FirstName]: 'Ada',
            [RegistrationField.LastName]: 'Lovelace',
            [RegistrationField.BirthDate]: null,
          },
        },
      });
    });

    it('answers { customToken }', () => {
      expect(encodeCompleteRegistrationAnswer({ customToken: 't' })).toEqual({
        customToken: 't',
      });
    });

    it('lets a missing field leave as invalid-argument naming the field', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            IdentityError.registrationFieldMissing('lastName'),
          ),
        ),
      ).toEqual({
        status: 'invalid-argument',
        details: {
          errorCode: IdentityErrorCode.RegistrationFieldMissing,
          field: 'lastName',
        },
      });
    });

    it('wraps a birth-date refusal as `{ errorCode, errors }`, its cause projected by its own row — a date in the future the invalid one', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            IdentityError.birthDateInFuture('2030-01-01'),
          ),
        ),
      ).toEqual({
        status: 'invalid-argument',
        details: {
          errorCode: IdentityErrorCode.RegistrationBirthDateInvalid,
          errors: [
            {
              errorCode: IdentityErrorCode.BirthDateInFuture,
              attempted: '2030-01-01',
            },
          ],
        },
      });
      expect(
        wire(
          completeRegistrationRefusal(IdentityError.birthDateTooYoung(6, 16)),
        ).details,
      ).toEqual({
        errorCode: IdentityErrorCode.RegistrationBirthDateInvalid,
        errors: [
          {
            errorCode: IdentityErrorCode.BirthDateTooYoung,
            age: 6,
            minAge: 16,
          },
        ],
      });
      expect(
        wire(
          completeRegistrationRefusal(
            IdentityError.birthDateInvalid('03.07.1990'),
          ),
        ).details,
      ).toMatchObject({
        errors: [
          {
            errorCode: IdentityErrorCode.BirthDateInvalid,
            attempted: '03.07.1990',
          },
        ],
      });
    });

    it('answers an unparsable identifier as `invalid identifier value`', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            IdentityError.identifierInvalid(IdentifierChannel.Phone, 'x'),
          ),
        ),
      ).toEqual(invalidInput('invalid identifier value'));
    });

    it('lets not-found and not-yours leave as failed-precondition — never permission-denied, the OTP client’s lockout', () => {
      expect(
        wire(
          completeRegistrationRefusal(IdentityError.registrationUserNotFound()),
        ),
      ).toEqual({
        status: 'failed-precondition',
        details: { errorCode: IdentityErrorCode.RegistrationUserNotFound },
      });
      expect(
        wire(
          completeRegistrationRefusal(IdentityError.registrationForbidden()),
        ),
      ).toEqual({
        status: 'failed-precondition',
        details: { errorCode: IdentityErrorCode.RegistrationForbidden },
      });
    });

    it('answers the profile aggregate as `{ errors }`, each nested refusal projected — an unsupported country the invalid phone, a future birth date the invalid one', () => {
      expect(
        wire(
          completeRegistrationRefusal({
            errorCode: CompleteRegistrationRefusalCode.ProfileInvalid,
            errors: [
              PhoneError.invalid('12', PhoneInvalidReason.TooShort),
              PhoneError.countryUnsupported('+999'),
              AccountsError.firstNameTooShort('A', 2),
              AccountsError.lastNameTooShort('B', 2),
              AccountsError.emailInvalid('x@'),
              AccountsError.userRoleInvalid('wizard'),
              AccountsError.userRolesEmpty(),
              IdentityError.birthDateInFuture('2031-01-01'),
              IdentityError.birthDateTooYoung(15, 16),
              IdentityError.birthDateTooOld(121, 120),
            ],
          }),
        ),
      ).toEqual({
        status: 'invalid-argument',
        details: {
          errors: [
            {
              errorCode: 'PHONE_INVALID',
              attempted: '12',
              reason: 'too-short',
            },
            {
              errorCode: 'PHONE_INVALID',
              attempted: '+999',
              reason: PhoneInvalidReason.InvalidCountry,
            },
            {
              errorCode: 'ACCOUNTS_FIRST_NAME_TOO_SHORT',
              attempted: 'A',
              minLength: 2,
            },
            {
              errorCode: 'ACCOUNTS_LAST_NAME_TOO_SHORT',
              attempted: 'B',
              minLength: 2,
            },
            { errorCode: 'ACCOUNTS_EMAIL_INVALID', attempted: 'x@' },
            { errorCode: 'ACCOUNTS_USER_ROLE_INVALID', attempted: 'wizard' },
            { errorCode: 'ACCOUNTS_USER_ROLES_EMPTY' },
            {
              errorCode: IdentityErrorCode.BirthDateInvalid,
              attempted: '2031-01-01',
            },
            {
              errorCode: IdentityErrorCode.BirthDateTooYoung,
              age: 15,
              minAge: 16,
            },
            {
              errorCode: IdentityErrorCode.BirthDateTooOld,
              age: 121,
              maxAge: 120,
            },
          ],
        },
      });
    });

    it('answers a failed mint as internal IDENTITY_CLAIMS_PROMOTION_FAILURE, and throws a store failure', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            PipelineError.bare(PipelineErrorCode.Unknown),
          ),
        ),
      ).toEqual({
        status: 'internal',
        details: { errorCode: IdentityErrorCode.ClaimsPromotionFailure },
      });
      expect(() => completeRegistrationRefusal(STORE_DOWN)).toThrow();
    });
  });

  describe('updateProfile', () => {
    it('refuses an unauthenticated caller with its own code', () => {
      expect(refusalOf(decodeUpdateProfile(request({})))).toEqual({
        status: 'unauthenticated',
        details: { errorCode: 'ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED' },
      });
    });

    it('reads each field as text, or `null`/absent as keep (an optional key is present with `null`, 4A-4) — anything else a validation failure', () => {
      expect(
        decodeUpdateProfile(
          request(
            { firstName: ' Ada ', lastName: null, birthDate: null },
            'uid_1',
          ),
        ),
      ).toEqual({
        ok: true,
        value: {
          callerUserId: 'uid_1',
          edits: { firstName: ' Ada ', lastName: null, birthDate: null },
        },
      });
      expect(
        decodeUpdateProfile(request({ firstName: 'Ada' }, 'uid_1')),
      ).toMatchObject({ ok: true, value: { edits: { birthDate: null } } });
      for (const data of [{ lastName: 7 }, { birthDate: {} }]) {
        expect(refusalOf(decodeUpdateProfile(request(data, 'uid_1')))).toEqual({
          status: 'invalid-argument',
          details: { errorCode: 'ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED' },
        });
      }
    });

    it('answers { changed }, and its refusals as themselves', () => {
      expect(encodeUpdateProfileAnswer({ changed: false })).toEqual({
        changed: false,
      });
      expect(
        wire(updateProfileRefusal(AccountsError.updateProfileNotFound())),
      ).toEqual({
        status: 'not-found',
        details: { errorCode: 'ACCOUNTS_UPDATE_PROFILE_NOT_FOUND' },
      });
      expect(() => updateProfileRefusal(STORE_DOWN)).toThrow();
    });
  });
});
