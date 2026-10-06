import { logger } from 'firebase-functions';
import type { Firestore, Query } from 'firebase-admin/firestore';
import { UserId } from '@creativo/domain/accounts';
import {
  type Appointment,
  ClientStatsPolicy,
  computeClientMoneyStats,
  computeClientStats,
} from '@creativo/domain/scheduling';
import {
  CLIENT_MONEY_DOC,
  CLIENT_STATS_COLLECTION,
  CLIENT_STATS_RESTRICTED_COLLECTION,
  type PersistedDocument,
  type PolicyPass,
  appointmentFromDocument,
  policyPassFields,
  policyPassOf,
} from '@creativo/application/booking';
import { loadBookingPolicy } from '../booking/load-booking-policy';
import {
  judgePolicyPass,
  placementsFrom,
  planClientStatsWrite,
  projectionClock,
} from './client-stats-projection';

/**
 * What one recompute did — `unchanged` is the common, cheap answer;
 * `superseded` is a policy pass that found a NEWER pass's stamp on the
 * client and wrote nothing (`judgePolicyPass`).
 */
export type RecomputeOutcome =
  'written' | 'unchanged' | 'skipped' | 'superseded';

export interface RecomputeDeps {
  readonly policy: ClientStatsPolicy;
  /** Wall clock, epoch ms — injected so the trigger and the backfill can be pinned in tests. */
  readonly clockMs: () => number;
  /**
   * The policy pass doing this recompute, when it is one — its stamp is
   * written with the answer and guards it against an older pass's late
   * write (`PolicyPass`). Absent for every other writer, which carries the
   * stored stamp forward.
   */
  readonly pass?: PolicyPass | null;
}

/** The tenant's late-cancel window with the R47 suggestion thresholds. */
export async function loadClientStatsPolicy(
  db: Firestore,
): Promise<ClientStatsPolicy> {
  return ClientStatsPolicy.forBooking(await loadBookingPolicy(db));
}

/**
 * Every appointment this person has a seat on. `array-contains` on the
 * mirror needs no composite index; the history is sorted in memory (clients
 * have under 200 visits, §2.4 assumption 16).
 */
export function historyQuery(db: Firestore, userId: string): Query {
  return db
    .collection('appointments')
    .where('subjectUserIds', 'array-contains', userId);
}

/** The stored rows as aggregates; one that does not parse is named in the log, never guessed at. */
export function appointmentsFrom(
  userId: string,
  docs: readonly { readonly id: string; data(): PersistedDocument }[],
): Appointment[] {
  const appointments: Appointment[] = [];
  const unreadable: string[] = [];
  for (const doc of docs) {
    const parsed = appointmentFromDocument(doc.id, doc.data());
    if (parsed.isSuccess()) appointments.push(parsed.value);
    else unreadable.push(doc.id);
  }
  if (unreadable.length > 0) {
    logger.warn('client stats left out unreadable appointments', {
      userId,
      appointmentIds: unreadable,
    });
  }
  return appointments;
}

export function clientStatsRefs(db: Firestore, userId: string) {
  const stats = db.collection(CLIENT_STATS_COLLECTION).doc(userId);
  return {
    stats,
    money: stats
      .collection(CLIENT_STATS_RESTRICTED_COLLECTION)
      .doc(CLIENT_MONEY_DOC),
  };
}

/**
 * Recompute ONE client's `clientStats/{uid}` and `restricted/money` from every
 * appointment they have a seat on, inside a transaction.
 *
 * The history query runs in the transaction, so the answer is the history as
 * of the commit: a booking that lands meanwhile either conflicts (and this
 * retries onto it) or fires its own trigger, which recomputes after. Either
 * order converges, because the input is the appointments themselves — the
 * `rebuildBusyOnAppointmentChange` argument, one collection over.
 */
export async function recomputeClientStats(
  db: Firestore,
  userId: string,
  deps: RecomputeDeps,
): Promise<RecomputeOutcome> {
  const subject = UserId.create(userId);
  if (subject.isFailure()) return 'skipped';
  const refs = clientStatsRefs(db, userId);

  return db.runTransaction(async (tx) => {
    const history = await tx.get(historyQuery(db, userId));
    const [storedStats, storedMoney] = await tx.getAll(refs.stats, refs.money);
    const appointments = appointmentsFrom(userId, history.docs);

    const stored = {
      stats: storedStats?.data(),
      money: storedMoney?.data(),
    };
    // A newer policy pass has judged this client since this one loaded its
    // policy: its answer stands. Decided HERE, inside the transaction that
    // would write, so the two passes' writes are serialised by the store.
    const verdict = judgePolicyPass(
      deps.pass ?? null,
      policyPassOf(stored.stats),
    );
    if (verdict.kind === 'superseded') return 'superseded';
    const nowMs = projectionClock(deps.clockMs(), stored.stats);
    const plan = planClientStatsWrite({
      userId,
      stored,
      stats: computeClientStats(
        subject.value,
        appointments,
        nowMs,
        deps.policy,
        placementsFrom(history.docs),
      ),
      money: computeClientMoneyStats(subject.value, appointments),
      hasHistory: history.docs.length > 0,
      nowMs,
    });
    if (plan.kind === 'unchanged') {
      // The same answer, but a newer pass must still leave its mark, or an
      // older pass's write landing after it could not tell it was late.
      if (verdict.restamp && stored.stats !== undefined) {
        tx.update(refs.stats, policyPassFields(verdict.stamp));
      }
      return 'unchanged';
    }

    // Two documents, one version: the spend is admin-only (R33), so it
    // cannot ride on the stats document, but it must never disagree with it.
    // The stamp rides the stats document, carried forward by every writer.
    tx.set(refs.stats, { ...plan.stats, ...policyPassFields(verdict.stamp) });
    tx.set(refs.money, plan.money);
    return 'written';
  });
}

/** What recomputing a set of clients came to. */
export interface RecomputeReport {
  /** Clients whose answer changed and was written. */
  readonly written: number;
  /** One per client whose recompute threw — for the caller to judge (`decisiveFailure`). */
  readonly failures: readonly unknown[];
}

/**
 * Recompute each of `userIds` ON ITS OWN, and report what was written and
 * what failed.
 *
 * One person's failure says nothing about anybody else's history, so it must
 * never cost the people after them their recompute: each subject gets its
 * own attempt, the failures are collected, and the caller decides what the
 * attempt as a whole amounts to (`decisiveFailure`). `width` subjects run at
 * once — 1 for the people of one party, who share the appointment's rows
 * and would only contend.
 */
export async function recomputeEach(
  db: Firestore,
  userIds: readonly string[],
  deps: RecomputeDeps,
  width = 1,
): Promise<RecomputeReport> {
  const failures: unknown[] = [];
  let written = 0;
  for (let start = 0; start < userIds.length; start += width) {
    const outcomes = await Promise.all(
      userIds.slice(start, start + width).map(async (userId) => {
        try {
          return await recomputeClientStats(db, userId, deps);
        } catch (error) {
          failures.push(error);
          return null;
        }
      }),
    );
    written += outcomes.filter((outcome) => outcome === 'written').length;
  }
  return { written, failures };
}
