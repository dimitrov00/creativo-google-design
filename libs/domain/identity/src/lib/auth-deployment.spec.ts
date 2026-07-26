import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTH_DEPLOYMENT } from './auth-deployment';
import {
  DEFAULT_AUTH_STRATEGY,
  identifierKindForStrategy,
} from './auth-strategy';

describe('DEFAULT_AUTH_DEPLOYMENT', () => {
  it('wraps the default auth strategy unchanged', () => {
    expect(DEFAULT_AUTH_DEPLOYMENT.strategy).toBe(DEFAULT_AUTH_STRATEGY);
    // Guard against a silent flip-back: email_otp is the adopted
    // deployment — sign-in over email, phone collected in onboarding.
    expect(DEFAULT_AUTH_DEPLOYMENT.strategy.kind).toBe('email_otp');
    expect(identifierKindForStrategy(DEFAULT_AUTH_DEPLOYMENT.strategy)).toBe(
      'email',
    );
  });

  it('offers only the OTP entry method today', () => {
    expect(DEFAULT_AUTH_DEPLOYMENT.providers).toEqual([{ kind: 'otp' }]);
  });

  it('defaults phone entry to Bulgaria', () => {
    expect(DEFAULT_AUTH_DEPLOYMENT.defaultCountry).toBe('BG');
  });

  it('keeps the phone-contact requirement reachable through the deployment', () => {
    expect(DEFAULT_AUTH_DEPLOYMENT.strategy.required).toContain('phone');
  });
});
