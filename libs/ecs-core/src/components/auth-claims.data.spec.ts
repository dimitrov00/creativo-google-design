import { describe, expect, it } from 'vitest';
import { AuthClaims, AuthStage } from './auth-claims.data';
import { IdentityErrorCode } from './identity-errors.data';
import { Role } from './role.data';
import { TenantId } from './tenant-id.data';

/*
 * The cases of libs/domain/identity/src/lib/auth-claims.spec.ts, copied over
 * the in-memory struct: `tenantId` beside `stage`, and `roles: []` on
 * onboarding claims (the token itself omits that key — `toToken`). Roles are
 * now the closed `Role` vocabulary, so the legacy fixture's `'owner'` is
 * `admin` here.
 */
const TENANT = TenantId.of('creativo');

describe('AuthClaims.active', () => {
  it('accepts a non-empty role set', () => {
    expect(AuthClaims.active(TENANT, [Role.Admin])).toEqual({
      ok: true,
      value: { tenantId: 'creativo', stage: 'active', roles: ['admin'] },
    });
  });

  it('rejects an empty role set', () => {
    expect(AuthClaims.active(TENANT, [])).toEqual({
      ok: false,
      error: { code: IdentityErrorCode.AuthClaimsEmptyRoles },
    });
  });

  it('copies the roles, so the caller’s array cannot change the claims', () => {
    const roles: Role[] = [Role.Barber];
    const result = AuthClaims.active(TENANT, roles);
    roles.push(Role.Admin);
    expect(result.ok && result.value.roles).toEqual(['barber']);
  });
});

describe('AuthClaims.onboarding', () => {
  it('carries the tenant, the onboarding stage and no roles', () => {
    expect(AuthClaims.onboarding(TENANT)).toEqual({
      tenantId: 'creativo',
      stage: AuthStage.Onboarding,
      roles: [],
    });
  });
});

describe('AuthClaims.fromToken', () => {
  it('parses a well-formed active claims bag', () => {
    expect(
      AuthClaims.fromToken({
        tenantId: 'creativo',
        stage: 'active',
        roles: ['client'],
      }),
    ).toEqual({ tenantId: 'creativo', stage: 'active', roles: ['client'] });
  });

  it('degrades to onboarding when stage is missing', () => {
    expect(AuthClaims.fromToken({ tenantId: 'creativo' })).toEqual(
      AuthClaims.onboarding(TENANT),
    );
  });

  it('degrades to onboarding when roles is not an array', () => {
    expect(
      AuthClaims.fromToken({
        tenantId: 'creativo',
        stage: 'active',
        roles: 'client',
      }),
    ).toEqual(AuthClaims.onboarding(TENANT));
  });

  it('degrades to onboarding when no known role survives filtering', () => {
    expect(
      AuthClaims.fromToken({
        tenantId: 'creativo',
        stage: 'active',
        roles: [123, '', null, 'owner'],
      }),
    ).toEqual(AuthClaims.onboarding(TENANT));
  });

  it('keeps the known roles of a mixed list, dropping the rest', () => {
    expect(
      AuthClaims.fromToken({
        tenantId: 'creativo',
        stage: 'active',
        roles: ['owner', 'barber', 'admin'],
      }).roles,
    ).toEqual(['barber', 'admin']);
  });

  it('reads a missing or blank tenant as null — a token this app did not mint', () => {
    expect(AuthClaims.fromToken({}).tenantId).toBeNull();
    expect(AuthClaims.fromToken({ tenantId: '  ' }).tenantId).toBeNull();
    expect(AuthClaims.fromToken({ tenantId: 7 }).tenantId).toBeNull();
  });
});

describe('AuthClaims.isActive / hasRole', () => {
  it('only active claims hold roles', () => {
    const active = AuthClaims.fromToken({
      tenantId: 'creativo',
      stage: 'active',
      roles: ['barber'],
    });
    expect(AuthClaims.isActive(active)).toBe(true);
    expect(AuthClaims.hasRole(active, Role.Barber)).toBe(true);
    expect(AuthClaims.hasRole(active, Role.Admin)).toBe(false);
    const onboarding = AuthClaims.onboarding(TENANT);
    expect(AuthClaims.isActive(onboarding)).toBe(false);
    expect(AuthClaims.hasRole(onboarding, Role.Barber)).toBe(false);
  });
});

describe('AuthClaims.toToken', () => {
  const active = (): AuthClaims => {
    const claims = AuthClaims.active(TENANT, [Role.Barber, Role.Admin]);
    if (!claims.ok) throw new Error('fixture');
    return claims.value;
  };

  it('stores active claims as { tenantId, stage, roles }', () => {
    expect(AuthClaims.toToken(active())).toEqual({
      tenantId: 'creativo',
      stage: 'active',
      roles: ['barber', 'admin'],
    });
  });

  it('stores onboarding claims WITHOUT a roles key — today’s token shape', () => {
    const token = AuthClaims.toToken(AuthClaims.onboarding(TENANT));
    expect(token).toEqual({ tenantId: 'creativo', stage: 'onboarding' });
    expect(token).not.toHaveProperty('roles');
  });

  it('leaves a null tenant out rather than storing it', () => {
    const token = AuthClaims.toToken({
      tenantId: null,
      stage: AuthStage.Onboarding,
      roles: [],
    });
    expect(token).toEqual({ stage: 'onboarding' });
    expect(token).not.toHaveProperty('tenantId');
  });

  it('is the inverse of fromToken — fromToken(toToken(c)) is c', () => {
    for (const claims of [active(), AuthClaims.onboarding(TENANT)]) {
      expect(AuthClaims.fromToken(AuthClaims.toToken(claims))).toEqual(claims);
    }
  });

  it('copies the roles, so the token bag cannot change the claims', () => {
    const claims = active();
    const token = AuthClaims.toToken(claims);
    (token['roles'] as Role[]).push(Role.Receptionist);
    expect(claims.roles).toEqual([Role.Barber, Role.Admin]);
  });
});
