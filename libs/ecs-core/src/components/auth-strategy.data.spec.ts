import { describe, expect, it } from 'vitest';
import {
  AuthDeployment,
  AuthProvider,
  AuthProviderKind,
  AuthStrategy,
  AuthStrategyKind,
  OAuthProvider,
} from './auth-strategy.data';
import { IdentifierChannel } from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import { RegistrationField } from './registration.data';

/*
 * The cases of the legacy identity `auth-strategy.spec.ts` and
 * `auth-deployment.spec.ts` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1), copied over the flat
 * union and its companion: the tag is `authStrategyKind` (SCREAMING), the TTL a
 * `DurationMinutes` (equal to its plain number at runtime).
 */
function validPhoneOtpInput() {
  return {
    authStrategyKind: 'PHONE_OTP',
    required: ['phone', 'firstName', 'lastName'],
    policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 90 },
  };
}

function strategy(
  input: Parameters<typeof AuthStrategy.parse>[0],
): AuthStrategy {
  const result = AuthStrategy.parse(input);
  if (!result.ok) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('AuthStrategy.parse — phone_otp', () => {
  it('accepts a well-formed phone_otp strategy', () => {
    expect(AuthStrategy.parse(validPhoneOtpInput())).toEqual({
      ok: true,
      value: {
        authStrategyKind: 'PHONE_OTP',
        required: ['phone', 'firstName', 'lastName'],
        policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 90 },
      },
    });
  });

  it('derives the identifier kind and required-field check', () => {
    const parsed = strategy(validPhoneOtpInput());
    expect(AuthStrategy.identifierKind(parsed)).toBe(IdentifierChannel.Phone);
    expect(AuthStrategy.requires(parsed, RegistrationField.Phone)).toBe(true);
    expect(AuthStrategy.requires(parsed, RegistrationField.Email)).toBe(false);
  });
});

describe('AuthStrategy.parse — email_otp', () => {
  it('accepts a well-formed email_otp strategy and reports its identifier kind', () => {
    const parsed = strategy({
      authStrategyKind: 'EMAIL_OTP',
      required: ['phone', 'email', 'firstName'],
      policy: { ttlMinutes: 10, maxAttempts: 3, sessionDays: 30 },
    });
    expect(parsed.authStrategyKind).toBe(AuthStrategyKind.EmailOtp);
    expect(AuthStrategy.identifierKind(parsed)).toBe(IdentifierChannel.Email);
  });
});

describe('AuthStrategy.parse — email_link', () => {
  it('accepts a well-formed email_link strategy (no maxAttempts in its policy)', () => {
    const parsed = strategy({
      authStrategyKind: 'EMAIL_LINK',
      required: ['phone', 'firstName'],
      policy: { ttlMinutes: 15, sessionDays: 60 },
    });
    expect(parsed).toEqual({
      authStrategyKind: 'EMAIL_LINK',
      required: ['phone', 'firstName'],
      policy: { ttlMinutes: 15, sessionDays: 60 },
    });
    expect(AuthStrategy.identifierKind(parsed)).toBe(IdentifierChannel.Email);
  });
});

describe('AuthStrategy.parse — invalid inputs', () => {
  it('rejects an unknown kind', () => {
    expect(
      AuthStrategy.parse({
        ...validPhoneOtpInput(),
        authStrategyKind: 'oauth_google',
      }),
    ).toEqual({
      ok: false,
      error: [
        {
          errorCode: IdentityErrorCode.AuthStrategyUnknownKind,
          received: 'oauth_google',
        },
      ],
    });
  });

  it('rejects an unknown registration field', () => {
    expect(
      AuthStrategy.parse({
        ...validPhoneOtpInput(),
        required: ['phone', 'middleName'],
      }),
    ).toEqual({
      ok: false,
      error: [
        {
          errorCode: IdentityErrorCode.AuthStrategyUnknownField,
          received: 'middleName',
        },
      ],
    });
  });

  it('rejects an empty required set', () => {
    expect(
      AuthStrategy.parse({ ...validPhoneOtpInput(), required: [] }),
    ).toEqual({
      ok: false,
      error: [{ errorCode: IdentityErrorCode.AuthStrategyRequiredEmpty }],
    });
  });

  it('rejects a required set missing phone', () => {
    expect(
      AuthStrategy.parse({
        ...validPhoneOtpInput(),
        required: ['email', 'firstName'],
      }),
    ).toEqual({
      ok: false,
      error: [{ errorCode: IdentityErrorCode.AuthStrategyPhoneMissing }],
    });
  });

  it('rejects a non-positive-integer policy field, naming it', () => {
    expect(
      AuthStrategy.parse({
        ...validPhoneOtpInput(),
        policy: { ttlMinutes: 0, maxAttempts: 5, sessionDays: 90 },
      }),
    ).toEqual({
      ok: false,
      error: [
        {
          errorCode: IdentityErrorCode.AuthStrategyInvalidPolicy,
          field: 'ttlMinutes',
        },
      ],
    });
    expect(
      AuthStrategy.parse({
        authStrategyKind: 'EMAIL_LINK',
        required: ['phone'],
        policy: { ttlMinutes: 15, sessionDays: 1.5 },
      }).ok,
    ).toBe(false);
  });

  it('collects every validation error at once', () => {
    const result = AuthStrategy.parse({
      authStrategyKind: 'PHONE_OTP',
      required: [],
      policy: { ttlMinutes: -1, maxAttempts: 0, sessionDays: 0 },
    });
    expect(result.ok).toBe(false);
    // one error for the empty required set + three for the policy fields
    if (!result.ok) expect(result.error).toHaveLength(4);
  });
});

describe('AuthStrategy.DEFAULT / AuthDeployment.DEFAULT', () => {
  it('the default strategy is exactly what parse accepts for its literal', () => {
    expect(
      AuthStrategy.parse({
        authStrategyKind: 'EMAIL_OTP',
        required: ['phone', 'firstName', 'lastName'],
        policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
      }),
    ).toEqual({ ok: true, value: AuthStrategy.DEFAULT });
  });

  it('wraps the default auth strategy unchanged', () => {
    expect(AuthDeployment.DEFAULT.strategy).toBe(AuthStrategy.DEFAULT);
    // Guard against a silent flip-back: email_otp is the adopted deployment.
    expect(AuthDeployment.DEFAULT.strategy.authStrategyKind).toBe('EMAIL_OTP');
    expect(AuthStrategy.identifierKind(AuthDeployment.DEFAULT.strategy)).toBe(
      'EMAIL',
    );
  });

  it('offers only the OTP entry method today', () => {
    expect(AuthDeployment.DEFAULT.providers).toEqual([
      { authProviderKind: 'OTP' },
    ]);
  });

  it('defaults phone entry to Bulgaria', () => {
    expect(AuthDeployment.DEFAULT.defaultCountry).toBe('BG');
  });

  it('keeps the phone-contact requirement reachable through the deployment', () => {
    expect(AuthDeployment.DEFAULT.strategy.required).toContain('phone');
  });
});

describe('AuthProvider', () => {
  it('otp() is a shared struct; oauth() names the provider', () => {
    expect(AuthProvider.otp()).toBe(AuthProvider.otp());
    expect(AuthProvider.oauth(OAuthProvider.Google)).toEqual({
      authProviderKind: AuthProviderKind.OAuth,
      provider: 'GOOGLE',
    });
  });
});
