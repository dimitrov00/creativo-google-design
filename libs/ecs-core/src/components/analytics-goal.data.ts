import {
  BarberId,
  Currency,
  MonthKey,
  PriceCents,
  Result,
  StoredFields,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { AnalyticsError } from '@core/errors';

/**
 * A scope's takings goal for one month (`docs/designs/staff-analytics-v2.md`,
 * «Goals (PR 6)») — the body of `analyticsGoals/{key}`, flat (Law 6) under
 * the `goal` prefix: a range in cents (`goalLowCents ≤ goalHighCents`, both
 * positive — {@link AnalyticsGoal.rangeOf} is the ONE home of that rule),
 * the month, who set it and when. `barberId` is the scope: a barber record,
 * or `null` for the shop's goal. The currency is `'EUR'`, fixed by the
 * pipeline (`Currency.EUR`); the report hands the range back as
 * `reportGoalLowCents` / `reportGoalHighCents` and the system paces it
 * (`StaffAnalyticsSystem.goalPaceOf`). No zone and no time of day: a goal
 * is a month's, on the shop's calendar.
 */
export type AnalyticsGoal = {
  /** The barber record the goal is for; `null` for the shop. */
  readonly barberId: BarberId | null;
  readonly goalMonth: MonthKey;
  /** The range's low bound — positive, in minor units. */
  readonly goalLowCents: PriceCents;
  /** The range's high bound — at least the low one. */
  readonly goalHighCents: PriceCents;
  readonly currency: Currency;
  /** The account that set it — the barber, or the admin for the shop's. */
  readonly goalSetByUserId: UserId;
  /** When it was set — a lifecycle stamp (T2), the pipeline's clock. */
  readonly goalSetAtUtcMs: UtcEpochMs;
};

/** The admitted bounds of a goal — what the pipeline stores and the sheet accepts. */
export type AnalyticsGoalRange = {
  readonly goalLowCents: PriceCents;
  readonly goalHighCents: PriceCents;
};

export const AnalyticsGoal = {
  /**
   * The range rule, ONCE (the design's «Errors»): both bounds positive
   * whole cents (`PriceCents.is` and `> 0`), the high one at least the low
   * one. The refusal names the field at fault — `goalLowCents` when the low
   * bound is no positive price, else `goalHighCents`. The pipeline refuses
   * through it; the screen's sheet asks it before dialling, instead of
   * restating the rule.
   */
  rangeOf(
    goalLowCents: number,
    goalHighCents: number,
  ): Result<AnalyticsGoalRange, AnalyticsError> {
    if (!PriceCents.is(goalLowCents) || goalLowCents <= 0) {
      return Result.err(AnalyticsError.goalInvalidRange('goalLowCents'));
    }
    if (!PriceCents.is(goalHighCents) || goalHighCents < goalLowCents) {
      return Result.err(AnalyticsError.goalInvalidRange('goalHighCents'));
    }
    return Result.ok({ goalLowCents, goalHighCents });
  },

  /**
   * A goal call's intent: no range at all (both bounds `null`) REMOVES the
   * month's goal and answers `null`; one bound without the other refuses
   * the missing one; two bounds are {@link rangeOf}'s question.
   */
  rangeOrClearOf(
    goalLowCents: number | null,
    goalHighCents: number | null,
  ): Result<AnalyticsGoalRange | null, AnalyticsError> {
    if (goalLowCents === null && goalHighCents === null) {
      return Result.ok(null);
    }
    if (goalLowCents === null) {
      return Result.err(AnalyticsError.goalInvalidRange('goalLowCents'));
    }
    if (goalHighCents === null) {
      return Result.err(AnalyticsError.goalInvalidRange('goalHighCents'));
    }
    return AnalyticsGoal.rangeOf(goalLowCents, goalHighCents);
  },

  /**
   * The read-time door (edge hardening D-1) for a stored body: every field
   * present and of its primitive's shape — the scope `null` or a barber id,
   * a `MonthKey`, two prices with the high one at least the low one and the
   * low one positive, a known currency, the setter's uid and the stamp.
   * `false` for anything else; no allocation.
   */
  is(raw: unknown): raw is AnalyticsGoal {
    if (!StoredFields.isRecord(raw)) return false;
    const barberId = StoredFields.field(raw, 'barberId');
    const low = StoredFields.field(raw, 'goalLowCents');
    const high = StoredFields.field(raw, 'goalHighCents');
    return (
      (barberId === null || BarberId.is(barberId)) &&
      MonthKey.is(StoredFields.field(raw, 'goalMonth')) &&
      PriceCents.is(low) &&
      low > 0 &&
      PriceCents.is(high) &&
      high >= low &&
      Currency.is(StoredFields.field(raw, 'currency')) &&
      UserId.is(StoredFields.field(raw, 'goalSetByUserId')) &&
      UtcEpochMs.is(StoredFields.field(raw, 'goalSetAtUtcMs'))
    );
  },
} as const;
