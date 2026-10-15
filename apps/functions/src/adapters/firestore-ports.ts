import type { Firestore } from 'firebase-admin/firestore';
import type {
  Hash,
  NextId,
  NowUtcMs,
  TelemetryPorts,
  TxPorts,
} from '@core/ports';
import { firestoreAccountPorts } from './firestore-accounts.adapter';
import { firestoreAuditPorts } from './firestore-audit.adapter';
import { firestoreCapacityPorts } from './firestore-capacity.adapter';
import { firestoreCatalogPorts } from './firestore-catalog.adapter';
import { firestoreClientStatsPorts } from './firestore-client-stats.adapter';
import { firestoreCouponPorts } from './firestore-coupons.adapter';
import { firestoreJobPorts } from './firestore-jobs.adapter';
import { firestoreLeadTimePorts } from './firestore-lead-time.adapter';
import { firestoreNotificationPorts } from './firestore-notifications.adapter';
import { firestoreSchedulePorts } from './firestore-schedules.adapter';
import { firestoreSettingsPorts } from './firestore-settings.adapter';
import { firestoreCommitPlan } from './firestore-tx.adapter';
import { firestoreWaitlistPorts } from './firestore-waitlist.adapter';

/**
 * The Firestore port assembler (blueprint §4.3): `main.ts` calls
 * `firestorePorts(db, primitives, telemetry)` ONCE per cold start, on the
 * first request that needs Firestore, and hands the bundles to the pipeline
 * factories. The only place a Firestore-backed port is constructed.
 *
 * Flip 1 (booking core) fills the intersection: the single `CommitPlan`
 * over the transaction adapter and the three impure primitives every
 * pipeline passes its systems, plus one bundle per NON-transactional port
 * family the flip's pipelines read or write outside a transaction (F1-6:
 * a transactional read is `ReadTx`, a transactional write an entry of the
 * one plan — no per-collection adapter holds nothing). The audit bundle
 * logs its never-fatal failures through the telemetry it is given.
 *
 * Extension point, by type: a flip adds its collections' server bundle as
 * one more member of the {@link FirestorePorts} intersection and spreads its
 * adapter factory into the object `firestorePorts` returns; until both are
 * there the root does not compile, so a bundle can never be declared and
 * left unbuilt.
 */

/** The impure primitives the root draws once per cold start — `TxPorts` minus `commit`. */
export type Primitives = {
  readonly nowUtcMs: NowUtcMs;
  readonly nextId: NextId;
  readonly hash: Hash;
};

/** Every Firestore-backed bundle, intersected — one member per adapter factory. */
export type FirestorePorts = TxPorts &
  ReturnType<typeof firestoreSettingsPorts> &
  ReturnType<typeof firestoreCouponPorts> &
  ReturnType<typeof firestoreAccountPorts> &
  ReturnType<typeof firestoreAuditPorts> &
  ReturnType<typeof firestoreCatalogPorts> &
  ReturnType<typeof firestoreSchedulePorts> &
  ReturnType<typeof firestoreCapacityPorts> &
  ReturnType<typeof firestoreLeadTimePorts> &
  ReturnType<typeof firestoreWaitlistPorts> &
  ReturnType<typeof firestoreNotificationPorts> &
  ReturnType<typeof firestoreClientStatsPorts> &
  ReturnType<typeof firestoreJobPorts>;

export const firestorePorts = (
  db: Firestore,
  primitives: Primitives,
  telemetry: TelemetryPorts,
): FirestorePorts => ({
  commit: firestoreCommitPlan(db),
  nowUtcMs: primitives.nowUtcMs,
  nextId: primitives.nextId,
  hash: primitives.hash,
  ...firestoreSettingsPorts(db),
  ...firestoreCouponPorts(db),
  ...firestoreAccountPorts(db),
  ...firestoreAuditPorts(db, telemetry),
  ...firestoreCatalogPorts(db),
  ...firestoreSchedulePorts(db),
  ...firestoreCapacityPorts(db),
  ...firestoreLeadTimePorts(db),
  ...firestoreWaitlistPorts(db),
  ...firestoreNotificationPorts(db),
  ...firestoreClientStatsPorts(db),
  ...firestoreJobPorts(db),
});
