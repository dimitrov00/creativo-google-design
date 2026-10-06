import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { ImpersonationPort } from '@creativo/application/governance';
import { RepositoryError } from '@creativo/application/shared';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  ImpersonationEndReason,
  ImpersonationSession,
  ImpersonationSessionId,
  ImpersonationSessionStatus,
} from '@creativo/domain/governance';
import {
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
 * Firestore-backed `ImpersonationPort`. `save()` writes the session
 * document and nothing else. The paired `auditLog` row it used to batch
 * beside it is gone: no client creates audit rows (FIX 1, 2026-09-25 — a
 * trail the people it records can write proves nothing), so that row moves
 * server-side when impersonation ships as a callable. It must name whoever
 * actually acted: the admin who started or ended the session, the admin
 * who revoked it, or the expiry watchdog as a system actor.
 */
@Injectable()
export class FirestoreImpersonationAdapter implements ImpersonationPort {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async save(
    session: ImpersonationSession,
  ): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(
        impersonationSessionDocRef(this.db, session.id),
        toPersistence(session),
      );
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
