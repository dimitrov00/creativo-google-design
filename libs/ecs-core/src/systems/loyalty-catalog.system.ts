import {
  Result,
  type BadgeCategoryId,
  type BadgeSeriesId,
  type BarberId,
  type SeasonId,
  type TierId,
  type LocalDate,
} from '@core/primitives';
import { EngagementError, type LoyaltyCatalogError } from '@core/errors';
import { BadgeSubject, SeasonKind, SeasonPhase } from '@core/components';
import type {
  BadgeCategory,
  BadgeSeries,
  CatalogCategoryRef,
  CatalogRewardRef,
  CatalogSeasonRef,
  CatalogSeriesRef,
  CatalogStreakRef,
  CatalogSubjectRef,
  CatalogTierRef,
  CatalogWindowRef,
  LoyaltyCatalogParts,
  RewardCatalogItem,
  Season,
  StreakDefinition,
  TierDefinition,
} from '@core/entities';
import { BadgeSystem } from './badge.system';
import { SeasonSystem } from './season.system';
import { StreakRuleSystem, type StreakSchedule } from './streak-rule.system';

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
 * rules name, and handed back as the very rows it was given, sorted. The
 * input — the generic `LoyaltyCatalogParts` and its `Catalog*Ref` bounds —
 * is ONE declaration in the entities tier (`loyalty-catalog.ts`), below
 * both the ports that read it and this system that validates it (pass D,
 * D-7.5); the validated OUTPUT, `ValidLoyaltyCatalog`, is this system's.
 */

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

  /**
   * The family's season or event has ended on `today`: it keeps the levels
   * it reached and can reach no more. `false` for a family of a shelf, and
   * for one whose season the catalogue does not hold.
   */
  inEndedSeason(
    catalog: { readonly seasons: readonly CatalogSeasonRef[] },
    series: { readonly seasonId: SeasonId | null },
    today: LocalDate,
  ): boolean {
    if (series.seasonId === null) return false;
    const season = find(catalog.seasons, series.seasonId);
    return (
      season !== null &&
      SeasonSystem.phaseOn(season, today) === SeasonPhase.Ended
    );
  },

  /**
   * The windows a page shows on `today`: the running SEASON (the first open
   * one, in the order they opened; `null` when none runs), and the events —
   * the open ones, then the announced ones, each in the order they open. An
   * announced season is not a window yet; an ended one is the archive's.
   */
  windowsOn<N extends CatalogWindowRef>(
    catalog: { readonly seasons: readonly N[] },
    today: LocalDate,
  ): { readonly season: N | null; readonly events: readonly N[] } {
    const open = LoyaltyCatalogSystem.seasonsIn(
      catalog,
      SeasonPhase.Open,
      today,
    );
    const announced = LoyaltyCatalogSystem.seasonsIn(
      catalog,
      SeasonPhase.Announced,
      today,
    );
    let season: N | null = null;
    const events: N[] = [];
    for (let i = 0; i < open.length; i++) {
      const window = open[i] as N;
      if (window.seasonKind === SeasonKind.Season) {
        if (season === null) season = window;
      } else if (window.seasonKind === SeasonKind.Event) {
        events.push(window);
      }
    }
    for (let i = 0; i < announced.length; i++) {
      const window = announced[i] as N;
      if (window.seasonKind === SeasonKind.Event) events.push(window);
    }
    return { season, events };
  },

  /**
   * The ended seasons and events the client took part in, newest first (as
   * {@link seasonsIn} orders the ended): those with a track value of theirs,
   * or holding a family the client started — the track or another.
   */
  archivedFor<N extends CatalogSeasonRef>(
    catalog: { readonly seasons: readonly N[] },
    today: LocalDate,
    startedSeriesIds: ReadonlySet<BadgeSeriesId>,
    seasonProgressIds: ReadonlySet<SeasonId>,
  ): readonly N[] {
    const ended = LoyaltyCatalogSystem.seasonsIn(
      catalog,
      SeasonPhase.Ended,
      today,
    );
    const out: N[] = [];
    for (let i = 0; i < ended.length; i++) {
      const season = ended[i] as N;
      if (seasonProgressIds.has(season.id)) {
        out.push(season);
        continue;
      }
      const familyIds = SeasonSystem.familyIds(season);
      for (let k = 0; k < familyIds.length; k++) {
        if (startedSeriesIds.has(familyIds[k] as BadgeSeriesId)) {
          out.push(season);
          break;
        }
      }
    }
    return out;
  },

  /**
   * Whether the shop runs a rhythm on `today`: a head of the catalogue whose
   * rule in force is switched on — `flag ∧ some head isOnOn(head, today,
   * true)`, built on {@link StreakRuleSystem.isOnOn}, never a second reading
   * of the rule. The caller's flag (the `loyalty.streaks` switch) can only
   * turn it off; `true` never turns on a rule that is off.
   */
  rhythmLive(
    catalog: { readonly streaks: readonly StreakSchedule[] },
    today: LocalDate,
    flag: boolean,
  ): boolean {
    if (!flag) return false;
    for (let i = 0; i < catalog.streaks.length; i++) {
      if (
        StreakRuleSystem.isOnOn(
          catalog.streaks[i] as StreakSchedule,
          today,
          true,
        )
      ) {
        return true;
      }
    }
    return false;
  },

  /**
   * The barbers the catalogue names: the subject of every family about a
   * barber that is not withdrawn, each barber once, in the catalogue's
   * order — the fallback when the shop's own list is not at hand.
   */
  barberIds(catalog: {
    readonly families: readonly CatalogSubjectRef[];
  }): readonly BarberId[] {
    const seen = new Set<BarberId>();
    const out: BarberId[] = [];
    for (let i = 0; i < catalog.families.length; i++) {
      const family = catalog.families[i] as CatalogSubjectRef;
      if (
        family.badgeSubject !== BadgeSubject.Barber ||
        BadgeSystem.isRetired(family)
      ) {
        continue;
      }
      if (seen.has(family.subjectBarberId)) continue;
      seen.add(family.subjectBarberId);
      out.push(family.subjectBarberId);
    }
    return out;
  },

  /**
   * Where a family's shelf stands among the shelves: its shelf's `order`;
   * a family of no shelf (a season's) or of one the catalogue lacks ranks
   * after every shelf (`+Infinity`). The one home of the rule — the cue's
   * order ({@link LoyaltyCatalogSystem.cueOrdered}) and the closest levels'
   * ties (`StandingSystem.closestLevels`) both rank by it.
   */
  shelfRank(
    catalog: { readonly categories: readonly CatalogCategoryRef[] },
    series: { readonly categoryId: BadgeCategoryId | null },
  ): number {
    if (series.categoryId === null) return Number.POSITIVE_INFINITY;
    return (
      find(catalog.categories, series.categoryId)?.order ??
      Number.POSITIVE_INFINITY
    );
  },

  /**
   * Which family a cue names first: shelves before seasons — a family's
   * shelf by {@link LoyaltyCatalogSystem.shelfRank} — then the catalogue's
   * own `order`. A stable sort: families equal on both keep the order they
   * came in.
   */
  cueOrdered<S extends CatalogSeriesRef>(
    catalog: { readonly categories: readonly CatalogCategoryRef[] },
    series: readonly S[],
  ): readonly S[] {
    return [...series].sort(
      (a, b) =>
        LoyaltyCatalogSystem.shelfRank(catalog, a) -
          LoyaltyCatalogSystem.shelfRank(catalog, b) || a.order - b.order,
    );
  },
} as const;
