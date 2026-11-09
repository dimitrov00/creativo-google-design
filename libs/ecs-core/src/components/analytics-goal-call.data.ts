import {
  AnalyticsGoalKey,
  type BarberId,
  type MonthKey,
  type PriceCents,
  Result,
  StoredFields,
  UtcEpochMs,
} from '@core/primitives';
import type { PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';

/**
 * What the `setAnalyticsGoal` callable is asked for
 * (`docs/designs/staff-analytics-v2.md`, Pipelines · `setAnalyticsGoal`) —
 * flat (Law 6): the scope and the month's range. `scopeBarberId: null` is
 * the shop for an admin and the caller's own barber record for a barber,
 * as `AnalyticsCall` spells it; the currency is not sent — the pipeline
 * fixes `'EUR'`. The range rule is `AnalyticsGoal.rangeOf`'s and the month
 * rule (the current or the next month on the shop's clock) the pipeline's
 * (`StaffAnalyticsSystem.goalMonthAllowed`); the wire reads each field
 * through its primitive's guard only.
 */
export type SetAnalyticsGoalCall = {
  readonly scopeBarberId: BarberId | null;
  readonly goalMonth: MonthKey;
  readonly goalLowCents: PriceCents;
  readonly goalHighCents: PriceCents;
};

export const SetAnalyticsGoalCall = {
  /**
   * `setAnalyticsGoal`'s answer — the key the goal now sits under and the
   * instant it was set, each through its primitive's guard (`CallAnswer`,
   * Law 7.4); anything missing or malformed is `PIPELINE_UNKNOWN`, the
   * whole answer refused.
   */
  decodeSet(raw: unknown): Result<SetAnalyticsGoalCall.Set, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const goalKey = CallAnswer.parsed(
      answer,
      'goalKey',
      AnalyticsGoalKey.parse,
    );
    const goalSetAtUtcMs = StoredFields.field(answer, 'goalSetAtUtcMs');
    return goalKey === null || !UtcEpochMs.is(goalSetAtUtcMs)
      ? CallAnswer.unusable()
      : Result.ok({ goalKey, goalSetAtUtcMs });
  },
} as const;

export namespace SetAnalyticsGoalCall {
  /** The goal as stored: its document key and the set's stamp. */
  export type Set = {
    readonly goalKey: AnalyticsGoalKey;
    readonly goalSetAtUtcMs: UtcEpochMs;
  };
}
