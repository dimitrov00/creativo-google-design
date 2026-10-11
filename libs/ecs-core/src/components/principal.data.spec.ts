import { describe, expect, it } from 'vitest';
import { TenantId, UserId } from '../primitives/ids.primitive';
import { AuthClaims } from './auth-claims.data';
import { Principal, PrincipalKind } from './principal.data';
import { Role } from './role.data';

/*
 * The cases of libs/domain/identity/src/lib/principal.spec.ts, copied over
 * the flat union: the legacy `active` principal is `CLIENT` or `STAFF` here,
 * by whether any role is a staff role; `ONBOARDING` is kept for the guards;
 * the tag is `principalKind` and the account is `userId`.
 */
const userId = UserId.of('u-1');
const TENANT = TenantId.of('creativo');

function activeClaims(roles: readonly Role[]): AuthClaims {
  const result = AuthClaims.active(TENANT, roles);
  if (!result.ok) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('Principal.fromClaims', () => {
  it('returns anonymous for a null session', () => {
    expect(Principal.fromClaims(null)).toBe(Principal.anonymous());
    expect(Principal.anonymous()).toEqual({ principalKind: 'ANONYMOUS' });
  });

  it('returns onboarding for a session whose claims are not active', () => {
    expect(
      Principal.fromClaims({ userId, claims: AuthClaims.onboarding(TENANT) }),
    ).toEqual({
      principalKind: 'ONBOARDING',
      userId: 'u-1',
      tenantId: 'creativo',
    });
  });

  it('returns staff with roles for active claims holding a staff role', () => {
    expect(
      Principal.fromClaims({ userId, claims: activeClaims([Role.Admin]) }),
    ).toEqual({
      principalKind: 'STAFF',
      userId: 'u-1',
      roles: ['admin'],
      tenantId: 'creativo',
    });
  });

  it('returns client for active claims holding no staff role', () => {
    expect(
      Principal.fromClaims({ userId, claims: activeClaims([Role.Client]) })
        .principalKind,
    ).toBe(PrincipalKind.Client);
  });

  it('degrades active claims with no tenant to onboarding', () => {
    const claims = AuthClaims.fromToken({ stage: 'active', roles: ['client'] });
    expect(Principal.fromClaims({ userId, claims })).toEqual({
      principalKind: 'ONBOARDING',
      userId: 'u-1',
      tenantId: null,
    });
  });
});

describe('Principal.isActive / hasRole / hasAnyRole', () => {
  it('narrows and checks role membership only for active principals', () => {
    const active = Principal.fromClaims({
      userId,
      claims: activeClaims([Role.Barber, Role.Admin]),
    });
    expect(Principal.isActive(active)).toBe(true);
    expect(Principal.hasRole(active, Role.Admin)).toBe(true);
    expect(Principal.hasRole(active, Role.Receptionist)).toBe(false);
    expect(Principal.isActive(Principal.anonymous())).toBe(false);
    expect(Principal.hasRole(Principal.anonymous(), Role.Admin)).toBe(false);
  });

  it('hasAnyRole is the roles guard: any required role admits', () => {
    const client = Principal.fromClaims({
      userId,
      claims: activeClaims([Role.Client]),
    });
    expect(Principal.hasAnyRole(client, [Role.Admin, Role.Client])).toBe(true);
    expect(Principal.hasAnyRole(client, [Role.Admin, Role.Barber])).toBe(false);
    expect(Principal.hasAnyRole(client, [])).toBe(false);
    const onboarding = Principal.fromClaims({
      userId,
      claims: AuthClaims.onboarding(TENANT),
    });
    expect(Principal.isActive(onboarding)).toBe(false);
    expect(Principal.hasAnyRole(onboarding, [Role.Client])).toBe(false);
  });
});
