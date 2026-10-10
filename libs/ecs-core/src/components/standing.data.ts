import type { BadgeCategoryId } from '../entities/badge-category.entity';
import type { SeriesId } from '../entities/badge-series.entity';
import type { SeasonId } from '../entities/season.entity';
import type { DayKey } from './day-key.data';

/**
 * STANDING — what the card derives from one client's progress against the
 * catalogue (client-card-redesign §4.2, `standing.ts:25-43`). The shapes
 * StandingSystem answers in; the math (`earnedLevelCount`, `familiesIn`,
 * `closestLevels`, `recentLevelsByDay`) is the system's. Numbers, ids and
 * day keys only — the Roman numeral a level is drawn with is a template
 * pipe, never a field.
 */

/** A family's next level, and how far the client is from it. */
export type ClosestLevel = {
  readonly seriesId: SeriesId;
  readonly level: number;
  readonly value: number;
  readonly target: number;
};

/** The levels earned on one shop-calendar day — one rail item, however many. */
export type EarnedDay = {
  readonly day: DayKey;
  readonly levels: readonly EarnedDay.Level[];
};

export const EarnedDay = {
  of(day: DayKey, levels: readonly EarnedDay.Level[]): EarnedDay {
    return { day, levels };
  },
  level(
    seriesId: SeriesId,
    level: number,
    earnedAtMs: number,
  ): EarnedDay.Level {
    return { seriesId, level, earnedAtMs };
  },
} as const;

/** Which families one scope page draws, by kind. */
export const FamilyScopeKind = {
  /** A shelf of «Постижения». */
  Category: 'category',
  /** A season's own families (its track is the gauge above the grid). */
  Season: 'season',
  /** Every family of the windows that have ended. */
  Archive: 'archive',
  /** The families with a level earned on one day. */
  Day: 'day',
} as const;
export type FamilyScopeKind =
  (typeof FamilyScopeKind)[keyof typeof FamilyScopeKind];

/** What one scope page draws: a shelf, a season, the archive of ended windows, or one day's levels. */
export type FamilyScope =
  | FamilyScope.Category
  | FamilyScope.Season
  | FamilyScope.Archive
  | FamilyScope.Day;

export const FamilyScope = {
  category(categoryId: BadgeCategoryId): FamilyScope.Category {
    return { kind: FamilyScopeKind.Category, categoryId };
  },
  season(seasonId: SeasonId): FamilyScope.Season {
    return { kind: FamilyScopeKind.Season, seasonId };
  },
  archive(): FamilyScope.Archive {
    return { kind: FamilyScopeKind.Archive };
  },
  day(day: DayKey): FamilyScope.Day {
    return { kind: FamilyScopeKind.Day, day };
  },
} as const;

export namespace EarnedDay {
  export type Level = {
    readonly seriesId: SeriesId;
    readonly level: number;
    readonly earnedAtMs: number;
  };
}

export namespace FamilyScope {
  export type Category = {
    readonly kind: typeof FamilyScopeKind.Category;
    readonly categoryId: BadgeCategoryId;
  };
  export type Season = {
    readonly kind: typeof FamilyScopeKind.Season;
    readonly seasonId: SeasonId;
  };
  export type Archive = { readonly kind: typeof FamilyScopeKind.Archive };
  export type Day = {
    readonly kind: typeof FamilyScopeKind.Day;
    readonly day: DayKey;
  };
}
