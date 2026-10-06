import { type UserRole, UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { Actor, actorForCaller } from './actor';
import { ImpersonationSessionId } from './ids';

function userId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function sessionId(raw: string): ImpersonationSessionId {
  const result = ImpersonationSessionId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const adminId = userId('admin-1');
const targetId = userId('user-1');
const sid = sessionId('sess-1');

describe('Actor — constructors and predicates', () => {
  it('Actor.user has kind user and exposes apparentUserId', () => {
    const a = Actor.user(targetId);
    expect(a.kind).toBe('user');
    expect(Actor.apparentUserId(a)).toBe(targetId);
    expect(Actor.isImpersonating(a)).toBe(false);
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.admin has kind admin and exposes apparentUserId as the admin', () => {
    const a = Actor.admin(adminId);
    expect(a.kind).toBe('admin');
    expect(Actor.apparentUserId(a)).toBe(adminId);
    expect(Actor.isImpersonating(a)).toBe(false);
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.staff carries its roles snapshot and exposes the staff member as apparent', () => {
    const a = Actor.staff(adminId, ['barber', 'receptionist']);
    expect(a.kind).toBe('staff');
    expect(a.roles).toEqual(['barber', 'receptionist']);
    expect(Actor.apparentUserId(a)).toBe(adminId);
    expect(Actor.isImpersonating(a)).toBe(false);
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.staff copies the roles, so a later edit of the source cannot rewrite it', () => {
    const roles: UserRole[] = ['barber'];
    const a = Actor.staff(adminId, roles);
    roles.push('receptionist');
    expect(a.roles).toEqual(['barber']);
  });

  it('Actor.system has no apparent user', () => {
    const a = Actor.system('deadline_cron');
    expect(a.kind).toBe('system');
    expect(Actor.apparentUserId(a)).toBeNull();
    expect(Actor.canMutate(a)).toBe(true);
  });

  it('Actor.impersonator preserves both admin + target ids and exposes target as apparent', () => {
    const a = Actor.impersonator({
      adminUserId: adminId,
      targetUserId: targetId,
      sessionId: sid,
      scope: 'write',
    });
    expect(a.kind).toBe('impersonator');
    expect(Actor.apparentUserId(a)).toBe(targetId);
    expect(Actor.isImpersonating(a)).toBe(true);
  });

  it('Actor.canMutate returns false for a read-only impersonator', () => {
    const reader = Actor.impersonator({
      adminUserId: adminId,
      targetUserId: targetId,
      sessionId: sid,
      scope: 'read',
    });
    expect(Actor.canMutate(reader)).toBe(false);
  });

  it('Actor.canMutate returns true for a write-scope impersonator', () => {
    const writer = Actor.impersonator({
      adminUserId: adminId,
      targetUserId: targetId,
      sessionId: sid,
      scope: 'write',
    });
    expect(Actor.canMutate(writer)).toBe(true);
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
    expect(Actor.isSelfOrSystem(Actor.system('v1_migration'), targetId)).toBe(
      true,
    );
  });

  it('returns true for a staff member acting for themselves', () => {
    expect(
      Actor.isSelfOrSystem(Actor.staff(targetId, ['barber']), targetId),
    ).toBe(true);
  });

  it('returns false for a staff member acting for a client', () => {
    expect(
      Actor.isSelfOrSystem(Actor.staff(adminId, ['receptionist']), targetId),
    ).toBe(false);
  });

  it('returns false for admin (admin should not fill registration on behalf)', () => {
    expect(Actor.isSelfOrSystem(Actor.admin(adminId), targetId)).toBe(false);
  });

  it('returns false for a write-scope impersonator', () => {
    const writer = Actor.impersonator({
      adminUserId: adminId,
      targetUserId: targetId,
      sessionId: sid,
      scope: 'write',
    });
    expect(Actor.isSelfOrSystem(writer, targetId)).toBe(false);
  });

  it('returns false for a read-scope impersonator', () => {
    const reader = Actor.impersonator({
      adminUserId: adminId,
      targetUserId: targetId,
      sessionId: sid,
      scope: 'read',
    });
    expect(Actor.isSelfOrSystem(reader, targetId)).toBe(false);
  });
});

describe('actorForCaller — attribution from verified claims', () => {
  it('attributes a plain client as a user', () => {
    expect(actorForCaller(targetId, ['client'])).toEqual(Actor.user(targetId));
  });

  it('attributes a caller with no roles at all as a user', () => {
    expect(actorForCaller(targetId, [])).toEqual(Actor.user(targetId));
  });

  it('attributes a barber as staff with a snapshot of their roles', () => {
    expect(actorForCaller(targetId, ['barber'])).toEqual(
      Actor.staff(targetId, ['barber']),
    );
  });

  it('keeps every staff role in the snapshot and drops the client role', () => {
    expect(
      actorForCaller(targetId, ['client', 'receptionist', 'content_manager']),
    ).toEqual(Actor.staff(targetId, ['receptionist', 'content_manager']));
  });

  it('attributes an admin as admin, even when they also cut hair', () => {
    expect(actorForCaller(adminId, ['barber', 'admin'])).toEqual(
      Actor.admin(adminId),
    );
  });

  // model.ts: admin only when the role set holds `admin`. The vendor's
  // sysadmin is not the shop's owner, and its rows must not look like one.
  it('attributes a sysadmin as staff, the role kept in the snapshot', () => {
    expect(actorForCaller(adminId, ['sysadmin'])).toEqual(
      Actor.staff(adminId, ['sysadmin']),
    );
    expect(actorForCaller(adminId, ['sysadmin', 'admin'])).toEqual(
      Actor.admin(adminId),
    );
  });

  it('ignores claims that are not roles — they grant nothing and are not recorded', () => {
    expect(actorForCaller(targetId, ['superuser', 'barber'])).toEqual(
      Actor.staff(targetId, ['barber']),
    );
    expect(actorForCaller(targetId, ['superuser'])).toEqual(
      Actor.user(targetId),
    );
  });
});
