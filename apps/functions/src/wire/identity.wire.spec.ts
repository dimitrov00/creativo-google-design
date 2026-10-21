import {
  AuthStrategyKind,
  OtpDestinationType,
  RegistrationField,
  SessionKind,
} from '@core/components';
import {
  AccountsError,
  CompleteRegistrationRefusalCode,
  IdentifierChannel,
  IdentityError,
  OtpId,
  PhoneError,
  PhoneInvalidReason,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/primitives';
import { type EdgeError, toHttpsError } from '../edge';
import type { WireRequest } from './booking.wire';
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
 * THE IDENTITY WIRE, pinned (identity flip (2), F2-3): the status and the
 * `details` every refusal of the three OTP callables leaves with, byte for
 * byte today's — written from the deleted handlers' `toHttpsError` switch
 * tables (`lib` request, verify and registration handlers) before they
 * went, every `reason` string included. The `HttpsError` MESSAGE is not
 * pinned: it is the wire code now, as for every flipped callable.
 */

/** What the client reads of a refusal: the status and the details. */
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
  details: { code: 'invalid_input', params: { reason } },
});

const STORE_DOWN = RepositoryError.readFailed('otps', 'unavailable');

describe('identity wire', () => {
  describe('requestOtpChallenge', () => {
    it('maps a blank destination to invalid-argument and forwards code/params — `missing or empty destination`', () => {
      for (const data of [
        { kind: 'email', value: '   ' },
        { kind: 'email' },
        { kind: 'phone', value: 42 },
        null,
        'not an object',
      ]) {
        expect(refusalOf(decodeRequestOtp(request(data)))).toEqual(
          invalidInput('missing or empty destination'),
        );
      }
    });

    it('never refuses `kind`: `phone` is an SMS, anything else — absent or garbage — an e-mail', () => {
      const of = (kind: unknown) =>
        decodeRequestOtp(request({ kind, value: 'a@b.com' }));
      expect(of('phone')).toEqual({
        ok: true,
        value: {
          otpDestinationType: OtpDestinationType.Sms,
          rawDestination: 'a@b.com',
        },
      });
      for (const kind of ['email', undefined, 'fax', 7, null]) {
        expect(of(kind).ok && of(kind)).toMatchObject({
          value: { otpDestinationType: OtpDestinationType.Email },
        });
      }
    });

    it('hands a padded value on UNTRIMMED, for the pipeline’s single trim (F2-10); channelKey is ignored', () => {
      expect(
        decodeRequestOtp(
          request({ channelKey: 'email:x', kind: 'email', value: ' a@b.com ' }),
        ),
      ).toEqual({
        ok: true,
        value: {
          otpDestinationType: OtpDestinationType.Email,
          rawDestination: ' a@b.com ',
        },
      });
    });

    it('answers { challengeId } — with devCode only behind the emulator gate', () => {
      const answer = { otpId: OtpId.of('otp-1'), rawCode: '123456' };
      expect(encodeRequestOtpAnswer(answer, false)).toEqual({
        challengeId: 'otp-1',
      });
      expect(encodeRequestOtpAnswer(answer, false)).not.toHaveProperty(
        'devCode',
      );
      expect(encodeRequestOtpAnswer(answer, true)).toEqual({
        challengeId: 'otp-1',
        devCode: '123456',
      });
    });

    it('maps the channel mismatch to failed-precondition with its stable code and today’s lowercase params', () => {
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
          code: 'otp_channel_mismatch',
          params: { requested: 'phone', strategyKind: 'email_otp' },
        },
      });
      expect(
        wire(
          requestOtpRefusal(
            IdentityError.otpChannelMismatch(
              IdentifierChannel.Email,
              AuthStrategyKind.PhoneOtp,
            ),
          ),
        ).details,
      ).toEqual({
        code: 'otp_channel_mismatch',
        params: { requested: 'email', strategyKind: 'phone_otp' },
      });
      expect(
        wire(
          requestOtpRefusal(
            IdentityError.otpChannelMismatch(
              IdentifierChannel.Email,
              AuthStrategyKind.EmailLink,
            ),
          ),
        ).details,
      ).toMatchObject({ params: { strategyKind: 'email_link' } });
    });

    it('maps an unparsable destination to invalid-argument with today’s per-channel reason', () => {
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

    it('maps the rate limit to resource-exhausted', () => {
      expect(wire(requestOtpRefusal(IdentityError.otpRateLimited()))).toEqual({
        status: 'resource-exhausted',
        details: { code: 'otp_rate_limited', params: {} },
      });
    });

    it('maps a failed delivery — any other refusal — to internal', () => {
      expect(
        wire(
          requestOtpRefusal(PipelineError.bare(PipelineErrorCode.Unavailable)),
        ),
      ).toEqual({
        status: 'internal',
        details: { code: 'otp_send_failure', params: {} },
      });
    });

    it('throws a store failure for the edge to track and answer as the callable’s repository_failure', () => {
      expect(() => requestOtpRefusal(STORE_DOWN)).toThrow(STORE_DOWN.errorCode);
      expect(wire({ code: 'repository_failure' } as EdgeError)).toEqual({
        status: 'internal',
        details: { code: 'repository_failure', params: {} },
      });
    });

    it('sends the wire code as the message, never a legacy human sentence', () => {
      expect(
        toHttpsError(requestOtpRefusal(IdentityError.otpRateLimited())).message,
      ).toBe('otp_rate_limited');
    });
  });

  describe('verifyOtpChallenge', () => {
    it('maps a blank challenge id to invalid-argument and forwards code/params', () => {
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

    it('answers { sessionKind, customToken } with today’s lowercase kinds', () => {
      expect(
        encodeVerifyOtpAnswer({
          customToken: 't',
          sessionKind: SessionKind.New,
        }),
      ).toEqual({ sessionKind: 'new', customToken: 't' });
      expect(
        encodeVerifyOtpAnswer({
          customToken: 't',
          sessionKind: SessionKind.Returning,
        }),
      ).toEqual({ sessionKind: 'returning', customToken: 't' });
    });

    it.each([
      [IdentityError.otpNotFound(), 'not-found', 'otp_not_found'],
      [
        IdentityError.otpAlreadyConsumed(),
        'failed-precondition',
        'otp_already_consumed',
      ],
      [IdentityError.otpExpired(), 'deadline-exceeded', 'otp_expired'],
      [IdentityError.otpLockedOut(), 'resource-exhausted', 'otp_locked_out'],
      [IdentityError.otpWrongCode(), 'invalid-argument', 'otp_incorrect_code'],
      [
        IdentityError.otpDestinationCorrupted(),
        'internal',
        'otp_destination_corrupted',
      ],
      [IdentityError.otpAccountConflict(), 'internal', 'token_minting_failure'],
      [
        PipelineError.bare(PipelineErrorCode.Unknown),
        'internal',
        'token_minting_failure',
      ],
    ] as const)('maps %o to %s / %s', (error, status, code) => {
      expect(wire(verifyOtpRefusal(error))).toEqual({
        status,
        details: { code, params: {} },
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
        { kind: 'fax' },
        { kind: 'phone', value: '+1', fields: {} },
      ]) {
        expect(refusalOf(decodeCompleteRegistration(request(data)))).toEqual({
          status: 'unauthenticated',
          details: { code: 'registration_unauthenticated', params: {} },
        });
      }
    });

    it('answers today’s payload refusals in today’s order', () => {
      const of = (data: unknown) =>
        refusalOf(decodeCompleteRegistration(request(data, 'uid_1')));
      expect(of(null)).toEqual(invalidInput('payload must be an object'));
      expect(of('text')).toEqual(invalidInput('payload must be an object'));
      expect(of({ kind: 'fax', value: '' })).toEqual(
        invalidInput('kind must be "phone" or "email"'),
      );
      expect(of({ kind: 'phone', value: '  ' })).toEqual(
        invalidInput('missing or empty value'),
      );
      expect(of({ kind: 'phone', value: '+14155552671' })).toEqual(
        invalidInput('missing fields'),
      );
      expect(
        of({ kind: 'phone', value: '+14155552671', fields: null }),
      ).toEqual(invalidInput('missing fields'));
    });

    it('decodes the command — the verified uid, the channel, the raw value, every field present', () => {
      expect(
        decodeCompleteRegistration(
          request(
            {
              kind: 'email',
              value: ' Ada@Example.com ',
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

    it('maps a missing field to invalid-argument with the field', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            IdentityError.registrationFieldMissing('lastName'),
          ),
        ),
      ).toEqual({
        status: 'invalid-argument',
        details: {
          code: 'registration_field_missing',
          params: { field: 'lastName' },
        },
      });
    });

    it('wraps a birth-date refusal, forwarding its reason-specific code and params', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            IdentityError.birthDateInFuture('2030-01-01'),
          ),
        ),
      ).toEqual({
        status: 'invalid-argument',
        details: {
          code: 'registration_birth_date_invalid',
          errors: [
            {
              code: 'identity.birth_date.in_future',
              params: { attempted: '2030-01-01' },
            },
          ],
        },
      });
      expect(
        wire(
          completeRegistrationRefusal(IdentityError.birthDateTooYoung(6, 16)),
        ).details,
      ).toEqual({
        code: 'registration_birth_date_invalid',
        errors: [
          {
            code: 'identity.birth_date.too_young',
            params: { age: 6, minAge: 16 },
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
            code: 'identity.birth_date.invalid',
            params: { attempted: '03.07.1990' },
          },
        ],
      });
    });

    it('maps an unparsable identifier to `invalid identifier value`', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            IdentityError.identifierInvalid(IdentifierChannel.Phone, 'x'),
          ),
        ),
      ).toEqual(invalidInput('invalid identifier value'));
    });

    it('maps not-found and not-yours to failed-precondition — never permission-denied, the OTP client’s lockout', () => {
      expect(
        wire(
          completeRegistrationRefusal(IdentityError.registrationUserNotFound()),
        ),
      ).toEqual({
        status: 'failed-precondition',
        details: { code: 'registration_user_not_found', params: {} },
      });
      expect(
        wire(
          completeRegistrationRefusal(IdentityError.registrationForbidden()),
        ),
      ).toEqual({
        status: 'failed-precondition',
        details: { code: 'registration_forbidden', params: {} },
      });
    });

    it('maps the profile aggregate to invalid-argument with today’s nested accounts codes', () => {
      expect(
        wire(
          completeRegistrationRefusal({
            errorCode: CompleteRegistrationRefusalCode.ProfileInvalid,
            errors: [
              PhoneError.invalid('12', PhoneInvalidReason.TooShort),
              AccountsError.firstNameTooShort('A', 2),
              AccountsError.lastNameTooShort('B', 2),
              AccountsError.emailInvalid('x@'),
              AccountsError.userRoleInvalid('wizard'),
              AccountsError.userRolesEmpty(),
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
              code: 'phone_number_invalid',
              params: { attempted: '12', reason: 'too-short' },
            },
            {
              code: 'accounts.first_name.too_short',
              params: { attempted: 'A', minLength: 2 },
            },
            {
              code: 'accounts.last_name.too_short',
              params: { attempted: 'B', minLength: 2 },
            },
            { code: 'accounts.email.invalid', params: { attempted: 'x@' } },
            {
              code: 'accounts.user_role.invalid',
              params: { attempted: 'wizard' },
            },
            { code: 'accounts.user.roles_empty', params: {} },
            {
              code: 'accounts.birth_date.too_young',
              params: { age: 15, minAge: 16 },
            },
            {
              code: 'accounts.birth_date.too_old',
              params: { age: 121, maxAge: 120 },
            },
          ],
        },
      });
    });

    it('maps a failed mint to internal claims_promotion_failure, and throws a store failure', () => {
      expect(
        wire(
          completeRegistrationRefusal(
            PipelineError.bare(PipelineErrorCode.Unknown),
          ),
        ),
      ).toEqual({
        status: 'internal',
        details: { code: 'claims_promotion_failure', params: {} },
      });
      expect(() => completeRegistrationRefusal(STORE_DOWN)).toThrow();
    });
  });

  describe('updateProfile (a new wire)', () => {
    it('refuses an unauthenticated caller with its own code', () => {
      expect(refusalOf(decodeUpdateProfile(request({})))).toEqual({
        status: 'unauthenticated',
        details: {
          code: 'accounts.update_profile.unauthenticated',
          params: {},
        },
      });
    });

    it('reads each field as text or absent — anything else is a validation failure', () => {
      expect(
        decodeUpdateProfile(request({ firstName: ' Ada ' }, 'uid_1')),
      ).toEqual({
        ok: true,
        value: {
          callerUserId: 'uid_1',
          edits: { firstName: ' Ada ', lastName: null, birthDate: null },
        },
      });
      for (const data of [{ lastName: 7 }, { birthDate: null }]) {
        expect(refusalOf(decodeUpdateProfile(request(data, 'uid_1')))).toEqual({
          status: 'invalid-argument',
          details: {
            code: 'accounts.update_profile.validation_failed',
            params: {},
          },
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
        details: { code: 'accounts.update_profile.not_found', params: {} },
      });
      expect(() => updateProfileRefusal(STORE_DOWN)).toThrow();
    });
  });
});
