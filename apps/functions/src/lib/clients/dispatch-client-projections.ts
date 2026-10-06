import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { ClientStatsPolicy } from '@creativo/domain/scheduling';
import type { PersistedDocument } from '@creativo/application/booking';
import { adminFirestore } from '../firebase-admin';
import {
  type AttemptFailure,
  decisiveFailure,
  reportAttempt,
} from '../trigger-attempts';
import { affectedSubjects, statsInputChanged } from './client-stats-projection';
import { loadClientStatsPolicy, recomputeEach } from './recompute-client-stats';

const FN = 'dispatchClientProjections';

/** The slice of an `appointments/{id}` write event the handler reads. */
export interface AppointmentWriteEvent {
  readonly id: string;
  readonly time: string;
  readonly data?: {
    readonly before?: { data(): PersistedDocument | undefined };
    readonly after?: { data(): PersistedDocument | undefined };
  };
}

export interface DispatchDeps {
  readonly clockMs: () => number;
  readonly loadPolicy: (db: Firestore) => Promise<ClientStatsPolicy>;
}

const LIVE: DispatchDeps = {
  clockMs: Date.now,
  loadPolicy: loadClientStatsPolicy,
};

/**
 * One delivery of one appointment write: recompute the stats of everybody
 * the write can have moved, or nothing.
 *
 * Most writes exit at the first line — an arrival, a tip, a contact edit —
 * because they change nothing `computeClientStats` reads (§13 R28). The rest
 * recompute each subject in before ∪ after, state-based, so a redelivery
 * finds every answer already written and writes nothing.
 *
 * Each subject is recomputed ON ITS OWN: one person's failure never leaves
 * the rest of the party with stale numbers. A failed attempt is still ONE
 * structured line — ids and codes only (T5), `ageMs` saying how deep into
 * the 24 h retry window this delivery is. If any failure is transient the
 * attempt rethrows for the platform to redeliver (every subject again,
 * state-based, so the ones already written write nothing); permanent ones
 * would fail identically for the whole window, so they are logged and
 * dropped, and `runBackfill('clientStats')` is the repair.
 */
export async function projectAppointmentWrite(
  event: AppointmentWriteEvent,
  db: Firestore,
  deps: DispatchDeps = LIVE,
): Promise<void> {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!statsInputChanged(before, after)) return;
  const subjects = affectedSubjects(before, after);
  if (subjects.length === 0) return;

  let failure: AttemptFailure | null;
  try {
    const policy = await deps.loadPolicy(db);
    // One at a time: the subjects of one party share this appointment, and
    // parallel transactions over the same rows would only contend.
    const report = await recomputeEach(db, subjects, {
      policy,
      clockMs: deps.clockMs,
    });
    failure = decisiveFailure(report.failures);
  } catch (error) {
    // The policy read is every subject's: nothing was recomputed.
    failure = decisiveFailure([error]);
  }
  if (failure !== null) reportAttempt(FN, event, failure, deps.clockMs());
}

/**
 * `clientStats/{uid}` and `restricted/money` follow the appointments (R33).
 *
 * `retry: true` because the default drops a failed event silently, against
 * at-least-once (L3): a transaction aborted by a deploy would leave a client's
 * numbers wrong until something else touched them. Never flagged — the
 * projection only states facts (R41).
 */
export const dispatchClientProjections = onDocumentWritten(
  { document: 'appointments/{appointmentId}', retry: true },
  (event) => projectAppointmentWrite(event, adminFirestore()),
);
