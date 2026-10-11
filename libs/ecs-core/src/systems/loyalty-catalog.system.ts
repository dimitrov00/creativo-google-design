import {
  EngagementError,
  Result,
  type BadgeCategoryId,
  type BadgeSeriesId,
  type SeasonId,
  type StreakDefinitionId,
  type TierId,
  type LocalDate,
} from '@core/primitives';
import { SeasonPhase, type StreakRule } from '@core/components';
import type {
  BadgeCategory,
  BadgeSeries,
  RewardCatalogItem,
  Season,
  StreakDefinition,
  TierDefinition,
} from '@core/entities';
import { SeasonSystem } from './season.system';
import { StreakRuleSystem } from './streak-rule.system';

/*
 * THE PUBLISHED LOYALTY CATALOGUE (client-card-redesign §4.1,
 * `loyalty-catalog.ts:43-235`) — shelves, medal families, seasons, tiers,
 * rewards and the rhythm — read and validated as ONE model: a family that
 * points at a missing shelf, a season listing a family that is not there,
 * two entries under one id, tiers that do not rise or a reward that costs
 * nothing fail the catalogue as a whole rather than rendering half a page.
 * Every list comes back in display order; a lookup is a linear scan (a
 * catalogue is a few dozen rows).
 *
 * Generic over the rows: each list is read through the few fields its
 * rules name, and handed back as the very rows it was given, sorted.
 */

/** What a catalogue reads of a shelf. */
export type CatalogCategoryRef = Pick<BadgeCategory, 'id' | 'order'>;
/** What a catalogue reads of a family. */
export type CatalogSeriesRef = Pick<
  BadgeSeries,
  'id' | 'categoryId' | 'seasonId' | 'order'
>;
/** What a catalogue reads of a season. */
export type CatalogSeasonRef = Pick<
  Season,
  'id' | 'windowFrom' | 'windowUntil' | 'trackSeriesId' | 'seriesIds'
>;
/** What a catalogue reads of a tier. */
export type CatalogTierRef = Pick<
  TierDefinition,
  'id' | 'rank' | 'qualifyAtLeast'
>;
/** What a catalogue reads of a reward. */
export type CatalogRewardRef = Pick<RewardCatalogItem, 'id' | 'cost' | 'order'>;
/** What a catalogue reads of a rhythm's head. */
export type CatalogStreakRef = Pick<StreakDefinition, 'id'>;

/** The lists a catalogue is built of, in any order. */
export type LoyaltyCatalogParts<
  C extends CatalogCategoryRef = BadgeCategory,
  S extends CatalogSeriesRef = BadgeSeries,
  N extends CatalogSeasonRef = Season,
  T extends CatalogTierRef = TierDefinition,
  R extends CatalogRewardRef = RewardCatalogItem,
  H extends CatalogStreakRef = StreakDefinition,
> = {
  readonly categories: readonly C[];
  readonly series: readonly S[];
  readonly seasons: readonly N[];
  readonly tiers: readonly T[];
  readonly rewards: readonly R[];
  /** The rhythm's heads: the version in force and the one that waits. `[]` for a catalogue without a rhythm. */
  readonly streaks: readonly H[];
};

/** The catalogue, validated, every list in display order. */
export type ValidLoyaltyCatalog<
  C extends CatalogCategoryRef = BadgeCategory,
  S extends CatalogSeriesRef = BadgeSeries,
  N extends CatalogSeasonRef = Season,
  T extends CatalogTierRef = TierDefinition,
  R extends CatalogRewardRef = RewardCatalogItem,
  H extends CatalogStreakRef = StreakDefinition,
> = {
  /** The shelves, by `order`, then id. */
  readonly categories: readonly C[];
  /** Every family, retired ones included, by `order`, then id. */
  readonly families: readonly S[];
  /** Seasons and events, by the day they open, then id. */
  readonly seasons: readonly N[];
  /** By rank, lowest first. */
  readonly tiers: readonly T[];
  /** By `order`, then id. */
  readonly rewards: readonly R[];
  /** The rhythm's heads, by id. */
  readonly streaks: readonly H[];
};

