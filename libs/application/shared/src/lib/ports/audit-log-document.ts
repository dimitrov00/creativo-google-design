import type { Actor, AuditEntry } from '@creativo/domain/governance';

/**
 * The persisted shape of an `auditLog/{entryId}` row — defined in the port
 * layer because TWO SDKs write it: the browser (the impersonation adapter's
 * batched write) and the Cloud Functions callables (booking mutations, the
 * profile-change trigger). Without one definition the shape exists twice and
 * drifts on the first field either side adds — the exact failure the
 * appointment document already solved this way.
 *
 * Plain objects only, no SDK imports: both sides can produce this.
 */
export const AUDIT_LOG_COLLECTION = 'auditLog';

export function serializeActor(actor: Actor): Record<string, unknown> {
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

export function auditEntryToDocument(
  entry: AuditEntry,
): Record<string, unknown> {
  return {
    actor: serializeActor(entry.actor),
    action: entry.action,
    at: entry.at.toISO(),
    targetUserId: entry.targetUserId?.value ?? null,
    resourceId: entry.resourceId,
    context: entry.context ?? null,
  };
}
