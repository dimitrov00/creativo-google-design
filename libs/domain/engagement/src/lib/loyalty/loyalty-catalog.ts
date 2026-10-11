import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  BadgeCategoryId as CategoryRefId,
  BadgeSeriesId as SeriesRefId,
  type CatalogCategoryRef,
  type CatalogRewardRef,
  type CatalogSeasonRef,
  type CatalogSeriesRef,
  type CatalogStreakRef,
  type CatalogTierRef,
  EngagementErrorCode,
  LocalDate,
  type ValidLoyaltyCatalog as SystemCatalog,
  type LoyaltyCatalogError as SystemCatalogError,
  LoyaltyCatalogSystem,
  Points,
  RewardId,
  SeasonId as SeasonRefId,
  SeasonPhase as SystemSeasonPhase,
  StreakDefinitionId,
  TierId,
  defect,
} from '@creativo/ecs-core';
import type { BadgeCategory } from './badge-category';
import type { BadgeSeries } from './badge-series';
import type { RewardCatalogItem, TierDefinition } from './catalog-entries';
import type { IsoDate } from './loyalty-calendar';
import {
  LoyaltyCatalogCostNotPositiveError,
  LoyaltyCatalogDanglingCategoryError,
  LoyaltyCatalogDanglingSeasonError,
  LoyaltyCatalogDuplicateIdError,
  LoyaltyCatalogError,
  LoyaltyCatalogTiersNotRisingError,
} from './loyalty-catalog.errors';
import type { Season, SeasonPhase } from './season';
import type { StreakDefinition } from './streak-definition';
import type { StreakDefinitionSchedule } from './streak-schedule';

/*
 * The published loyalty catalogue as a class — a thin shim since the ECS
 * migration's Phase 2: validation, display order and every lookup are
 * `LoyaltyCatalogSystem` (`@creativo/ecs-core`, `loyalty-catalog.system.ts`),
 * run over light rows that carry the legacy object they stand for
 * (`source`). The bridge is the private helpers at the end.
 */

export interface LoyaltyCatalogParts {
  categories: readonly BadgeCategory[];
  series: readonly BadgeSeries[];
  seasons: readonly Season[];
  tiers: readonly TierDefinition[];
  rewards: readonly RewardCatalogItem[];
  /**
   * The rhythm's rules, each as its head: the version in force and the one
   * that waits. Optional, and none by default, so a catalogue built
   * without a rhythm is still a catalogue.
   */
  streakSchedules?: readonly StreakDefinitionSchedule[];
}

/**
 * The published loyalty catalogue — shelves, medal families, seasons,
 * tiers, rewards and the rhythm — read and validated as ONE model: a
 * family that points at a missing shelf, a season listing a family that is
 * not there, two entries under one id, tiers that do not rise or a reward
 * that costs nothing fail the catalogue as a whole rather than rendering
 * half a page. Every list comes back in display order.
 */
export class LoyaltyCatalog {
  /** The shelves, by `order`. */
  readonly categories: readonly BadgeCategory[];
  /** Every family, retired ones included, by `order`. */
  readonly families: readonly BadgeSeries[];
  /** Seasons and events, by the day they open. */
  readonly seasons: readonly Season[];
  /** By rank, lowest first. */
  readonly tiers: readonly TierDefinition[];
  /** By `order`. */
  readonly rewards: readonly RewardCatalogItem[];
  /** The rhythm's rules, by id. */
  readonly streakSchedules: readonly StreakDefinitionSchedule[];

  private constructor(private readonly refs: Refs) {
    this.categories = refs.categories.map(sourceOf);
    this.families = refs.families.map(sourceOf);
    this.seasons = refs.seasons.map(sourceOf);
    this.tiers = refs.tiers.map(sourceOf);
    this.rewards = refs.rewards.map(sourceOf);
    this.streakSchedules = refs.streaks.map(sourceOf);
  }

  static create(
    parts: LoyaltyCatalogParts,
  ): Result<LoyaltyCatalog, LoyaltyCatalogError[]> {
    const validated = LoyaltyCatalogSystem.validate({
      categories: parts.categories.map(categoryRef),
      series: parts.series.map(seriesRef),
      seasons: parts.seasons.map(seasonRef),
      tiers: parts.tiers.map(tierRef),
      rewards: parts.rewards.map(rewardRef),
      streaks: (parts.streakSchedules ?? []).map(streakRef),
    });
    return validated.ok
      ? ok(new LoyaltyCatalog(validated.value))
      : fail(validated.error.map(legacyErrorOf));
  }

  category(id: string): BadgeCategory | null {
    return (
      LoyaltyCatalogSystem.category(this.refs, CategoryRefId.of(id))?.source ??
      null
    );
  }

  series(id: string): BadgeSeries | null {
    return (
      LoyaltyCatalogSystem.series(this.refs, SeriesRefId.of(id))?.source ?? null
    );
  }

  /** A shelf's families, by `order`, retired ones included (the caller knows who started them). */
  seriesIn(categoryId: string): readonly BadgeSeries[] {
    return LoyaltyCatalogSystem.seriesIn(
      this.refs,
      CategoryRefId.of(categoryId),
    ).map(sourceOf);
  }

  season(id: string): Season | null {
    return (
      LoyaltyCatalogSystem.season(this.refs, SeasonRefId.of(id))?.source ?? null
    );
  }

