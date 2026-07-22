import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_CLAIMS,
  activeClaims,
  parseAuthClaims,
} from './auth-claims';
import { roleFromPrimitive } from './role';

describe('activeClaims', () => {
  it('accepts a non-empty role set', () => {
    const result = activeClaims([roleFromPrimitive('owner')]);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toEqual({
        stage: 'active',
        roles: [roleFromPrimitive('owner')],
      });
    }
  });

  it('rejects an empty role set', () => {
    expect(activeClaims([]).isFailure()).toBe(true);
  });
});

describe('parseAuthClaims', () => {
  it('parses a well-formed active claims bag', () => {
    const claims = parseAuthClaims({ stage: 'active', roles: ['client'] });
    expect(claims).toEqual({
      stage: 'active',
      roles: [roleFromPrimitive('client')],
    });
  });

  it('degrades to onboarding when stage is missing', () => {
    expect(parseAuthClaims({})).toEqual(ONBOARDING_CLAIMS);
  });

  it('degrades to onboarding when roles is not an array', () => {
    expect(parseAuthClaims({ stage: 'active', roles: 'client' })).toEqual(
      ONBOARDING_CLAIMS,
    );
  });

  it('degrades to onboarding when roles is empty after filtering', () => {
    expect(
      parseAuthClaims({ stage: 'active', roles: [123, '', null] }),
    ).toEqual(ONBOARDING_CLAIMS);
  });
});
