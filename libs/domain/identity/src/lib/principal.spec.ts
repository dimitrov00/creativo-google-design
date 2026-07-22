import { describe, expect, it } from 'vitest';
import { activeClaims, ONBOARDING_CLAIMS } from './auth-claims';
import { PrincipalId } from './ids';
import {
  ANONYMOUS_PRINCIPAL,
  activePrincipal,
  isActivePrincipal,
  onboardingPrincipal,
  principalFrom,
  principalHasRole,
} from './principal';
import { roleFromPrimitive } from './role';

const uid = PrincipalId.generate();

describe('activePrincipal', () => {
  it('accepts a non-empty role set', () => {
    const result = activePrincipal(uid, [roleFromPrimitive('admin')]);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('active');
    }
  });

  it('rejects an empty role set', () => {
    expect(activePrincipal(uid, []).isFailure()).toBe(true);
  });
});

describe('principalFrom', () => {
  it('returns anonymous for a null session', () => {
    expect(principalFrom(null)).toBe(ANONYMOUS_PRINCIPAL);
  });

  it('returns onboarding for a session whose claims are not active', () => {
    expect(principalFrom({ uid, claims: ONBOARDING_CLAIMS })).toEqual(
      onboardingPrincipal(uid),
    );
  });

  it('returns active with roles for an active-claims session', () => {
    const claimsResult = activeClaims([roleFromPrimitive('owner')]);
    if (claimsResult.isFailure())
      throw new Error('unexpected failure in test fixture');
    const principal = principalFrom({ uid, claims: claimsResult.value });
    expect(principal).toEqual({
      kind: 'active',
      uid,
      roles: [roleFromPrimitive('owner')],
    });
  });
});

describe('isActivePrincipal / principalHasRole', () => {
  it('narrows and checks role membership only for active principals', () => {
    const active = principalFrom({
      uid,
      claims: (() => {
        const result = activeClaims([roleFromPrimitive('owner')]);
        if (result.isFailure())
          throw new Error('unexpected failure in test fixture');
        return result.value;
      })(),
    });
    expect(isActivePrincipal(active)).toBe(true);
    expect(principalHasRole(active, roleFromPrimitive('owner'))).toBe(true);
    expect(principalHasRole(active, roleFromPrimitive('admin'))).toBe(false);
    expect(isActivePrincipal(ANONYMOUS_PRINCIPAL)).toBe(false);
    expect(
      principalHasRole(ANONYMOUS_PRINCIPAL, roleFromPrimitive('owner')),
    ).toBe(false);
  });
});
