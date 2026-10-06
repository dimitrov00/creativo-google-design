import { DomainError } from '@creativo/domain/kernel';
import type {
  EmptyIdError as CatalogEmptyIdError,
  LocalizedTextFieldEmptyError,
} from '@creativo/domain/catalog';
import type { EmptyIdError } from '../ids.errors';

export class BadgeSeriesNoLevelsError extends DomainError {
  override readonly code = 'engagement.badge_series.no_levels' as const;
  constructor() {
    super('A badge family needs at least one level');
  }
}

/** Levels are I…n, contiguous, lowest first. */
export class BadgeSeriesLevelGapError extends DomainError {
  override readonly code = 'engagement.badge_series.level_gap' as const;
  constructor(public readonly levels: readonly number[]) {
    super(
      `A badge family's levels must run 1…n in order: ${levels.join(', ')}`,
      {
        levels,
      },
    );
  }
}

/** Each target a positive whole count, each above the one before. */
export class BadgeSeriesTargetsNotRisingError extends DomainError {
  override readonly code =
    'engagement.badge_series.targets_not_rising' as const;
  constructor(public readonly targets: readonly number[]) {
    super(
      `A badge family's targets must be positive and rising: ${targets.join(', ')}`,
      { targets },
    );
  }
}

/** A family lives in a category or in a season. */
export class BadgeSeriesHomelessError extends DomainError {
  override readonly code = 'engagement.badge_series.homeless' as const;
  constructor() {
    super('A badge family must belong to a category or a season');
  }
}

/** A one-off act (`target: null`) is its family's only level. */
export class BadgeSeriesOneOffWithSeveralLevelsError extends DomainError {
  override readonly code =
    'engagement.badge_series.one_off_with_several_levels' as const;
  constructor() {
    super('A one-off badge family has exactly one level');
  }
}

/** A family earned again every year (the birthday visit) has one level. */
export class BadgeSeriesRepeatableWithSeveralLevelsError extends DomainError {
  override readonly code =
    'engagement.badge_series.repeatable_with_several_levels' as const;
  constructor() {
    super('A yearly badge family has exactly one level');
  }
}

/** Every level is awarded by its own once-rule, under its own award key. */
export class BadgeSeriesLevelWithoutRuleError extends DomainError {
  override readonly code =
    'engagement.badge_series.level_without_rule' as const;
  constructor(public readonly level: number) {
    super(`Badge level ${level} names no rule`, { level });
  }
}

/** A level pays whole, positive amounts, or nothing at all. */
export class BadgeSeriesAwardNotPositiveError extends DomainError {
  override readonly code =
    'engagement.badge_series.award_not_positive' as const;
  constructor(
    public readonly level: number,
    public readonly kind: string,
  ) {
    super(`Badge level ${level} pays a non-positive ${kind}`, { level, kind });
  }
}

export type BadgeSeriesError =
  | EmptyIdError
  | CatalogEmptyIdError
  | LocalizedTextFieldEmptyError
  | BadgeSeriesNoLevelsError
  | BadgeSeriesLevelGapError
  | BadgeSeriesTargetsNotRisingError
  | BadgeSeriesHomelessError
  | BadgeSeriesOneOffWithSeveralLevelsError
  | BadgeSeriesRepeatableWithSeveralLevelsError
  | BadgeSeriesLevelWithoutRuleError
  | BadgeSeriesAwardNotPositiveError;
