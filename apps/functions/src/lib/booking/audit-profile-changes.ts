import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { appendAudit } from './audit';

/** The profile fields whose change is worth a row. Never the values of ALL
 *  fields — the log records THAT and WHAT changed, keyed by name. */
const AUDITED_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'birthDate',
] as const;

/**
 * Every profile change becomes an audit row — whatever wrote it.
 *
 * A TRIGGER rather than instrumentation in each writer, because the writers
 * are plural and one of them is the browser: the profile screen and the
 * booking contact sheet both save through the client SDK, and a client
 * cannot be trusted to log its own actions. The document watcher catches
 * every path, including ones not written yet.
 *
 * The actor is attributed to the profile's OWNER. That is honest for the
 * self-service paths (the only writers today); an admin edit surface, when
 * it exists, must write its own better-attributed entry — and this row still
 * stands as the record that the change happened.
 *
 * Old→new VALUES ride in context deliberately: this log is admin-only (see
 * firestore.rules) and "support says my number changed" is unanswerable
 * from field names alone.
 */
export const auditProfileChanges = onDocumentWritten(
  'users/{uid}',
  async (event) => {
    const before = event.data?.before?.data() ?? {};
    const after = event.data?.after?.data() ?? {};

    const context: Record<string, string> = {};
    for (const field of AUDITED_FIELDS) {
      const was = String(before[field] ?? '');
      const is = String(after[field] ?? '');
      if (was !== is) context[field] = `${was || '∅'} → ${is || '∅'}`;
    }
    if (Object.keys(context).length === 0) return;

    const uid = event.params.uid;
    await appendAudit({
      actorUserId: uid,
      action: event.data?.before?.exists
        ? 'profile.updated'
        : 'profile.created',
      resourceId: `users/${uid}`,
      targetUserId: uid,
      atIso: new Date().toISOString(),
      context,
    });
  },
);
