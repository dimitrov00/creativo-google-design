import { logger } from 'firebase-functions';
import { Actor, AuditEntry, AuditEntryId } from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import {
  AUDIT_LOG_COLLECTION,
  auditEntryToDocument,
} from '@creativo/application/shared';
import { adminFirestore } from '../firebase-admin';

/**
 * Append one row to the audit log — "who did what to whom, when", written
 * SERVER-SIDE so the trail cannot be skipped or forged by a client.
 *
 * ### After the mutation, never inside it
 * The entry is written after the transaction commits, not as part of it. An
 * audit row must record what HAPPENED, and a row written inside a
 * transaction that then retries or aborts records what almost happened.
 * The cost is a narrow crash window between commit and log — accepted,
 * because the alternative (a mutation failing because its audit write
 * failed) punishes the user for the log's problem.
 *
 * ### Fire-and-forget, loudly
 * A failed audit write must not fail the action it describes — but it must
 * never be silent either, because a quiet gap in an audit log is worse than
 * no log. It logs at error level, where alerting can find it.
 */
export async function appendAudit(input: {
  readonly actorUserId: string;
  readonly action: string;
  readonly resourceId: string;
  readonly targetUserId?: string;
  readonly atIso: string;
  readonly context?: Readonly<Record<string, string>>;
}): Promise<void> {
  try {
    const actorId = UserId.create(input.actorUserId);
    if (actorId.isFailure()) return;

    const entry = AuditEntry.create({
      id: AuditEntryId.generate().value,
      actor: Actor.user(actorId.value),
      action: input.action,
      atIso: input.atIso,
      targetUserId: input.targetUserId ?? input.actorUserId,
      resourceId: input.resourceId,
      context: input.context,
    });
    if (entry.isFailure()) {
      logger.error('audit entry refused by domain', {
        action: input.action,
        errors: entry.error.map((error) => error.code),
      });
      return;
    }

    await adminFirestore()
      .collection(AUDIT_LOG_COLLECTION)
      .doc(entry.value.id.value)
      .set(auditEntryToDocument(entry.value));
  } catch (error) {
    logger.error('audit write failed', {
      action: input.action,
      resourceId: input.resourceId,
      error: String(error),
    });
  }
}
