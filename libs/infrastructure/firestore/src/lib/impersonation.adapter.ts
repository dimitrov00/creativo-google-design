import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { ImpersonationPort } from '@creativo/application/governance';
import { RepositoryError } from '@creativo/application/shared';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  Actor,
  AuditEntry,
  AuditEntryId,
  ImpersonationEndReason,
  ImpersonationSession,
  ImpersonationSessionId,
  ImpersonationSessionStatus,
} from '@creativo/domain/governance';
import {
  auditLogDocRef,
  impersonationSessionDocRef,
  impersonationSessionsCollection,
} from './firestore-paths';

const INSTANT_ZONE = 'UTC';

function serializeEndReason(reason: ImpersonationEndReason): DocumentData {
  switch (reason.kind) {
    case 'admin_ended':
      return { kind: 'admin_ended', endedBy: reason.endedBy.value };
    case 'expired':
      return { kind: 'expired' };
    case 'revoked_by_security':
      return {
        kind: 'revoked_by_security',
        revokedBy: reason.revokedBy.value,
        notes: reason.notes,
      };
  }
}

function serializeStatus(status: ImpersonationSessionStatus): DocumentData {
  if (status.kind === 'active') {
    return { kind: 'active' };
  }
  return {
    kind: 'ended',
    endedAt: status.endedAt.toISO(),
    reason: serializeEndReason(status.reason),
  };
}

function toPersistence(session: ImpersonationSession): DocumentData {
  return {
    adminUserId: session.adminUserId.value,
    targetUserId: session.targetUserId.value,
    scope: session.scope,
    reason: session.reason,
    startedAt: session.startedAt.toISO(),
    expiresAt: session.expiresAt.toISO(),
    status: serializeStatus(session.status),
  };
}

function parseEndReason(
  raw: DocumentData,
): Result<ImpersonationEndReason, unknown> {
  switch (raw['kind']) {
    case 'admin_ended': {
      const endedByResult = UserId.create(raw['endedBy']);
      if (endedByResult.isFailure()) {
        return fail(endedByResult.error);
      }
      return ok(ImpersonationEndReason.adminEnded(endedByResult.value));
    }
    case 'expired':
      return ok(ImpersonationEndReason.expired());
    case 'revoked_by_security': {
      const revokedByResult = UserId.create(raw['revokedBy']);
      if (revokedByResult.isFailure()) {
        return fail(revokedByResult.error);
      }
      return ok(
        ImpersonationEndReason.revokedBySecurity({
          revokedBy: revokedByResult.value,
          notes: raw['notes'],
        }),
      );
    }
    default:
      return fail(
        new Error(`Unknown impersonation end reason kind: ${raw['kind']}`),
      );
  }
}

function parseStatus(
  raw: DocumentData,
): Result<ImpersonationSessionStatus, unknown> {
  if (raw['kind'] === 'active') {
    return ok(ImpersonationSessionStatus.active());
  }
  const endedAtResult = ZonedDateTime.fromISO(raw['endedAt'], INSTANT_ZONE);
  if (endedAtResult.isFailure()) {
    return fail(endedAtResult.error);
  }
  const reasonResult = parseEndReason(raw['reason']);
  if (reasonResult.isFailure()) {
    return fail(reasonResult.error);
  }
  return ok(
    ImpersonationSessionStatus.ended({
      endedAt: endedAtResult.value,
      reason: reasonResult.value,
    }),
  );
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<ImpersonationSession, RepositoryError> {
  const statusResult = parseStatus(data['status']);
  if (statusResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed impersonation session document',
        statusResult.error,
      ),
    );
  }

  const reconstituted = ImpersonationSession.reconstitute({
    id,
    adminUserId: data['adminUserId'],
    targetUserId: data['targetUserId'],
    scope: data['scope'],
    reason: data['reason'],
    startedAtIso: data['startedAt'],
    expiresAtIso: data['expiresAt'],
    status: statusResult.value,
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed impersonation session document',
        reconstituted.error,
      ),
    );
  }
  return ok(reconstituted.value);
}

/**
 * Who/what to attribute the paired `AuditEntry` to. `active` sessions are
 * always started by the admin themselves; an `ended` session's actor
 * depends on WHO closed it — the admin who ended it, whichever admin
 * revoked it for security reasons, or the system's own expiry watchdog —
 * so the audit trail names the actual responsible party, not just
 * `session.adminUserId` in every case.
 */
