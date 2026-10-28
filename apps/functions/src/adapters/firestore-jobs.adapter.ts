import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { Roles } from '@core/components';
import {
  type Appointment,
  type BackfillJob,
  Collections,
} from '@core/entities';
import type { BackfillJobPorts, CallerRolesPorts, Log } from '@core/ports';
import { type StoredGuardOf, TriggerAttemptSystem } from '@core/systems';
import { admitStored } from './firestore-tx.adapter';

/**
 * The operator backfill's server reads and its progress write (flip 1,
 * blueprint §4.1 `runBackfill`):
 *
 * - `loadBackfillJob` — `backfillJobs/{job}`, the run's progress as stored,
 *   `null` before its first page;
 * - `writeBackfillJob` — the progress after a page, one `Set` of the entity
 *   minus its id;
 * - `pageAppointments` — the next page of appointments in document-id
 *   order, strictly after `afterId` (each row the backfill stamps is re-read
 *   in its own transaction, never written from this page);
 * - `loadCallerRoles` — the STORED roles of `users/{uid}`, the server's
 *   second check behind the token's `sysadmin` claim (a demoted sysadmin
 *   keeps the claim until the token refreshes); `[]` for an unknown uid, an
 *   unknown string granting nothing (`Roles.known`).
 *
 * Bodies spread as stored; a read or write that throws answers a
 * `RepositoryError` value whose `reason` is the failure's canonical code.
 *
 * `pageAppointments` is a CURSOR WALK (edge hardening D-3): built with the
 * guard registry (`StoredDocumentSystem.guardOf`, the composition root's),
 * it runs every row through the appointment guard, and the FIRST malformed
 * row fails the whole page — `RepositoryError.malformed(path, field)`,
 * logged once (`LogEvent.DocumentRefused` — `'malformed document refused'` —
 * `{ path, field }`) — so the
 * backfill call stops AT the document and names it. Dropping the row would
 * shorten the page, and `BackfillPlanSystem.pageWalk` reads a short page
 * as "exhausted": the walk would end early and silently. Legacy rows
 * lacking the subject mirrors or a placement pass (unchecked by design) and
 * are repaired. The registry and the log are REQUIRED (OR-33, DEP-F24): a
 * bare `firestoreJobPorts(db)` does not type-check.
 */

export const firestoreJobPorts = (
  db: Firestore,
  guardOf: StoredGuardOf,
  log: Log,
): BackfillJobPorts & CallerRolesPorts => ({
  loadBackfillJob: async (id) => {
    const path = `${Collections.BackfillJobs}/${id}`;
    try {
      const snap = await db.doc(path).get();
      return Result.ok(
        snap.exists ? ({ id: snap.id, ...snap.data() } as BackfillJob) : null,
      );
    } catch (error) {
      return Result.err(
        RepositoryError.readFailed(
          path,
          TriggerAttemptSystem.failureCode(error),
        ),
      );
    }
  },

  writeBackfillJob: async (job) => {
    const { id, ...body } = job;
    const path = `${Collections.BackfillJobs}/${id}`;
    try {
      await db.doc(path).set(body);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        RepositoryError.writeFailed(
          path,
          TriggerAttemptSystem.failureCode(error),
        ),
      );
    }
  },

  pageAppointments: async (afterId, limit) => {
    let page;
    try {
      let query = db
        .collection(Collections.Appointments)
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (afterId !== null) query = query.startAfter(afterId);
      page = await query.get();
    } catch (error) {
      return Result.err(
        RepositoryError.readFailed(
          Collections.Appointments,
          TriggerAttemptSystem.failureCode(error),
        ),
      );
    }
    const rows: Appointment[] = [];
    for (const snap of page.docs) {
      const row = admitStored<Appointment>(
        guardOf,
        Collections.Appointments,
        { id: snap.id, ...snap.data() },
        log,
      );
      if (!row.ok) return row;
      rows.push(row.value);
    }
    return Result.ok(rows);
  },

  loadCallerRoles: async (userId) => {
    const path = `${Collections.Users}/${userId}`;
    try {
      const roles: unknown = (await db.doc(path).get()).get('roles');
      return Result.ok(Array.isArray(roles) ? Roles.known(roles) : []);
    } catch (error) {
      return Result.err(
        RepositoryError.readFailed(
          path,
          TriggerAttemptSystem.failureCode(error),
        ),
      );
    }
  },
});
