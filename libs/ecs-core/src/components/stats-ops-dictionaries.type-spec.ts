/**
 * Compile-time-only checks of the stats-ops group's `as const` tag
 * dictionaries (flatten-spec §7, §8.1: the group's own split of
 * `dictionaries.type-spec.ts`) — no runtime `expect()`/`it()`; `nx
 * typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, and no two
 *    keys share a value.
 * 3. **SCREAMING** — every value is upper-snake (N7/N8, §0.4: none of these
 *    is an external contract).
 * 4. **N15 pair lines** (L8, read by `tools/lint-rules/dictionary-fields
 *    .spec.mjs`) — each discriminator and plain tag field is named
 *    `camelCase(Dictionary)`, and its type is exactly the dictionary.
 */
import {
  type BackfillJob,
  type PolicyRecomputeJob,
  RecomputeJobName,
} from '@core/entities';
import { BackfillJobName } from './backfill-job-name.data';
import { CapacityTrigger } from './capacity-trigger.data';
import { ClientStatsOutcome } from './client-stats-outcome.data';
import {
  PolicyStartOutcome,
  PolicyStepOutcome,
  PolicySweepOutcome,
} from './policy-recompute-outcome.data';
import {
  BackfillPhase,
  type BackfillPosition,
  type BackfillRequest,
  BackfillStart,
  type BackfillStartRequest,
  CancellationAttribution,
  type ClientStatsWritePlan,
  StatsWriteDecision,
  SubjectVisitOutcome,
  type SubjectVisitOutcomeState,
  type PolicyPassJudgement,
  PolicyPassVerdict,
  type AttemptFailure,
  type AttemptLine,
  AttemptOutcome,
} from '@core/systems';

/** A tag dictionary whose every value is a `T`. */
type Dictionary<T> = { readonly [key: string]: T };
type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
/** The keys of `D` whose value another key also has. */
type SharedValueKeys<D> = {
  [K in keyof D]: D[K] extends D[Exclude<keyof D, K>] ? K : never;
}[keyof D];
/** `D`'s values are exactly `T`, each value under one key only. */
type Holds<D, T> =
  Equals<D[keyof D], T> extends true ? IsNever<SharedValueKeys<D>> : false;
type Screaming<V extends string> = [V] extends [Uppercase<V>] ? true : false;

/** The value-level `satisfies` runs at compile time only; nothing is called. */
declare function dictionary(checked: unknown): void;

// (1) satisfies — every dictionary's values are of its type.
dictionary(BackfillJobName satisfies Dictionary<BackfillJobName>);
dictionary(RecomputeJobName satisfies Dictionary<RecomputeJobName>);
dictionary(BackfillPhase satisfies Dictionary<BackfillPhase>);
dictionary(BackfillStart satisfies Dictionary<BackfillStart>);
dictionary(SubjectVisitOutcome satisfies Dictionary<SubjectVisitOutcome>);
dictionary(
  CancellationAttribution satisfies Dictionary<CancellationAttribution>,
);
dictionary(StatsWriteDecision satisfies Dictionary<StatsWriteDecision>);
dictionary(PolicyPassVerdict satisfies Dictionary<PolicyPassVerdict>);
dictionary(AttemptOutcome satisfies Dictionary<AttemptOutcome>);
dictionary(PolicyStartOutcome satisfies Dictionary<PolicyStartOutcome>);
dictionary(PolicyStepOutcome satisfies Dictionary<PolicyStepOutcome>);
dictionary(PolicySweepOutcome satisfies Dictionary<PolicySweepOutcome>);
dictionary(ClientStatsOutcome satisfies Dictionary<ClientStatsOutcome>);
dictionary(CapacityTrigger satisfies Dictionary<CapacityTrigger>);

