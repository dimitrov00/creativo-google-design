import { describe, expect, it } from 'vitest';
import {
  AuthPolicyField,
  IdentityError,
  IdentityErrorCode,
} from './identity-errors.data';
import { IdentifierChannel } from './identifier-channel.data';

describe('IdentityError', () => {
  it('keeps every code in the IDENTITY_ domain, SCREAMING_SNAKE, each once', () => {
    const codes = Object.values(IdentityErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^IDENTITY_[A-Z_]+$/);
  });

  it('spells the translated codes per flatten-spec §4.2 (errors.<errorCode> in en/bg)', () => {
    expect(IdentityErrorCode.IdentifierInvalid).toBe(
      'IDENTITY_IDENTIFIER_INVALID',
    );
    expect(IdentityErrorCode.OtpCodeInvalid).toBe('IDENTITY_OTP_CODE_INVALID');
    expect(IdentityErrorCode.BirthDateInvalid).toBe(
      'IDENTITY_BIRTH_DATE_INVALID',
    );
    expect(IdentityErrorCode.BirthDateInFuture).toBe(
      'IDENTITY_BIRTH_DATE_IN_FUTURE',
    );
    expect(IdentityErrorCode.BirthDateTooYoung).toBe(
      'IDENTITY_BIRTH_DATE_TOO_YOUNG',
    );
    expect(IdentityErrorCode.BirthDateTooOld).toBe(
      'IDENTITY_BIRTH_DATE_TOO_OLD',
    );
  });

  it('the four OTP verdicts carry no payload and are shared structs', () => {
    expect(IdentityError.otpAlreadyConsumed()).toEqual({
      errorCode: 'IDENTITY_OTP_ALREADY_CONSUMED',
    });
    expect(IdentityError.otpExpired()).toEqual({
      errorCode: 'IDENTITY_OTP_EXPIRED',
    });
    expect(IdentityError.otpLockedOut()).toEqual({
      errorCode: 'IDENTITY_OTP_LOCKED_OUT',
    });
    expect(IdentityError.otpWrongCode()).toEqual({
      errorCode: 'IDENTITY_OTP_WRONG_CODE',
    });
    expect(IdentityError.otpWrongCode()).toBe(IdentityError.otpWrongCode());
  });

  it('builds each edge struct with its errorCode and i18n params', () => {
    expect(
      IdentityError.identifierInvalid(IdentifierChannel.Phone, 'nope'),
    ).toEqual({
      errorCode: 'IDENTITY_IDENTIFIER_INVALID',
      identifierKind: 'PHONE',
      attempted: 'nope',
    });
    expect(IdentityError.otpCodeInvalid('12')).toEqual({
      errorCode: 'IDENTITY_OTP_CODE_INVALID',
      attempted: '12',
    });
    expect(IdentityError.birthDateInvalid('2026-02-30')).toEqual({
      errorCode: 'IDENTITY_BIRTH_DATE_INVALID',
      attempted: '2026-02-30',
    });
    expect(IdentityError.birthDateInFuture('2099-01-01')).toEqual({
      errorCode: 'IDENTITY_BIRTH_DATE_IN_FUTURE',
      attempted: '2099-01-01',
    });
    expect(IdentityError.birthDateTooYoung(12, 16)).toEqual({
      errorCode: 'IDENTITY_BIRTH_DATE_TOO_YOUNG',
      age: 12,
      minAge: 16,
    });
    expect(IdentityError.birthDateTooOld(130, 120)).toEqual({
      errorCode: 'IDENTITY_BIRTH_DATE_TOO_OLD',
      age: 130,
      maxAge: 120,
    });
    expect(IdentityError.authClaimsEmptyRoles()).toEqual({
      errorCode: 'IDENTITY_AUTH_CLAIMS_EMPTY_ROLES',
    });
    expect(IdentityError.authStrategyUnknownKind('oauth')).toEqual({
      errorCode: 'IDENTITY_AUTH_STRATEGY_UNKNOWN_KIND',
      received: 'oauth',
    });
    expect(IdentityError.authStrategyUnknownField('middleName')).toEqual({
      errorCode: 'IDENTITY_AUTH_STRATEGY_UNKNOWN_FIELD',
      received: 'middleName',
    });
    expect(IdentityError.authStrategyRequiredEmpty()).toEqual({
      errorCode: 'IDENTITY_AUTH_STRATEGY_REQUIRED_EMPTY',
    });
    expect(IdentityError.authStrategyPhoneMissing()).toEqual({
      errorCode: 'IDENTITY_AUTH_STRATEGY_PHONE_MISSING',
    });
    expect(
      IdentityError.authStrategyInvalidPolicy(AuthPolicyField.TtlMinutes),
    ).toEqual({
      errorCode: 'IDENTITY_AUTH_STRATEGY_INVALID_POLICY',
      field: 'ttlMinutes',
    });
    expect(IdentityError.authFlowInvalidTransition('done', 'back')).toEqual({
      errorCode: 'IDENTITY_AUTH_FLOW_INVALID_TRANSITION',
      from: 'done',
      event: 'back',
    });
    expect(
      IdentityError.onboardingFlowInvalidTransition('entering', 'back'),
    ).toEqual({
      errorCode: 'IDENTITY_ONBOARDING_FLOW_INVALID_TRANSITION',
      from: 'entering',
      event: 'back',
    });
  });

  it('builds the nine pipeline refusals of the identity flip — scalar context only (F2-4)', () => {
    expect(
      IdentityError.otpChannelMismatch(IdentifierChannel.Phone, 'EMAIL_OTP'),
    ).toEqual({
      errorCode: 'IDENTITY_OTP_CHANNEL_MISMATCH',
      requested: 'PHONE',
      authStrategyKind: 'EMAIL_OTP',
    });
    expect(IdentityError.otpRateLimited()).toEqual({
      errorCode: 'IDENTITY_OTP_RATE_LIMITED',
    });
    expect(IdentityError.otpNotFound()).toEqual({
      errorCode: 'IDENTITY_OTP_NOT_FOUND',
    });
    expect(IdentityError.otpDestinationCorrupted()).toEqual({
      errorCode: 'IDENTITY_OTP_DESTINATION_CORRUPTED',
    });
    expect(IdentityError.otpAccountConflict()).toEqual({
      errorCode: 'IDENTITY_OTP_ACCOUNT_CONFLICT',
    });
    expect(IdentityError.registrationUnauthenticated()).toEqual({
      errorCode: 'IDENTITY_REGISTRATION_UNAUTHENTICATED',
    });
    expect(IdentityError.registrationForbidden()).toEqual({
      errorCode: 'IDENTITY_REGISTRATION_FORBIDDEN',
    });
    expect(IdentityError.registrationUserNotFound()).toEqual({
      errorCode: 'IDENTITY_REGISTRATION_USER_NOT_FOUND',
    });
    expect(IdentityError.registrationFieldMissing('firstName')).toEqual({
      errorCode: 'IDENTITY_REGISTRATION_FIELD_MISSING',
      field: 'firstName',
    });
    // None of them is an OTP verdict — `OtpSystem.verify` never answers one.
    expect(IdentityError.isOtp(IdentityError.otpNotFound())).toBe(false);
    expect(IdentityError.isOtp(IdentityError.otpAccountConflict())).toBe(false);
  });

  it('is() narrows by errorCode; isOtp() picks out the four verdicts', () => {
    const error: IdentityError = IdentityError.birthDateTooYoung(12, 16);
    expect(IdentityError.is(error, IdentityErrorCode.BirthDateTooYoung)).toBe(
      true,
    );
    expect(IdentityError.is(error, IdentityErrorCode.OtpExpired)).toBe(false);
    if (IdentityError.is(error, IdentityErrorCode.BirthDateTooYoung)) {
      expect(error.minAge).toBe(16);
    }
    expect(IdentityError.isOtp(IdentityError.otpAlreadyConsumed())).toBe(true);
    expect(IdentityError.isOtp(IdentityError.otpExpired())).toBe(true);
    expect(IdentityError.isOtp(IdentityError.otpLockedOut())).toBe(true);
    expect(IdentityError.isOtp(IdentityError.otpWrongCode())).toBe(true);
    expect(IdentityError.isOtp(error)).toBe(false);
  });
});