function auditActorAndAction(session: ImpersonationSession): {
  actor: Actor;
  action: string;
} {
  if (session.status.kind === 'active') {
    return {
      actor: Actor.admin(session.adminUserId),
      action: 'impersonation.started',
    };
  }
  const reason = session.status.reason;
  switch (reason.kind) {
    case 'admin_ended':
      return {
        actor: Actor.admin(reason.endedBy),
        action: 'impersonation.ended',
      };
    case 'expired':
      return {
        actor: Actor.system('impersonation_expiry_watchdog'),
        action: 'impersonation.ended',
      };
    case 'revoked_by_security':
      return {
        actor: Actor.admin(reason.revokedBy),
        action: 'impersonation.revoked',
      };
  }
}

function buildAuditEntry(session: ImpersonationSession) {
  const { actor, action } = auditActorAndAction(session);
  const at =
    session.status.kind === 'ended'
      ? session.status.endedAt
      : session.startedAt;
  return AuditEntry.create({
    id: AuditEntryId.generate().value,
    actor,
    action,
    atIso: at.toISO(),
    targetUserId: session.targetUserId.value,
    resourceId: session.id.value,
  });
}

function serializeActor(actor: Actor): DocumentData {
  switch (actor.kind) {
    case 'system':
      return { kind: 'system', source: actor.source };
    case 'user':
      return { kind: 'user', userId: actor.userId.value };
    case 'admin':
      return { kind: 'admin', adminUserId: actor.adminUserId.value };
    case 'impersonator':
      return {
        kind: 'impersonator',
        adminUserId: actor.adminUserId.value,
        targetUserId: actor.targetUserId.value,
        sessionId: actor.sessionId.value,
        scope: actor.scope,
      };
  }
}

function toAuditPersistence(entry: AuditEntry): DocumentData {
  return {
    actor: serializeActor(entry.actor),
    action: entry.action,
    at: entry.at.toISO(),
    targetUserId: entry.targetUserId?.value ?? null,
    resourceId: entry.resourceId,
    context: entry.context ?? null,
  };
}

/**
 * Firestore-backed `ImpersonationPort`. `save()` also writes the session's
 * `AuditEntry` in the SAME batched write (`auditLog` collection) — there is
 * no separate application port for audit writes in this phase, so keeping
 * the two atomic is an infrastructure-only decision (see class doc for the
 * actor/action derivation).
 */
@Injectable()
export class FirestoreImpersonationAdapter implements ImpersonationPort {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async save(
    session: ImpersonationSession,
  ): Promise<Result<void, RepositoryError>> {
    const auditEntryResult = buildAuditEntry(session);
    if (auditEntryResult.isFailure()) {
      return fail(
        new RepositoryError(
          'Failed to build audit entry for impersonation session',
          auditEntryResult.error,
        ),
      );
    }

    try {
      const batch = writeBatch(this.db);
      batch.set(
        impersonationSessionDocRef(this.db, session.id),
        toPersistence(session),
      );
      batch.set(
        auditLogDocRef(this.db, auditEntryResult.value.id.value),
        toAuditPersistence(auditEntryResult.value),
      );
      await batch.commit();
      return ok(undefined);
    } catch (error) {
      return fail(
        new RepositoryError('Failed to save impersonation session', error),
      );
    }
  }

  async findById(
    id: ImpersonationSessionId,
  ): Promise<Result<ImpersonationSession | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(impersonationSessionDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return toDomain(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(
        new RepositoryError('Failed to load impersonation session', error),
      );
    }
  }

  async findActiveForAdmin(
    adminUserId: UserId,
  ): Promise<Result<ImpersonationSession | null, RepositoryError>> {
    try {
      const activeQuery = query(
        impersonationSessionsCollection(this.db),
        where('adminUserId', '==', adminUserId.value),
        where('status.kind', '==', 'active'),
        limit(1),
      );
      const snapshot = await getDocs(activeQuery);
      const docSnapshot = snapshot.docs[0];
      if (snapshot.empty || !docSnapshot) {
        return ok(null);
      }
      return toDomain(docSnapshot.id, docSnapshot.data());
    } catch (error) {
      return fail(
        new RepositoryError(
          'Failed to query active impersonation session',
          error,
        ),
      );
    }
  }
}