  /**
   * The seasons and events in one phase on a Sofia day: the running and the
   * announced in the order they open, the ended newest first — the archive
   * reads back from the latest.
   */
  seasonsIn(phase: SeasonPhase, today: IsoDate): readonly Season[] {
    return LoyaltyCatalogSystem.seasonsIn(
      this.refs,
      SEASON_PHASE[phase],
      dayOf(today),
    ).map(sourceOf);
  }

  tier(id: string): TierDefinition | null {
    return LoyaltyCatalogSystem.tier(this.refs, TierId.of(id))?.source ?? null;
  }

  /** A rhythm's head: the rule in force and the one that waits. */
  streakSchedule(id: string): StreakDefinitionSchedule | null {
    return (
      LoyaltyCatalogSystem.streak(this.refs, StreakDefinitionId.of(id))
        ?.source ?? null
    );
  }

  /**
   * The rule a Sofia day is judged by, or `null` when the catalogue holds
   * no such rhythm. A rule that is switched off is still the rule in
   * force: whoever draws the rhythm asks it whether it is `enabled`.
   */
  streakInForce(id: string, today: IsoDate): StreakDefinition | null {
    return this.streakSchedule(id)?.inForceOn(today) ?? null;
  }
}

// ── The bridge: legacy rows ↔ ecs-core refs (Phase 4 deletes it) ─────────

/** A row as the system reads it, carrying the legacy object it stands for. */
type Ref<R, S> = R & { readonly source: S };

type Refs = SystemCatalog<
  Ref<CatalogCategoryRef, BadgeCategory>,
  Ref<CatalogSeriesRef, BadgeSeries>,
  Ref<CatalogSeasonRef, Season>,
  Ref<CatalogTierRef, TierDefinition>,
  Ref<CatalogRewardRef, RewardCatalogItem>,
  Ref<CatalogStreakRef, StreakDefinitionSchedule>
>;

const sourceOf = <S>(ref: { readonly source: S }): S => ref.source;

/** A window's phase, in the system's words. */
const SEASON_PHASE = {
  announced: SystemSeasonPhase.Announced,
  open: SystemSeasonPhase.Open,
  ended: SystemSeasonPhase.Ended,
} as const satisfies Record<SeasonPhase, SystemSeasonPhase>;

/** A Sofia day the catalogue holds: a validated window end, a clock's «today». */
function dayOf(raw: IsoDate): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

function categoryRef(
  category: BadgeCategory,
): Ref<CatalogCategoryRef, BadgeCategory> {
  return {
    id: CategoryRefId.of(category.id.value),
    order: category.order,
    source: category,
  };
}

function seriesRef(series: BadgeSeries): Ref<CatalogSeriesRef, BadgeSeries> {
  return {
    id: SeriesRefId.of(series.id.value),
    categoryId:
      series.categoryId === null
        ? null
        : CategoryRefId.of(series.categoryId.value),
    seasonId:
      series.seasonId === null ? null : SeasonRefId.of(series.seasonId.value),
    order: series.order,
    source: series,
  };
}

function seasonRef(season: Season): Ref<CatalogSeasonRef, Season> {
  return {
    id: SeasonRefId.of(season.id.value),
    windowFrom: dayOf(season.window.from),
    windowUntil: dayOf(season.window.until),
    trackSeriesId:
      season.trackSeriesId === null
        ? null
        : SeriesRefId.of(season.trackSeriesId.value),
    seriesIds: season.seriesIds.map((id) => SeriesRefId.of(id.value)),
    source: season,
  };
}

function tierRef(tier: TierDefinition): Ref<CatalogTierRef, TierDefinition> {
  return {
    id: TierId.of(tier.id),
    rank: tier.rank,
    qualifyAtLeast: tier.qualify.atLeast,
    source: tier,
  };
}

function rewardRef(
  reward: RewardCatalogItem,
): Ref<CatalogRewardRef, RewardCatalogItem> {
  return {
    id: RewardId.of(reward.id),
    cost: Points.of(reward.cost),
    order: reward.order,
    source: reward,
  };
}

function streakRef(
  schedule: StreakDefinitionSchedule,
): Ref<CatalogStreakRef, StreakDefinitionSchedule> {
  return { id: StreakDefinitionId.of(schedule.id), source: schedule };
}

/** The system's struct error as the class the legacy readers know. */
function legacyErrorOf(error: SystemCatalogError): LoyaltyCatalogError {
  switch (error.errorCode) {
    case EngagementErrorCode.LoyaltyCatalogDuplicateId:
      return new LoyaltyCatalogDuplicateIdError(error.collection, error.id);
    case EngagementErrorCode.LoyaltyCatalogDanglingCategory:
      return new LoyaltyCatalogDanglingCategoryError(
        error.seriesId,
        error.categoryId,
      );
    case EngagementErrorCode.LoyaltyCatalogDanglingSeason:
      return new LoyaltyCatalogDanglingSeasonError(
        error.seasonId,
        error.seriesId,
      );
    case EngagementErrorCode.LoyaltyCatalogTiersNotRising:
      // The rank-ordered ids.
      return new LoyaltyCatalogTiersNotRisingError([...error.tierIds]);
    default:
      return new LoyaltyCatalogCostNotPositiveError(error.rewardId, error.cost);
  }
}