/** What the catalogue as a whole refuses. */
export type LoyaltyCatalogError =
  | EngagementError.LoyaltyCatalogDuplicateId
  | EngagementError.LoyaltyCatalogDanglingCategory
  | EngagementError.LoyaltyCatalogDanglingSeason
  | EngagementError.LoyaltyCatalogTiersNotRising
  | EngagementError.LoyaltyCatalogCostNotPositive;

/** The collections a duplicate id is named by — the stored collection names. */
const COLLECTION = {
  Categories: 'badgeCategories',
  Series: 'badgeSeries',
  Seasons: 'seasons',
  Tiers: 'tierDefinitions',
  Rewards: 'rewardsCatalog',
  Streaks: 'streakDefinitions',
} as const;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byOrderThenId(
  a: { readonly order: number; readonly id: string },
  b: { readonly order: number; readonly id: string },
): number {
  return a.order - b.order || compareText(a.id, b.id);
}

/** Every id said more than once, each once, in the order the repeat was met. */
function duplicates(
  collection: string,
  rows: readonly { readonly id: string }[],
  into: LoyaltyCatalogError[],
): void {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const id = (rows[i] as { readonly id: string }).id;
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  for (const id of repeated) {
    into.push(EngagementError.loyaltyCatalogDuplicateId(collection, id));
  }
}

function find<X extends { readonly id: string }>(
  rows: readonly X[],
  id: string,
): X | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as X;
    if (row.id === id) return row;
  }
  return null;
}

