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
  type ClientStatsMeta,
  type PolicyPassStamp,
  BackfillJobName,
} from '@core/components';
import type { ClientMoneyStatsId, UserId } from '@core/primitives';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { BackfillJob } from './backfill-job.entity';
import type { ClientMoneyRecord } from './client-money-stats.entity';
import type { ClientStatsRecord } from './client-stats.entity';
import {
  type PolicyRecomputeJob,
  RecomputeJobName,
} from './policy-recompute-job.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── ClientStatsRecord = ClientStats & ClientStatsMeta & PolicyPassStamp & { id } ── */

type ClientStatsRecordId = { readonly id: UserId };

export const clientStatsRecordNotNever: IsNever<ClientStatsRecord> = false;
export const clientStatsRecordFlat: EveryVariantFlat<ClientStatsRecord> = true;
export const clientStatsRecordDisjoint: [
  Disjoint<ClientStats, ClientStatsMeta>,
  Disjoint<ClientStats, PolicyPassStamp>,
  Disjoint<ClientStats, ClientStatsRecordId>,
  Disjoint<ClientStatsMeta, PolicyPassStamp>,
  Disjoint<ClientStatsMeta, ClientStatsRecordId>,
  Disjoint<PolicyPassStamp, ClientStatsRecordId>,
] = [true, true, true, true, true, true];

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
// @ts-expect-error — the lifetime counts are flat, never nested
export const noLifetime: unknown = statsRecord.lifetime;
// @ts-expect-error — the policy pass is flat (`policyPass*`), never nested
export const noPolicyPass: unknown = statsRecord.policyPass;

/* ── ClientMoneyRecord = ClientMoneyStats & ClientStatsMeta & { id } ───── */

type ClientMoneyRecordId = { readonly id: ClientMoneyStatsId };

export const clientMoneyRecordNotNever: IsNever<ClientMoneyRecord> = false;
export const clientMoneyRecordFlat: EveryVariantFlat<ClientMoneyRecord> = true;
export const clientMoneyRecordDisjoint: [
  Disjoint<ClientMoneyStats, ClientStatsMeta>,
  Disjoint<ClientMoneyStats, ClientMoneyRecordId>,
  Disjoint<ClientStatsMeta, ClientMoneyRecordId>,
] = [true, true, true];

declare const moneyRecord: ClientMoneyRecord;
export const moneyRoot: readonly unknown[] = [
  moneyRecord.lifetimeSpendCents,
  moneyRecord.currency,
];
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
// @ts-expect-error — the change instant is flat (`changedAtSeconds/Nanos`), never a nested struct
export const noNestedChangedAt: unknown = policyJob.changedAt;
