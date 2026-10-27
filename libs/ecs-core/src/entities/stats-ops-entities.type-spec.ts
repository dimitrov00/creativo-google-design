/**
 * Compile-only proofs over the stats-ops group's archetypes (Laws 2 and 6,
 * flatten-spec §7 notes): each entity is the intersection of FLAT slices that
 * share no field name, the intersection is never `never`, every field is a
 * primitive, a brand or a 1-to-N array (`NoNested`), and every 1-to-1
 * component sits at the root. `tsc` failing — on a `false` constant or an
 * unused `@ts-expect-error` — IS the test; nothing here runs.
 */
import {
  type ClientMoneyStats,
  type ClientStats,
  type ClientStatsKey,
  type ClientStatsMeta,
  type PolicyPassStamp,
  type WriteProvenance,
  AttemptOutcome,
  BackfillJobName,
} from '@core/components';
import type {
  ClientMoneyStatsId,
  CustomerId,
  OperationId,
  TriggerEventId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { BackfillJob } from './backfill-job.entity';
import type { ClientMoneyRecord } from './client-money-stats.entity';
import type { ClientStatsRecord } from './client-stats.entity';
import {
  type PolicyRecomputeJob,
  RecomputeJobName,
} from './policy-recompute-job.entity';
import type {
  TriggerFailure,
  TriggerFailureMeta,
} from './trigger-failure.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── ClientStatsRecord = ClientStatsKey & ClientStats & ClientStatsMeta & PolicyPassStamp & { id } ── */

type ClientStatsRecordId = { readonly id: CustomerId };

export const clientStatsRecordNotNever: IsNever<ClientStatsRecord> = false;
export const clientStatsRecordFlat: EveryVariantFlat<ClientStatsRecord> = true;
export const clientStatsRecordDisjoint: [
  Disjoint<ClientStatsKey, ClientStats>,
  Disjoint<ClientStatsKey, ClientStatsMeta>,
  Disjoint<ClientStatsKey, PolicyPassStamp>,
  Disjoint<ClientStatsKey, ClientStatsRecordId>,
  Disjoint<ClientStats, ClientStatsMeta>,
  Disjoint<ClientStats, PolicyPassStamp>,
  Disjoint<ClientStats, ClientStatsRecordId>,
  Disjoint<ClientStatsMeta, PolicyPassStamp>,
  Disjoint<ClientStatsMeta, ClientStatsRecordId>,
  Disjoint<PolicyPassStamp, ClientStatsRecordId>,
] = [true, true, true, true, true, true, true, true, true, true];

declare const statsRecord: ClientStatsRecord;
// Every 1-to-1 component is a root field: no `lifetime.*`, `lastVisit`,
// `pauseSuggestion` or `policyPass` wrapper is left (Law 6.1).
export const statsRoot: readonly unknown[] = [
  statsRecord.lifetimeVisitsCompleted,
  statsRecord.last365NoShows,
  statsRecord.lastVisitLegs,
  statsRecord.nextVisitAppointmentId,
  statsRecord.pauseSuggestedAtUtcMs,
  statsRecord.policyPassChangedAtNanos,
  statsRecord.updatedAtUtcMs,
];
// D29 (flip 1): keyed by the client record, never the account.
export const statsKey: CustomerId = statsRecord.customerId;
export const statsId: CustomerId = statsRecord.id;
// @ts-expect-error — the uid key is gone: `clientStats/{customerId}`
export const noStatsUserId: UserId = statsRecord.userId;
// @ts-expect-error — the lifetime counts are flat, never nested
export const noLifetime: unknown = statsRecord.lifetime;
// @ts-expect-error — the policy pass is flat (`policyPass*`), never nested
export const noPolicyPass: unknown = statsRecord.policyPass;

/* ── ClientMoneyRecord = ClientStatsKey & ClientMoneyStats & ClientStatsMeta & { id } ── */

type ClientMoneyRecordId = { readonly id: ClientMoneyStatsId };

export const clientMoneyRecordNotNever: IsNever<ClientMoneyRecord> = false;
export const clientMoneyRecordFlat: EveryVariantFlat<ClientMoneyRecord> = true;
export const clientMoneyRecordDisjoint: [
  Disjoint<ClientStatsKey, ClientMoneyStats>,
  Disjoint<ClientStatsKey, ClientStatsMeta>,
  Disjoint<ClientStatsKey, ClientMoneyRecordId>,
  Disjoint<ClientMoneyStats, ClientStatsMeta>,
  Disjoint<ClientMoneyStats, ClientMoneyRecordId>,
  Disjoint<ClientStatsMeta, ClientMoneyRecordId>,
] = [true, true, true, true, true, true];

declare const moneyRecord: ClientMoneyRecord;
export const moneyRoot: readonly unknown[] = [
  moneyRecord.customerId,
  moneyRecord.lifetimeSpendCents,
  moneyRecord.currency,
];
// @ts-expect-error — the uid key is gone (D29, flip 1)
export const noMoneyUserId: UserId = moneyRecord.userId;
// @ts-expect-error — the spend is `lifetimeSpendCents` + `currency`, never a nested `Money`
export const noNestedSpend: unknown = moneyRecord.lifetimeSpend;

/* ── BackfillJob — one flat archetype ──────────────────────────────────── */

export const backfillJobNotNever: IsNever<BackfillJob> = false;
export const backfillJobFlat: EveryVariantFlat<BackfillJob> = true;

declare const backfillJob: BackfillJob;
export const backfillRoot: readonly unknown[] = [
  backfillJob.sampleChecked,
  backfillJob.sampleMismatched,
  backfillJob.finishedAtUtcMs,
];
export const backfillTagNarrows: boolean =
  backfillJob.backfillJobName === BackfillJobName.ClientStats;
// D29: the mismatched sample names client records.
export const sampleRecords: readonly CustomerId[] =
  backfillJob.sampleMismatched;
// @ts-expect-error — the closing sample is flat (`sample*`), never nested
export const noNestedSample: unknown = backfillJob.sample;
// @ts-expect-error — the job's tag is `backfillJobName` (N15), never `job`
export const noJobField: unknown = backfillJob.job;

/* ── PolicyRecomputeJob — one flat archetype, D17 halves at the root ───── */

export const policyJobNotNever: IsNever<PolicyRecomputeJob> = false;
export const policyJobFlat: EveryVariantFlat<PolicyRecomputeJob> = true;

declare const policyJob: PolicyRecomputeJob;
export const policyJobRoot: readonly unknown[] = [
  policyJob.changedAtSeconds,
  policyJob.changedAtNanos,
  policyJob.stalledAtUtcMs,
];
export const policyJobTagNarrows: boolean =
  policyJob.recomputeJobName === RecomputeJobName.ClientStatsPolicy;
// D29: the pass walks client records.
export const policyCursor: CustomerId | null = policyJob.cursor;
// @ts-expect-error — the change instant is flat (`changedAtSeconds/Nanos`), never a nested struct
export const noNestedChangedAt: unknown = policyJob.changedAt;

/* ── TriggerFailure = TriggerFailureMeta & WriteProvenance (WS-6, RU-31) ── */

export const triggerFailureNotNever: IsNever<TriggerFailure> = false;
export const triggerFailureFlat: EveryVariantFlat<TriggerFailure> = true;
export const triggerFailureDisjoint: Disjoint<
  TriggerFailureMeta,
  WriteProvenance
> = true;

declare const deadLetter: TriggerFailure;
// Every field at the root: the event id IS the document id (Law 5).
export const deadLetterId: TriggerEventId = deadLetter.id;
export const deadLetterRoot: readonly unknown[] = [
  deadLetter.fn,
  deadLetter.documentPath,
  deadLetter.failureCode,
];
export const deadLetterRecordedAt: UtcEpochMs = deadLetter.recordedAtUtcMs;
export const deadLetterProvenance: OperationId | null =
  deadLetter.writeOperationId;
export const deadLetterTagNarrows: boolean =
  deadLetter.attemptOutcome === AttemptOutcome.Permanent;
// @ts-expect-error — the event id is the document id, never a second `eventId` field
export const noEventIdField: unknown = deadLetter.eventId;
// @ts-expect-error — the attempt's age is the log line's (`ageMs`), never stored
export const noAgeMs: unknown = deadLetter.ageMs;
// @ts-expect-error — the tag is `attemptOutcome` (N15), never `outcome`
export const noOutcomeField: unknown = deadLetter.outcome;
