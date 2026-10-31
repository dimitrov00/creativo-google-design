import { describe, expect, it } from 'vitest';
import { ImpersonationSessionId, UserId } from '@core/primitives';
import { Actor, ActorRole, SystemSource } from './actor.data';
import { ImpersonationScope } from './impersonation-scope.data';
import { Role } from './role.data';

/*
 * The cases of the legacy governance `actor.spec.ts` (deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), copied over the
 * flat union (`actorForCaller` is `Actor.forCaller`; the free-string system
 * sources are the `SystemSource` dictionary now; every field carries the
 * `actor` prefix and the tag is `actorRole`).
 */
const adminId = UserId.of('admin-1');
const targetId = UserId.of('user-1');
const sid = ImpersonationSessionId.of('sess-1');

const impersonator = (scope: ImpersonationScope) =>
  Actor.impersonator(adminId, targetId, sid, scope);

describe('Actor — constructors and predicates', () => {
  it('Actor.user has actorRole USER and exposes apparentUserId', () => {
    const a = Actor.user(targetId);
    expect(a.actorRole).toBe('USER');
    expect(Actor.apparentUserId(a)).toBe(targetId);
    expect(Actor.isImpersonating(a)).toBe(false);
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.admin has actorRole ADMIN and exposes apparentUserId as the admin', () => {
    const a = Actor.admin(adminId);
    expect(a.actorRole).toBe('ADMIN');
    expect(Actor.apparentUserId(a)).toBe(adminId);
    expect(Actor.isImpersonating(a)).toBe(false);
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.staff carries its roles snapshot and exposes the staff member as apparent', () => {
    const a = Actor.staff(adminId, [Role.Barber, Role.Receptionist]);
    expect(a.actorRole).toBe('STAFF');
    expect(a.actorRoles).toEqual(['barber', 'receptionist']);
    expect(Actor.apparentUserId(a)).toBe(adminId);
    expect(Actor.isImpersonating(a)).toBe(false);
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.staff copies the roles, so a later edit of the source cannot rewrite it', () => {
    const roles: Role[] = [Role.Barber];
    const a = Actor.staff(adminId, roles);
    roles.push(Role.Receptionist);
    expect(a.actorRoles).toEqual(['barber']);
  });

  it('Actor.system has no apparent user and keeps its source tag', () => {
    const a = Actor.system(SystemSource.AdminSdk);
    expect(a).toEqual({ actorRole: 'SYSTEM', actorSystemSource: 'ADMIN_SDK' });
    expect(Actor.apparentUserId(a)).toBeNull();
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.impersonator preserves both admin + target ids and exposes target as apparent', () => {
    const a = impersonator(ImpersonationScope.Write);
    expect(a).toEqual({
      actorRole: ActorRole.Impersonator,
      actorAdminUserId: 'admin-1',
      actorTargetUserId: 'user-1',
      actorSessionId: 'sess-1',
      actorScope: 'WRITE',
    });
    expect(Actor.apparentUserId(a)).toBe(targetId);
    expect(Actor.isImpersonating(a)).toBe(true);
  });

  it('Actor.canMutate is false for a read-only impersonator, true for write', () => {
    expect(Actor.canMutate(impersonator(ImpersonationScope.Read))).toBe(false);
    expect(Actor.canMutate(impersonator(ImpersonationScope.Write))).toBe(true);
  });
});

describe('Actor.isSelfOrSystem — consent-required mutations gate', () => {
  it('returns true for the user themselves', () => {
    expect(Actor.isSelfOrSystem(Actor.user(targetId), targetId)).toBe(true);
  });

  it('returns false for a different user', () => {
    expect(Actor.isSelfOrSystem(Actor.user(adminId), targetId)).toBe(false);
  });

  it('returns true for a system actor regardless of expected user', () => {
    expect(
      Actor.isSelfOrSystem(Actor.system(SystemSource.Fixture), targetId),
    ).toBe(true);
  });

  it('returns true for a staff member acting for themselves', () => {
    expect(
      Actor.isSelfOrSystem(Actor.staff(targetId, [Role.Barber]), targetId),
    ).toBe(true);
  });

  it('returns false for a staff member acting for a client', () => {
    expect(
      Actor.isSelfOrSystem(Actor.staff(adminId, [Role.Receptionist]), targetId),
    ).toBe(false);
  });

  it('returns false for admin (admin should not fill registration on behalf)', () => {
    expect(Actor.isSelfOrSystem(Actor.admin(adminId), targetId)).toBe(false);
  });

  it('returns false for an impersonator of either scope', () => {
    expect(
      Actor.isSelfOrSystem(impersonator(ImpersonationScope.Write), targetId),
    ).toBe(false);
    expect(
      Actor.isSelfOrSystem(impersonator(ImpersonationScope.Read), targetId),
    ).toBe(false);
  });
});

describe('Actor.forCaller — attribution from verified claims', () => {
  it('attributes a plain client as a user', () => {
    expect(Actor.forCaller(targetId, ['client'])).toEqual(Actor.user(targetId));
  });

  it('attributes a caller with no roles at all as a user', () => {
    expect(Actor.forCaller(targetId, [])).toEqual(Actor.user(targetId));
  });

  it('attributes a barber as staff with a snapshot of their roles', () => {
    expect(Actor.forCaller(targetId, ['barber'])).toEqual(
      Actor.staff(targetId, [Role.Barber]),
    );
  });

  it('keeps every staff role in the snapshot and drops the client role', () => {
    expect(
      Actor.forCaller(targetId, ['client', 'receptionist', 'content_manager']),
    ).toEqual(Actor.staff(targetId, [Role.Receptionist, Role.ContentManager]));
  });

  it('attributes an admin as admin, even when they also cut hair', () => {
    expect(Actor.forCaller(adminId, ['barber', 'admin'])).toEqual(
      Actor.admin(adminId),
    );
  });

  it('attributes a sysadmin as staff, the role kept in the snapshot', () => {
    expect(Actor.forCaller(adminId, ['sysadmin'])).toEqual(
      Actor.staff(adminId, [Role.Sysadmin]),
    );
    expect(Actor.forCaller(adminId, ['sysadmin', 'admin'])).toEqual(
      Actor.admin(adminId),
    );
  });

  it('ignores claims that are not roles — they grant nothing and are not recorded', () => {
    expect(Actor.forCaller(targetId, ['superuser', 'barber'])).toEqual(
      Actor.staff(targetId, [Role.Barber]),
    );
    expect(Actor.forCaller(targetId, ['superuser'])).toEqual(
      Actor.user(targetId),
    );
  });
});

describe('SystemSource', () => {
  it('holds today’s stored sources upper-snaked, each once', () => {
    const sources = Object.values(SystemSource);
    expect(new Set(sources).size).toBe(sources.length);
    expect(sources).toContain('LOYALTY_ENGINE');
    expect(sources).toContain('UNATTRIBUTED_API_KEY');
  });

  it('names the sign-in callables apart from an unattributed write (audit-hardening Phase 3, P3-RU-10)', () => {
    expect(SystemSource.IdentityCallable).toBe('IDENTITY_CALLABLE');
    expect(SystemSource.IdentityCallable).not.toBe(
      SystemSource.UnattributedUnauthenticated,
    );
    const a = Actor.system(SystemSource.IdentityCallable);
    expect(a).toEqual({
      actorRole: 'SYSTEM',
      actorSystemSource: 'IDENTITY_CALLABLE',
    });
    expect(Actor.apparentUserId(a)).toBeNull();
  });
});
