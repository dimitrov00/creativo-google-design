import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { CustomerId, Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { BookingPolicy, PreciseInstant } from '@core/components';
import {
  BOOKING_POLICY_DOC,
  Collections,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
} from '@core/entities';
import type { AdminBatchPorts, PolicyLinePorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';

/**
 * The policy recompute's server reads outside any transaction (flip 1,
 * blueprint §4.1 `startPolicyRecompute` / `continuePolicyRecompute` /
 * `sweepPolicyRecompute`, and the backfill's walk over the stored clients):
 *
 * - `pageClients` — the ids of stored `clientStats` documents — client
 *   records (D29) — in document-id order, strictly after `afterCustomerId`,
 *   bodies NOT read (`select()`); a page shorter than `limit` is the last;
 * - `loadPolicyRecomputeJob` — `backfillJobs/clientStatsPolicy`, the pass's
 *   job as stored, `null` before the first pass (each step re-reads it
 *   before every page);
 * - `loadPolicyLine` — the policy's late line as the daily sweep compares it
 *   with the job: `cancellationWindowHours` through the component's own
 *   edge guard (`BookingPolicy.withDefaults` — no document is the defaults)
 *   and the document's own `updateTime` at full precision (§9 D17), `null`
 *   with no document.
 *
 * Bodies spread as stored; a read that throws answers a `RepositoryError`
 * value whose `reason` is the failure's canonical code — what the retrying
 * edge judges a redelivery by.
 */

const JOB_PATH = `${Collections.BackfillJobs}/${POLICY_RECOMPUTE_DOC}`;
const POLICY_PATH = `${Collections.Settings}/${BOOKING_POLICY_DOC}`;

function readFailed(path: string, error: unknown): RepositoryError {
  return RepositoryError.readFailed(
    path,
    TriggerAttemptSystem.failureCode(error),
  );
}

export const firestoreClientStatsPorts = (
  db: Firestore,
): AdminBatchPorts & PolicyLinePorts => ({
  pageClients: async (afterCustomerId, limit) => {
    try {
      let query = db
        .collection(Collections.ClientStats)
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (afterCustomerId !== null) query = query.startAfter(afterCustomerId);
      const page = await query.select().get();
      return Result.ok(page.docs.map((doc) => CustomerId.of(doc.id)));
    } catch (error) {
      return Result.err(readFailed(Collections.ClientStats, error));
    }
  },

  loadPolicyRecomputeJob: async () => {
    try {
      const snap = await db.doc(JOB_PATH).get();
      return Result.ok(
        snap.exists
          ? ({ id: snap.id, ...snap.data() } as PolicyRecomputeJob)
          : null,
      );
    } catch (error) {
      return Result.err(readFailed(JOB_PATH, error));
    }
  },

  loadPolicyLine: async () => {
    try {
      const snap = await db.doc(POLICY_PATH).get();
      const stamp = snap.exists ? snap.updateTime : undefined;
      return Result.ok({
        updatedAt:
          stamp === undefined
            ? null
            : PreciseInstant.of(stamp.seconds, stamp.nanoseconds),
        windowHours: BookingPolicy.withDefaults(snap.data() ?? null)
          .cancellationWindowHours,
      });
    } catch (error) {
      return Result.err(readFailed(POLICY_PATH, error));
    }
  },
});