// (2) Holds — each type is exactly its dictionary's values, one key each.
export type StatsOpsDictionariesHold = [
  Expect<Holds<typeof BackfillJobName, BackfillJobName>>, // components/backfill-job-name.data.ts
  Expect<Holds<typeof RecomputeJobName, RecomputeJobName>>, // entities/policy-recompute-job.entity.ts
  Expect<Holds<typeof BackfillPhase, BackfillPhase>>, // systems/backfill-plan.system.ts
  Expect<Holds<typeof BackfillStart, BackfillStart>>, // systems/backfill-plan.system.ts
  Expect<Holds<typeof SubjectVisitOutcome, SubjectVisitOutcome>>, // systems/client-stats.system.ts
  Expect<Holds<typeof CancellationAttribution, CancellationAttribution>>, // systems/client-stats.system.ts
  Expect<Holds<typeof StatsWriteDecision, StatsWriteDecision>>, // systems/client-stats.system.ts
  Expect<Holds<typeof PolicyPassVerdict, PolicyPassVerdict>>, // systems/policy-recompute-job.system.ts
  Expect<Holds<typeof AttemptOutcome, AttemptOutcome>>, // systems/trigger-attempt.system.ts
  Expect<Holds<typeof PolicyStartOutcome, PolicyStartOutcome>>, // components/policy-recompute-outcome.data.ts
  Expect<Holds<typeof PolicyStepOutcome, PolicyStepOutcome>>, // components/policy-recompute-outcome.data.ts
  Expect<Holds<typeof PolicySweepOutcome, PolicySweepOutcome>>, // components/policy-recompute-outcome.data.ts
  Expect<Holds<typeof ClientStatsOutcome, ClientStatsOutcome>>, // components/client-stats-outcome.data.ts
  Expect<Holds<typeof CapacityTrigger, CapacityTrigger>>, // components/capacity-trigger.data.ts
];

// (3) SCREAMING values.
export type StatsOpsScreamingChecks = [
  Expect<Screaming<BackfillJobName>>,
  Expect<Screaming<RecomputeJobName>>,
  Expect<Screaming<BackfillPhase>>,
  Expect<Screaming<BackfillStart>>,
  Expect<Screaming<SubjectVisitOutcome>>,
  Expect<Screaming<CancellationAttribution>>,
  Expect<Screaming<StatsWriteDecision>>,
  Expect<Screaming<PolicyPassVerdict>>,
  Expect<Screaming<AttemptOutcome>>,
  Expect<Screaming<PolicyStartOutcome>>,
  Expect<Screaming<PolicyStepOutcome>>,
  Expect<Screaming<PolicySweepOutcome>>,
  Expect<Screaming<ClientStatsOutcome>>,
  Expect<Screaming<CapacityTrigger>>,
];

// (4) N15 — a dictionary's field is camelCase(Dictionary), typed exactly by it.
export type StatsOpsDictionaryFields = [
  Expect<Equals<BackfillJob['backfillJobName'], BackfillJobName>>, // entities/backfill-job.entity.ts (N15: `BackfillJob` is the entity)
  Expect<Equals<BackfillRequest['backfillJobName'], BackfillJobName>>, // systems/backfill-plan.system.ts
  Expect<Equals<PolicyRecomputeJob['recomputeJobName'], RecomputeJobName>>, // entities/policy-recompute-job.entity.ts
  Expect<Equals<BackfillPosition['backfillPhase'], BackfillPhase>>, // systems/backfill-plan.system.ts
  Expect<Equals<BackfillStartRequest['backfillStart'], BackfillStart>>, // systems/backfill-plan.system.ts
  Expect<
    Equals<SubjectVisitOutcomeState['subjectVisitOutcome'], SubjectVisitOutcome>
  >, // systems/client-stats.system.ts
  Expect<
    Equals<ClientStatsWritePlan['statsWriteDecision'], StatsWriteDecision>
  >, // systems/client-stats.system.ts
  Expect<Equals<PolicyPassJudgement['policyPassVerdict'], PolicyPassVerdict>>, // systems/policy-recompute-job.system.ts
  Expect<Equals<AttemptFailure['attemptOutcome'], AttemptOutcome>>, // systems/trigger-attempt.system.ts
  Expect<Equals<AttemptLine['attemptOutcome'], AttemptOutcome>>, // systems/trigger-attempt.system.ts
];

// The checks are not vacuous.
export type ProbeStatsOpsNotScreaming = Expect<
  // @ts-expect-error — the pre-flatten lower-case value fails the SCREAMING check.
  Screaming<'clientStats'>
>;