export const LoyaltyCatalogSystem = {
  /**
   * The catalogue as ONE model, every fault at once: ids unique per
   * collection; every family's shelf and season present; every family a
   * season lists present and in that season; tiers asking strictly more as
   * they rank higher; every reward costing a positive whole number of
   * points. The lists come back sorted, as the rows they were.
   */
  validate<
    C extends CatalogCategoryRef,
    S extends CatalogSeriesRef,
    N extends CatalogSeasonRef,
    T extends CatalogTierRef,
    R extends CatalogRewardRef,
    H extends CatalogStreakRef,
  >(
    parts: LoyaltyCatalogParts<C, S, N, T, R, H>,
  ): Result<
    ValidLoyaltyCatalog<C, S, N, T, R, H>,
    readonly LoyaltyCatalogError[]
  > {
    const errors: LoyaltyCatalogError[] = [];
    duplicates(COLLECTION.Categories, parts.categories, errors);
    duplicates(COLLECTION.Series, parts.series, errors);
    duplicates(COLLECTION.Seasons, parts.seasons, errors);
    duplicates(COLLECTION.Tiers, parts.tiers, errors);
    duplicates(COLLECTION.Rewards, parts.rewards, errors);
    duplicates(COLLECTION.Streaks, parts.streaks, errors);

    for (let i = 0; i < parts.series.length; i++) {
      const family = parts.series[i] as S;
      if (
        family.categoryId !== null &&
        find(parts.categories, family.categoryId) === null
      ) {
        errors.push(
          EngagementError.loyaltyCatalogDanglingCategory(
            family.id,
            family.categoryId,
          ),
        );
      }
      if (
        family.seasonId !== null &&
        find(parts.seasons, family.seasonId) === null
      ) {
        errors.push(
          EngagementError.loyaltyCatalogDanglingSeason(
            family.seasonId,
            family.id,
          ),
        );
      }
    }
    for (let i = 0; i < parts.seasons.length; i++) {
      const season = parts.seasons[i] as N;
      const familyIds = SeasonSystem.familyIds(season);
      for (let k = 0; k < familyIds.length; k++) {
        const seriesId = familyIds[k] as BadgeSeriesId;
        const family = find(parts.series, seriesId);
        if (family === null || family.seasonId !== season.id) {
          errors.push(
            EngagementError.loyaltyCatalogDanglingSeason(season.id, seriesId),
          );
        }
      }
    }

    const tiers = [...parts.tiers].sort((a, b) => a.rank - b.rank);
    let rising = true;
    for (let i = 1; i < tiers.length; i++) {
      if (
        (tiers[i] as T).qualifyAtLeast <= (tiers[i - 1] as T).qualifyAtLeast
      ) {
        rising = false;
      }
    }
    if (!rising) {
      const ids: TierId[] = [];
      for (let i = 0; i < tiers.length; i++) ids.push((tiers[i] as T).id);
      errors.push(EngagementError.loyaltyCatalogTiersNotRising(ids));
    }
    for (let i = 0; i < parts.rewards.length; i++) {
      const reward = parts.rewards[i] as R;
      if (!Number.isInteger(reward.cost) || reward.cost <= 0) {
        errors.push(
          EngagementError.loyaltyCatalogCostNotPositive(reward.id, reward.cost),
        );
      }
    }

    if (errors.length > 0) return Result.err(errors);
    return Result.ok({
      categories: [...parts.categories].sort(byOrderThenId),
      families: [...parts.series].sort(byOrderThenId),
      seasons: [...parts.seasons].sort(
        (a, b) =>
          compareText(a.windowFrom, b.windowFrom) || compareText(a.id, b.id),
      ),
      tiers,
      rewards: [...parts.rewards].sort(byOrderThenId),
      streaks: [...parts.streaks].sort((a, b) => compareText(a.id, b.id)),
    });
  },

  /** A shelf by id, or `null`. */
  category<C extends CatalogCategoryRef>(
    catalog: { readonly categories: readonly C[] },
    id: BadgeCategoryId,
  ): C | null {
    return find(catalog.categories, id);
  },

  /** A family by id, or `null`. */
  series<S extends CatalogSeriesRef>(
    catalog: { readonly families: readonly S[] },
    id: BadgeSeriesId,
  ): S | null {
    return find(catalog.families, id);
  },

  /** A shelf's families, by `order`, retired ones included (the caller knows who started them). */
  seriesIn<S extends CatalogSeriesRef>(
    catalog: { readonly families: readonly S[] },
    categoryId: BadgeCategoryId,
  ): readonly S[] {
    const out: S[] = [];
    for (let i = 0; i < catalog.families.length; i++) {
      const family = catalog.families[i] as S;
      if (family.categoryId === categoryId) out.push(family);
    }
    return out;
  },

  /** A season by id, or `null`. */
  season<N extends CatalogSeasonRef>(
    catalog: { readonly seasons: readonly N[] },
    id: SeasonId,
  ): N | null {
    return find(catalog.seasons, id);
  },

  /**
   * The seasons and events in one phase on a shop day: the running and the
   * announced in the order they open, the ended newest first — the archive
   * reads back from the latest.
   */
  seasonsIn<N extends CatalogSeasonRef>(
    catalog: { readonly seasons: readonly N[] },
    phase: SeasonPhase,
    today: LocalDate,
  ): readonly N[] {
    const inPhase: N[] = [];
    for (let i = 0; i < catalog.seasons.length; i++) {
      const season = catalog.seasons[i] as N;
      if (SeasonSystem.phaseOn(season, today) === phase) {
        inPhase.push(season);
      }
    }
    return phase === SeasonPhase.Ended
      ? inPhase.sort(
          (a, b) =>
            compareText(b.windowUntil, a.windowUntil) ||
            compareText(a.id, b.id),
        )
      : inPhase;
  },

  /** A tier by id, or `null`. */
  tier<T extends CatalogTierRef>(
    catalog: { readonly tiers: readonly T[] },
    id: TierId,
  ): T | null {
    return find(catalog.tiers, id);
  },

  /** A rhythm's head by id, or `null`. */
  streak<H extends CatalogStreakRef>(
    catalog: { readonly streaks: readonly H[] },
    id: StreakDefinitionId,
  ): H | null {
    return find(catalog.streaks, id);
  },

  /**
   * The rule a shop day is judged by, or `null` when the catalogue holds no
   * such rhythm. A rule that is switched off is still the rule in force:
   * whoever draws the rhythm asks it whether it is `enabled`.
   */
  streakInForce(
    catalog: {
      readonly streaks: readonly Pick<StreakDefinition, 'id' | 'rules'>[];
    },
    id: StreakDefinitionId,
    today: LocalDate,
  ): StreakRule | null {
    const head = find(catalog.streaks, id);
    return head === null ? null : StreakRuleSystem.inForceOn(head, today);
  },
} as const;
