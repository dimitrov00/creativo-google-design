import { describe, expect, it } from 'vitest';
import {
  AuthDeployment,
  AuthProvider,
  AuthProviderKind,
  AuthStrategy,
  AuthStrategyKind,
  OAuthProvider,
} from './auth-strategy.data';
import { IdentifierKind } from './identifier.data';
import { IdentityErrorCode } from './identity-errors.data';
import { RegistrationField } from './registration.data';

/*
 * The cases of libs/domain/identity/src/lib/auth-strategy.spec.ts and
 * auth-deployment.spec.ts, copied over the union and its companion.
 */
function validPhoneOtpInput() {
  return {
    kind: 'phone_otp',
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
        kind: 'phone_otp',
        required: ['phone', 'firstName', 'lastName'],
        policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 90 },
      },
    });
  });

  it('derives the identifier kind and required-field check', () => {
    const parsed = strategy(validPhoneOtpInput());
    expect(AuthStrategy.identifierKind(parsed)).toBe(IdentifierKind.Phone);
    expect(AuthStrategy.requires(parsed, RegistrationField.Phone)).toBe(true);
    expect(AuthStrategy.requires(parsed, RegistrationField.Email)).toBe(false);
  });
});

describe('AuthStrategy.parse — email_otp', () => {
  it('accepts a well-formed email_otp strategy and reports its identifier kind', () => {
    const parsed = strategy({
      kind: 'email_otp',
      required: ['phone', 'email', 'firstName'],
      policy: { ttlMinutes: 10, maxAttempts: 3, sessionDays: 30 },
    });
    expect(parsed.kind).toBe(AuthStrategyKind.EmailOtp);
    expect(AuthStrategy.identifierKind(parsed)).toBe(IdentifierKind.Email);
  });
});

describe('AuthStrategy.parse — email_link', () => {
  it('accepts a well-formed email_link strategy (no maxAttempts in its policy)', () => {
    const parsed = strategy({
      kind: 'email_link',
      required: ['phone', 'firstName'],
      policy: { ttlMinutes: 15, sessionDays: 60 },
    });
    expect(parsed).toEqual({
      kind: 'email_link',
      required: ['phone', 'firstName'],
      policy: { ttlMinutes: 15, sessionDays: 60 },
    });
    expect(AuthStrategy.identifierKind(parsed)).toBe(IdentifierKind.Email);
  });
});

describe('AuthStrategy.parse — invalid inputs', () => {
  it('rejects an unknown kind', () => {
    expect(
      AuthStrategy.parse({ ...validPhoneOtpInput(), kind: 'oauth_google' }),
    ).toEqual({
      ok: false,
      error: [
        {
          code: IdentityErrorCode.AuthStrategyUnknownKind,
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
          code: IdentityErrorCode.AuthStrategyUnknownField,
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
      error: [{ code: IdentityErrorCode.AuthStrategyRequiredEmpty }],
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
      error: [{ code: IdentityErrorCode.AuthStrategyPhoneMissing }],
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
          code: IdentityErrorCode.AuthStrategyInvalidPolicy,
          field: 'ttlMinutes',
        },
      ],
    });
    expect(
      AuthStrategy.parse({
        kind: 'email_link',
        required: ['phone'],
        policy: { ttlMinutes: 15, sessionDays: 1.5 },
      }).ok,
    ).toBe(false);
  });

  it('collects every validation error at once', () => {
    const result = AuthStrategy.parse({
      kind: 'phone_otp',
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
        kind: 'email_otp',
        required: ['phone', 'firstName', 'lastName'],
        policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
      }),
    ).toEqual({ ok: true, value: AuthStrategy.DEFAULT });
  });

  it('wraps the default auth strategy unchanged', () => {
    expect(AuthDeployment.DEFAULT.strategy).toBe(AuthStrategy.DEFAULT);
    // Guard against a silent flip-back: email_otp is the adopted deployment.
    expect(AuthDeployment.DEFAULT.strategy.kind).toBe('email_otp');
    expect(AuthStrategy.identifierKind(AuthDeployment.DEFAULT.strategy)).toBe(
      'email',
    );
  });

  it('offers only the OTP entry method today', () => {
    expect(AuthDeployment.DEFAULT.providers).toEqual([{ kind: 'otp' }]);
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
      kind: AuthProviderKind.OAuth,
      provider: 'google',
    });
  });
});
