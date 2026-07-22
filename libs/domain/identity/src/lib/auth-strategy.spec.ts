import { describe, expect, it } from 'vitest';
import {
  authStrategyRequires,
  createAuthStrategy,
  identifierKindForStrategy,
} from './auth-strategy';

function validPhoneOtpInput() {
  return {
    kind: 'phone_otp',
    required: ['phone', 'firstName', 'lastName'],
    policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 90 },
  };
}

describe('createAuthStrategy — phone_otp', () => {
  it('accepts a well-formed phone_otp strategy', () => {
    const result = createAuthStrategy(validPhoneOtpInput());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('phone_otp');
      expect(result.value.required).toEqual(['phone', 'firstName', 'lastName']);
      expect(result.value.policy).toEqual({
        ttlMinutes: 5,
        maxAttempts: 5,
        sessionDays: 90,
      });
    }
  });

  it('derives the identifier kind and required-field check', () => {
    const result = createAuthStrategy(validPhoneOtpInput());
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(identifierKindForStrategy(result.value)).toBe('phone');
    expect(authStrategyRequires(result.value, 'phone')).toBe(true);
    expect(authStrategyRequires(result.value, 'email')).toBe(false);
  });
});

describe('createAuthStrategy — email_otp', () => {
  it('accepts a well-formed email_otp strategy and reports its identifier kind', () => {
    const result = createAuthStrategy({
      kind: 'email_otp',
      required: ['phone', 'email', 'firstName'],
      policy: { ttlMinutes: 10, maxAttempts: 3, sessionDays: 30 },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(identifierKindForStrategy(result.value)).toBe('email');
    }
  });
});

describe('createAuthStrategy — email_link', () => {
  it('accepts a well-formed email_link strategy (no maxAttempts in its policy)', () => {
    const result = createAuthStrategy({
      kind: 'email_link',
      required: ['phone', 'firstName'],
      policy: { ttlMinutes: 15, sessionDays: 60 },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value.kind === 'email_link') {
      expect(result.value.policy).toEqual({ ttlMinutes: 15, sessionDays: 60 });
    }
  });
});

describe('createAuthStrategy — invalid inputs', () => {
  it('rejects an unknown kind', () => {
    const result = createAuthStrategy({
      ...validPhoneOtpInput(),
      kind: 'oauth_google',
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an unknown registration field', () => {
    const result = createAuthStrategy({
      ...validPhoneOtpInput(),
      required: ['phone', 'middleName'],
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty required set', () => {
    const result = createAuthStrategy({
      ...validPhoneOtpInput(),
      required: [],
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a required set missing phone', () => {
    const result = createAuthStrategy({
      ...validPhoneOtpInput(),
      required: ['email', 'firstName'],
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a non-positive-integer policy field', () => {
    const result = createAuthStrategy({
      ...validPhoneOtpInput(),
      policy: { ttlMinutes: 0, maxAttempts: 5, sessionDays: 90 },
    });
    expect(result.isFailure()).toBe(true);
  });

  it('collects every validation error at once', () => {
    const result = createAuthStrategy({
      kind: 'phone_otp',
      required: [],
      policy: { ttlMinutes: -1, maxAttempts: 0, sessionDays: 0 },
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      // one error for the empty required set + three for the policy fields
      expect(result.error.length).toBe(4);
    }
  });
});
