import { type UserRole, UserId } from '@creativo/domain/accounts';
import {
  Actor,
  AuditEntry,
  ImpersonationSessionId,
} from '@creativo/domain/governance';
import { describe, expect, it } from 'vitest';
import { auditEntryToDocument, serializeActor } from './audit-log-document';

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

const ivan = userId('dev-staff-ivan');
const client = userId('dev-client-1');

describe('serializeActor — one persisted shape per actor kind', () => {
  it('writes a system actor as its source', () => {
    expect(serializeActor(Actor.system('profile_trigger'))).toEqual({
      kind: 'system',
      source: 'profile_trigger',
    });
  });

  it('writes a user actor as its uid', () => {
    expect(serializeActor(Actor.user(client))).toEqual({
      kind: 'user',
      userId: 'dev-client-1',
    });
  });

  it('writes a staff actor with its uid and the roles it held at the time', () => {
    expect(
      serializeActor(Actor.staff(ivan, ['barber', 'receptionist'])),
    ).toEqual({
      kind: 'staff',
      userId: 'dev-staff-ivan',
      roles: ['barber', 'receptionist'],
    });
  });

  it('copies the staff roles, so the written row cannot alias the actor', () => {
    const actor = Actor.staff(ivan, ['barber']);
    const written = serializeActor(actor) as { roles: UserRole[] };
    written.roles.push('admin');
    expect(actor.roles).toEqual(['barber']);
  });

  it('writes an admin actor as its uid', () => {
    expect(serializeActor(Actor.admin(ivan))).toEqual({
      kind: 'admin',
      adminUserId: 'dev-staff-ivan',
    });
  });

  it('writes an impersonator with both people, the session and its scope', () => {
    expect(
      serializeActor(
        Actor.impersonator({
          adminUserId: ivan,
          targetUserId: client,
          sessionId: sessionId('sess-1'),
          scope: 'read',
        }),
      ),
    ).toEqual({
      kind: 'impersonator',
      adminUserId: 'dev-staff-ivan',
      targetUserId: 'dev-client-1',
      sessionId: 'sess-1',
      scope: 'read',
    });
  });

  it('serialises only plain JSON values — no class instances reach the SDK', () => {
    const actors: readonly Actor[] = [
      Actor.system('x'),
      Actor.user(client),
      Actor.staff(ivan, ['barber']),
      Actor.admin(ivan),
    ];
    for (const actor of actors) {
      const written = serializeActor(actor);
      expect(JSON.parse(JSON.stringify(written))).toEqual(written);
    }
  });
});

describe('auditEntryToDocument', () => {
  it('writes a staff-attributed row naming the client as the target', () => {
    const entry = AuditEntry.create({
      id: 'audit-1',
      actor: Actor.staff(ivan, ['barber']),
      action: 'booking.staff_arrived',
      atIso: '2026-09-25T08:00:00.000Z',
      targetUserId: 'dev-client-1',
      resourceId: 'appt-1',
    });
    if (entry.isFailure())
      throw new Error('unexpected failure in test fixture');

    const doc = auditEntryToDocument(entry.value);
    expect(doc['actor']).toEqual({
      kind: 'staff',
      userId: 'dev-staff-ivan',
      roles: ['barber'],
    });
    expect(doc['targetUserId']).toBe('dev-client-1');
    expect(doc['resourceId']).toBe('appt-1');
    expect(doc['context']).toBeNull();
    expect(Date.parse(String(doc['at']))).toBe(
      Date.parse('2026-09-25T08:00:00.000Z'),
    );
  });

  it('writes a null target when the act touched no account', () => {
    const entry = AuditEntry.create({
      id: 'audit-2',
      actor: Actor.admin(ivan),
      action: 'booking.staff_created',
      atIso: '2026-09-25T08:00:00.000Z',
      resourceId: 'appt-2',
    });
    if (entry.isFailure())
      throw new Error('unexpected failure in test fixture');

    expect(auditEntryToDocument(entry.value)['targetUserId']).toBeNull();
  });
});
