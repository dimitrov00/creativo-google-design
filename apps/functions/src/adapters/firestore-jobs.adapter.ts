import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { RepositoryError, Result } from '@core/primitives';
import { knownRoles } from '@core/components';
import {
  type Appointment,
  type BackfillJob,
  Collections,
} from '@core/entities';
import type { AccountsPorts, GovernancePorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';

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
 *   unknown string granting nothing (`knownRoles`).
 *
 * Bodies spread as stored; a read or write that throws answers a
 * `RepositoryError` value whose `reason` is the failure's canonical code.
 */

export type JobPorts = Pick<
  GovernancePorts,
  'loadBackfillJob' | 'writeBackfillJob' | 'pageAppointments'
> &
  Pick<AccountsPorts, 'loadCallerRoles'>;

function code(error: unknown): string {
  return TriggerAttemptSystem.failureCode(error);
}

export const firestoreJobPorts = (db: Firestore): JobPorts => ({
  loadBackfillJob: async (id) => {
    const path = `${Collections.BackfillJobs}/${id}`;
    try {
      const snap = await db.doc(path).get();
      return Result.ok(
        snap.exists ? ({ id: snap.id, ...snap.data() } as BackfillJob) : null,
      );
    } catch (error) {
      return Result.err(RepositoryError.readFailed(path, code(error)));
    }
  },

  writeBackfillJob: async (job) => {
    const { id, ...body } = job;
    const path = `${Collections.BackfillJobs}/${id}`;
    try {
      await db.doc(path).set(body);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(RepositoryError.writeFailed(path, code(error)));
    }
  },

  pageAppointments: async (afterId, limit) => {
    try {
      let query = db
        .collection(Collections.Appointments)
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (afterId !== null) query = query.startAfter(afterId);
      const page = await query.get();
      return Result.ok(
        page.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Appointment),
      );
    } catch (error) {
      return Result.err(
        RepositoryError.readFailed(Collections.Appointments, code(error)),
      );
    }
  },

  loadCallerRoles: async (userId) => {
    const path = `${Collections.Users}/${userId}`;
    try {
      const roles: unknown = (await db.doc(path).get()).get('roles');
      return Result.ok(Array.isArray(roles) ? knownRoles(roles) : []);
    } catch (error) {
      return Result.err(RepositoryError.readFailed(path, code(error)));
    }
  },
});
