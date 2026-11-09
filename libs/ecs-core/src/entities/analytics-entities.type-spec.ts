/**
 * Compile-only proofs over the staff analytics v2 archetypes (Laws 2 and 6):
 * the stored day is the intersection of FLAT slices that share no field
 * name and is never `never`; the recompute job is one flat archetype whose
 * every field is a primitive, a brand, `null` or a 1-to-N array
 * (`NoNested`). `tsc` failing — on a `false` constant or an unused
 * `@ts-expect-error` — IS the test; nothing here runs.
 */
import type {
  AnalyticsGoal,
  DayCounts,
  DayHourBuckets,
  DayRow,
  DayServices,
  DayStamp,
} from '@core/components';
import type {
  AnalyticsGoalKey,
  BarberId,
  BusyKey,
  UtcEpochMs,
} from '@core/primitives';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type {
  AnalyticsGoalMeta,
  StoredAnalyticsGoal,
} from './analytics-goal.entity';
import type { AnalyticsRecomputeJob } from './analytics-recompute-job.entity';
import type {
  BarberAnalyticsDay,
  BarberAnalyticsDayMeta,
} from './barber-analytics-day.entity';
import { RecomputeJobName } from './policy-recompute-job.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── BarberAnalyticsDay = Meta & DayRow & DayCounts & DayServices & DayHourBuckets & DayStamp ── */

export const analyticsDayNotNever: IsNever<BarberAnalyticsDay> = false;
export const analyticsDayFlat: EveryVariantFlat<BarberAnalyticsDay> = true;
export const analyticsDayDisjoint: [
  Disjoint<BarberAnalyticsDayMeta, DayRow>,
  Disjoint<BarberAnalyticsDayMeta, DayCounts>,
  Disjoint<BarberAnalyticsDayMeta, DayServices>,
  Disjoint<BarberAnalyticsDayMeta, DayHourBuckets>,
  Disjoint<BarberAnalyticsDayMeta, DayStamp>,
  Disjoint<DayRow, DayCounts>,
  Disjoint<DayRow, DayServices>,
  Disjoint<DayRow, DayHourBuckets>,
  Disjoint<DayRow, DayStamp>,
  Disjoint<DayCounts, DayServices>,
  Disjoint<DayCounts, DayHourBuckets>,
  Disjoint<DayCounts, DayStamp>,
  Disjoint<DayServices, DayHourBuckets>,
  Disjoint<DayServices, DayStamp>,
  Disjoint<DayHourBuckets, DayStamp>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

declare const day: BarberAnalyticsDay;
// The row the answer carries sits at the root beside the counts and the stamp.
void day.dayRosteredMinutes;
void day.dayTakingsCents;
void day.dayRebookedBase;
void day.dayServices;
void day.dayHourWorked;
const dayStamp: UtcEpochMs = day.dayComputedAtUtcMs;
void dayStamp;
// @ts-expect-error — no location on a day document: one per barber-day across shops
void day.locationId;
// @ts-expect-error — no time-zone field on a temporal entity (Law 7.2)
void day.timeZone;
// @ts-expect-error — the TTL stamp is the adapter's, outside the type
void day.purgeAt;

/* ── AnalyticsRecomputeJob — one flat archetype ───────────────────────── */

export const recomputeJobNotNever: IsNever<AnalyticsRecomputeJob> = false;
export const recomputeJobFlat: EveryVariantFlat<AnalyticsRecomputeJob> = true;

declare const job: AnalyticsRecomputeJob;
const jobName: typeof RecomputeJobName.AnalyticsDays = job.recomputeJobName;
void jobName;
const cursor: BusyKey | null = job.jobCursor;
void cursor;
void job.jobBarberIds;
void job.jobFullReach;
// @ts-expect-error — the analytics job is never the policy job
const notPolicy: typeof RecomputeJobName.ClientStatsPolicy =
  job.recomputeJobName;
void notPolicy;
// @ts-expect-error — the policy job's generation has no place here
void job.generation;

/* ── StoredAnalyticsGoal = Meta & AnalyticsGoal (PR 6) ───────────────────── */

export const goalNotNever: IsNever<StoredAnalyticsGoal> = false;
export const goalFlat: EveryVariantFlat<StoredAnalyticsGoal> = true;
export const goalDisjoint: Disjoint<AnalyticsGoalMeta, AnalyticsGoal> = true;

declare const goal: StoredAnalyticsGoal;
const goalKey: AnalyticsGoalKey = goal.id;
void goalKey;
const goalScope: BarberId | null = goal.barberId;
void goalScope;
void goal.goalMonth;
void goal.goalLowCents;
void goal.goalHighCents;
void goal.currency;
void goal.goalSetByUserId;
const goalStamp: UtcEpochMs = goal.goalSetAtUtcMs;
void goalStamp;
// @ts-expect-error — no time-zone field on a goal: a month is the shop calendar's (Law 7.2)
void goal.timeZone;
// @ts-expect-error — no pace on the document: the system derives it per report
void goal.goalPaceTag;
