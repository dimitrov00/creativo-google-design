import {
  type AwardSummary,
  Gamification,
  MedalState,
  type BadgeLevel,
  type EarnedLevel,
  type SeriesStanding,
} from '@core/components';
import { Result } from '@core/primitives';
import { EngagementError } from '@core/errors';
import type { BadgeProgress, BadgeSeries } from '@core/entities';

/*
 * ONE MEDAL FAMILY (client-card-redesign §4.2, `badge-series.ts:57-381`):
 * where a family stands for one client — derived from that client's
 * progress document, absent = not started — so the glance, the shelves
 * and the detail page can never disagree about it; and the rules its
 * levels keep together. Ids, titles and a coupon's words are guarded at
 * the edge, not here.
 */

/** What a family's own rules refuse. */
export type BadgeSeriesError =
  | EngagementError.BadgeSeriesNoLevels
  | EngagementError.BadgeSeriesLevelGap
  | EngagementError.BadgeSeriesTargetsNotRising
  | EngagementError.BadgeSeriesHomeless
  | EngagementError.BadgeSeriesOneOffWithSeveralLevels
  | EngagementError.BadgeSeriesRepeatableWithSeveralLevels
  | EngagementError.BadgeSeriesLevelWithoutRule
  | EngagementError.BadgeSeriesAwardNotPositive;

/** The parts of a family its rules read. */
export type BadgeSeriesShape = Pick<
  BadgeSeries,
  'categoryId' | 'seasonId' | 'levels' | 'repeatable'
>;

/** The one client's progress a standing reads; `null` = not started. */
export type BadgeProgressShape = Pick<BadgeProgress, 'value' | 'earned'>;

export const BadgeSystem = {
  /**
   * Where a family stands for one client. A complete family has no `next`;
   * a yearly one is complete once earned. The rim numeral is
   * `highestLevel` (0 = none), the caption `value` / `target`.
   */
  standing(
    series: Pick<BadgeSeries, 'levels'>,
    progress: BadgeProgressShape | null,
  ): SeriesStanding {
    let highestLevel = 0;
    if (progress !== null) {
      for (let i = 0; i < progress.earned.length; i++) {
        const earned = progress.earned[i] as EarnedLevel;
        if (earned.level > highestLevel) highestLevel = earned.level;
      }
    }
    let next: BadgeLevel | null = null;
    for (let i = 0; i < series.levels.length; i++) {
      const level = series.levels[i] as BadgeLevel;
      if (level.level > highestLevel) {
        next = level;
        break;
      }
    }
    return {
      medalState:
        highestLevel > 0
          ? MedalState.Earned
          : progress !== null
            ? MedalState.InProgress
            : MedalState.NotStarted,
      highestLevel,
      next,
      value: progress?.value ?? 0,
      target: next?.target ?? null,
    };
  },

  /** A level by its number, or `null`. */
  levelAt(
    series: Pick<BadgeSeries, 'levels'>,
    level: number,
  ): BadgeLevel | null {
    for (let i = 0; i < series.levels.length; i++) {
      const candidate = series.levels[i] as BadgeLevel;
      if (candidate.level === level) return candidate;
    }
    return null;
  },

  /** Withdrawn from the catalogue: shown only where a client already started it. */
  isRetired(series: Pick<BadgeSeries, 'retiredAtUtcMs'>): boolean {
    return series.retiredAtUtcMs !== null;
  },

  /** Tenure: nothing a visit does moves it, so it never sits in «Скоро». */
  isCalendarDriven(series: Pick<BadgeSeries, 'metric'>): boolean {
    return Gamification.isCalendarDriven(series);
  },

  /**
   * One level's own rules: it names its rule, and pays positive figures
   * (`Gamification.isAwardPositive`; a coupon's words are the edge's).
   */
  levelProblems(level: BadgeLevel): readonly BadgeSeriesError[] {
    const errors: BadgeSeriesError[] = [];
    if (level.ruleId.trim().length === 0) {
      errors.push(EngagementError.badgeSeriesLevelWithoutRule(level.level));
    }
    for (let k = 0; k < level.awards.length; k++) {
      const award = level.awards[k] as AwardSummary;
      if (!Gamification.isAwardPositive(award)) {
        errors.push(
          EngagementError.badgeSeriesAwardNotPositive(
            level.level,
            award.awardKind,
          ),
        );
      }
    }
    return errors;
  },

  /**
   * The family's levels checked together, and its home: it has levels,
   * numbered 1, 2, 3 … with positive whole targets that rise, lives in a
   * category or a season, and has one level when it is a one-off act or
   * yearly (`badge-series.ts` `shapeProblems`).
   */
  shapeProblems(series: BadgeSeriesShape): readonly BadgeSeriesError[] {
    const errors: BadgeSeriesError[] = [];
    const { levels } = series;
    if (levels.length === 0) errors.push(EngagementError.badgeSeriesNoLevels());
    const numbers: number[] = [];
    const targets: number[] = [];
    let gap = false;
    let oneOff = false;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i] as BadgeLevel;
      numbers.push(level.level);
      if (level.level !== i + 1) gap = true;
      if (level.target === null) oneOff = true;
      else targets.push(level.target);
    }
    if (gap) errors.push(EngagementError.badgeSeriesLevelGap(numbers));
    let rising = true;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i] as number;
      if (
        !Number.isInteger(target) ||
        target <= 0 ||
        (i > 0 && target <= (targets[i - 1] as number))
      ) {
        rising = false;
      }
    }
    if (!rising) {
      errors.push(EngagementError.badgeSeriesTargetsNotRising(targets));
    }
    if (series.categoryId === null && series.seasonId === null) {
      errors.push(EngagementError.badgeSeriesHomeless());
    }
    if (levels.length > 1 && oneOff) {
      errors.push(EngagementError.badgeSeriesOneOffWithSeveralLevels());
    }
    if (series.repeatable && levels.length > 1) {
      errors.push(EngagementError.badgeSeriesRepeatableWithSeveralLevels());
    }
    return errors;
  },

  /**
   * Every fault of the family at once — each level's own rules, in level
   * order, then the levels together and the home. The family comes back as
   * it was handed in.
   */
  validate<S extends BadgeSeriesShape>(
    series: S,
  ): Result<S, readonly BadgeSeriesError[]> {
    const errors: BadgeSeriesError[] = [];
    for (let i = 0; i < series.levels.length; i++) {
      const problems = BadgeSystem.levelProblems(
        series.levels[i] as BadgeLevel,
      );
      for (let k = 0; k < problems.length; k++) {
        errors.push(problems[k] as BadgeSeriesError);
      }
    }
    const shape = BadgeSystem.shapeProblems(series);
    for (let i = 0; i < shape.length; i++) {
      errors.push(shape[i] as BadgeSeriesError);
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(series);
  },
} as const;
