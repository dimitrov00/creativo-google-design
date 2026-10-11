import type {
  BadgeCategoryId,
  BadgeSeriesId,
  SeasonId,
} from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/**
 * STANDING — what the card derives from one client's progress against the
 * catalogue (client-card-redesign §4.2, `standing.ts:25-43`). The shapes
 * StandingSystem answers in; the math (`earnedLevelCount`, `familiesIn`,
 * `closestLevels`, `recentLevelsByDay`) is the system's. Numbers, ids and
 * shop days only — the Roman numeral a level is drawn with is a template
 * pipe, never a field.
 */

/** A family's next level, and how far the client is from it. */
export type ClosestLevel = {
  readonly badgeSeriesId: BadgeSeriesId;
  readonly level: number;
  readonly value: number;
  readonly target: number;
};

/** The levels earned on one shop-calendar day — one rail item, however many. */
export type EarnedDay = {
  readonly localDate: LocalDate;
  readonly levels: readonly EarnedDay.Level[];
};

export const EarnedDay = {
  of(localDate: LocalDate, levels: readonly EarnedDay.Level[]): EarnedDay {
    return { localDate, levels };
  },
  level(
    badgeSeriesId: BadgeSeriesId,
    level: number,
    earnedAtUtcMs: UtcEpochMs,
  ): EarnedDay.Level {
    return { badgeSeriesId, level, earnedAtUtcMs };
  },
} as const;

/** Which families one scope page draws — the discriminator `familyScope`. */
export const FamilyScope = {
  /** A shelf of «Постижения». */
  Category: 'CATEGORY',
  /** A season's own families (its track is the gauge above the grid). */
  Season: 'SEASON',
  /** Every family of the windows that have ended. */
  Archive: 'ARCHIVE',
  /** The families with a level earned on one day. */
  Day: 'DAY',
} as const;
export type FamilyScope = (typeof FamilyScope)[keyof typeof FamilyScope];

/** What one scope page draws: a shelf, a season, the archive of ended windows, or one day's levels. */
export type FamilyScopeFilter =
  | FamilyScopeFilter.Category
  | FamilyScopeFilter.Season
  | FamilyScopeFilter.Archive
  | FamilyScopeFilter.Day;

export const FamilyScopeFilter = {
  category(categoryId: BadgeCategoryId): FamilyScopeFilter.Category {
    return { familyScope: FamilyScope.Category, categoryId };
  },
  season(seasonId: SeasonId): FamilyScopeFilter.Season {
    return { familyScope: FamilyScope.Season, seasonId };
  },
  archive(): FamilyScopeFilter.Archive {
    return { familyScope: FamilyScope.Archive };
  },
  day(localDate: LocalDate): FamilyScopeFilter.Day {
    return { familyScope: FamilyScope.Day, localDate };
  },
} as const;

export namespace EarnedDay {
  export type Level = {
    readonly badgeSeriesId: BadgeSeriesId;
    readonly level: number;
    readonly earnedAtUtcMs: UtcEpochMs;
  };
}

export namespace FamilyScopeFilter {
  export type Category = {
    readonly familyScope: typeof FamilyScope.Category;
    readonly categoryId: BadgeCategoryId;
  };
  export type Season = {
    readonly familyScope: typeof FamilyScope.Season;
    readonly seasonId: SeasonId;
  };
  export type Archive = { readonly familyScope: typeof FamilyScope.Archive };
  export type Day = {
    readonly familyScope: typeof FamilyScope.Day;
    readonly localDate: LocalDate;
  };
}
