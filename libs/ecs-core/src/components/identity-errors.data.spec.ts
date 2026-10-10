import { describe, expect, it } from 'vitest';
import {
  AuthPolicyField,
  IdentityError,
  IdentityErrorCode,
} from './identity-errors.data';
import { IdentifierKind } from './identifier.data';

describe('IdentityError', () => {
  it('keeps every code in the identity namespace, each once', () => {
    const codes = Object.values(IdentityErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^identity\.[a-z_.]+$/);
  });

  it('keeps the translated codes verbatim (errors.identity.* in en/bg)', () => {
    expect(IdentityErrorCode.IdentifierInvalid).toBe(
      'identity.identifier.invalid',
    );
    expect(IdentityErrorCode.OtpCodeInvalid).toBe('identity.otp_code.invalid');
    expect(IdentityErrorCode.BirthDateInvalid).toBe(
      'identity.birth_date.invalid',
    );
    expect(IdentityErrorCode.BirthDateInFuture).toBe(
      'identity.birth_date.in_future',
    );
    expect(IdentityErrorCode.BirthDateTooYoung).toBe(
      'identity.birth_date.too_young',
    );
    expect(IdentityErrorCode.BirthDateTooOld).toBe(
      'identity.birth_date.too_old',
    );
  });

  it('the four OTP verdicts carry no payload and are shared structs', () => {
    expect(IdentityError.otpAlreadyConsumed()).toEqual({
      code: 'identity.otp.already_consumed',
    });
    expect(IdentityError.otpExpired()).toEqual({
      code: 'identity.otp.expired',
    });
    expect(IdentityError.otpLockedOut()).toEqual({
      code: 'identity.otp.locked_out',
    });
    expect(IdentityError.otpWrongCode()).toEqual({
      code: 'identity.otp.wrong_code',
    });
    expect(IdentityError.otpWrongCode()).toBe(IdentityError.otpWrongCode());
  });

  it('builds each edge struct with its dotted code and i18n params', () => {
    expect(
      IdentityError.identifierInvalid(IdentifierKind.Phone, 'nope'),
    ).toEqual({
      code: 'identity.identifier.invalid',
      identifierKind: 'phone',
      attempted: 'nope',
    });
    expect(IdentityError.otpCodeInvalid('12')).toEqual({
      code: 'identity.otp_code.invalid',
      attempted: '12',
    });
    expect(IdentityError.birthDateInvalid('2026-02-30')).toEqual({
      code: 'identity.birth_date.invalid',
      attempted: '2026-02-30',
    });
    expect(IdentityError.birthDateInFuture('2099-01-01')).toEqual({
      code: 'identity.birth_date.in_future',
      attempted: '2099-01-01',
    });
    expect(IdentityError.birthDateTooYoung(12, 16)).toEqual({
      code: 'identity.birth_date.too_young',
      age: 12,
      minAge: 16,
    });
    expect(IdentityError.birthDateTooOld(130, 120)).toEqual({
      code: 'identity.birth_date.too_old',
      age: 130,
      maxAge: 120,
    });
    expect(IdentityError.authClaimsEmptyRoles()).toEqual({
      code: 'identity.auth_claims.empty_roles',
    });
    expect(IdentityError.authStrategyUnknownKind('oauth')).toEqual({
      code: 'identity.auth_strategy.unknown_kind',
      received: 'oauth',
    });
    expect(IdentityError.authStrategyUnknownField('middleName')).toEqual({
      code: 'identity.auth_strategy.unknown_field',
      received: 'middleName',
    });
    expect(IdentityError.authStrategyRequiredEmpty()).toEqual({
      code: 'identity.auth_strategy.required_empty',
    });
    expect(IdentityError.authStrategyPhoneMissing()).toEqual({
      code: 'identity.auth_strategy.phone_missing',
    });
    expect(
      IdentityError.authStrategyInvalidPolicy(AuthPolicyField.TtlMinutes),
    ).toEqual({
      code: 'identity.auth_strategy.invalid_policy',
      field: 'ttlMinutes',
    });
    expect(IdentityError.authFlowInvalidTransition('done', 'back')).toEqual({
      code: 'identity.auth_flow.invalid_transition',
      from: 'done',
      event: 'back',
    });
    expect(
      IdentityError.onboardingFlowInvalidTransition('entering', 'back'),
    ).toEqual({
      code: 'identity.onboarding_flow.invalid_transition',
      from: 'entering',
      event: 'back',
    });
  });

  it('is() narrows by code; isOtp() picks out the four verdicts', () => {
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
