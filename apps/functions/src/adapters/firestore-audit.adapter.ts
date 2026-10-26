import type {
  DocumentData,
  DocumentReference,
  Firestore,
} from 'firebase-admin/firestore';
import { Result, type AuditEntryId, AuditResourceId } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type AuditEntry, Collections, QueryOp } from '@core/entities';
import type { AuditPorts, TelemetryPorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';

/**
 * The audit log's writes and its one reader (`governance.port.ts`, flip 1
 * §3.3). The document body IS the flat `AuditEntry` minus `id` (Law 5):
 * the planner (`AuditSystem.plan`) built every field and the pipeline
 * derived the id (`hash(AuditSystem.rowBasis(…))`), so this adapter writes
 * what it is given — no mapping, no business logic.
 *
 * - `appendAudit` — the ONE after-commit audit write left: the operator
 *   backfill's per-CALL row (audit-hardening L2 — one call is many commits
 *   and a job document, so there is no single commit to join). Each row is
 *   CREATED, never set: a replay of the same logical change derives the
 *   same ids, and ALREADY_EXISTS is the answer "already logged", not an
 *   error. The rows go in one batch (an act is logged for everybody or for
 *   nobody); when the batch meets a row already there, the rows are created
 *   one by one so a replay that names somebody the first call did not still
 *   gets that one row, and no row the first call wrote is rewritten. NEVER
 *   fatal and never silent: any other failure is logged at error level and
 *   the call's answer stands.
 * - `createAuditRows` — the profile trigger's only write: the same
 *   deterministic-id `create()`s, ALREADY_EXISTS a success, but a real
 *   failure IS answered (a `RepositoryError` value) so the trigger's retry
 *   can deliver the row.
 * - `auditActionsFor` — every row filed against the given appointment ids
 *   (`resourceId in`, chunks of 30, single-field): the backfill's read.
 *
 * A row that must commit together with its act is not written here: the
 * seven booking verbs' rows (book, reschedule, staff edit, cancel,
 * transition, arrival, tip), an owner's own profile edit's and a streak
 * publish's are `WriteOp.create` entries of that act's own `CommitPlan`
 * (audit-hardening WS-1, `AuditSystem.commitWrites` / `createsOf`) — they
 * land with the act or not at all.
 */

/** Firestore's `in` takes at most 30 values per query. */
const IN_CHUNK = 30;

/** Firestore's canonical name for gRPC 6, as `TriggerAttemptSystem.failureCode` reads it. */
const ALREADY_EXISTS = 'already-exists';

const isAlreadyExists = (error: unknown): boolean =>
  TriggerAttemptSystem.failureCode(error) === ALREADY_EXISTS;

/** The stored body of a row — the entity minus its id (Law 5). */
function bodyOf(row: AuditEntry): DocumentData {
  const { id: _id, ...body } = row;
  return body;
}

/** Where a row lives, by the id its planner derived. */
const auditRowRef = (db: Firestore, id: AuditEntryId): DocumentReference =>
  db.collection(Collections.AuditLog).doc(id);

/** Creates each row on its own, ALREADY_EXISTS being "already there". */
async function createEach(
  db: Firestore,
  rows: readonly AuditEntry[],
): Promise<void> {
  await Promise.all(
    rows.map(async (row) => {
      try {
        await auditRowRef(db, row.id).create(bodyOf(row));
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    }),
  );
}

export const firestoreAuditPorts = (
  db: Firestore,
  telemetry: TelemetryPorts,
): AuditPorts => ({
  appendAudit: async (rows) => {
    if (rows.length === 0) return;
    try {
      const batch = db.batch();
      for (const row of rows)
        batch.create(auditRowRef(db, row.id), bodyOf(row));
      try {
        await batch.commit();
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        // A replay: at least one row is already there. Fill any gap.
        await createEach(db, rows);
      }
    } catch (error) {
      const first = rows[0];
      telemetry.log('error', 'audit write failed', {
        action: first?.auditAction ?? null,
        resourceId: first?.resourceId ?? null,
        error: String(error),
      });
    }
  },

  createAuditRows: async (rows) => {
    try {
      await createEach(db, rows);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        RepositoryError.writeFailed(Collections.AuditLog, String(error)),
      );
    }
  },

  auditActionsFor: async (appointmentIds) => {
    const resourceIds = [
      ...new Set(
        appointmentIds.map((id) => AuditResourceId.forAppointment(id)),
      ),
    ];
    const rows: AuditEntry[] = [];
    try {
      for (let at = 0; at < resourceIds.length; at += IN_CHUNK) {
        const snap = await db
          .collection(Collections.AuditLog)
          .where('resourceId', QueryOp.In, resourceIds.slice(at, at + IN_CHUNK))
          .get();
        for (const doc of snap.docs) {
          rows.push({ id: doc.id, ...doc.data() } as AuditEntry);
        }
      }
      return Result.ok(rows);
    } catch (error) {
      return Result.err(
        RepositoryError.readFailed(Collections.AuditLog, String(error)),
      );
    }
  },
});
