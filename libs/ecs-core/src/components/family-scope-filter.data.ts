import type { BadgeCategoryId, LocalDate, SeasonId } from '@core/primitives';

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
