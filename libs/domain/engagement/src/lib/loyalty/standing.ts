import type { LocalizedText } from '@creativo/domain/catalog';
import {
  type BadgeCategoryId as CategoryRefId,
  type BadgeLevel as SystemLevel,
  type CatalogCategoryRef,
  type CatalogSeasonRef,
  DayKey,
  type FamilyScope as SystemScope,
  type Metric as SystemMetric,
  type Points,
  type RedeemableRewardRef,
  RewardSystem,
  type RewardId,
  type SeasonId as SeasonRefId,
  type SeriesId,
  type StandingCatalog,
  type StandingProgress,
  type StandingSeriesRef,
  StandingSystem,
  type TierId,
  type TierStepRef,
  TierSystem,
} from '@creativo/ecs-core';
import type { BadgeSeries } from './badge-series';
import type {
  RedeemProblem,
  RedemptionRecord,
  RewardCatalogItem,
  TierDefinition,
} from './catalog-entries';
import { type IsoDate, LOYALTY_ZONE } from './loyalty-calendar';
import type { LoyaltyCatalog } from './loyalty-catalog';
import type { BadgeProgress, TierState } from './projections';

/**
 * STANDING — what the card derives from one client's progress against the
 * catalogue (client-card-redesign §4.2). A thin shim since the ECS
 * migration's Phase 2: the math is `StandingSystem`, `RewardSystem` and
 * `TierSystem` (`@creativo/ecs-core`); this file carries the legacy API —
 * the class catalogue, the progress `Map`, `Date`s — across, and keeps the
 * one function that stays in the template layer (`levelNumeral`). The
 * bridge is the private helpers at the end.
 *
 * `progress` is always the client's progress documents keyed by family id;
 * a family missing from it is not started.
 */

/** A family's next level, and how far the client is from it. */
export interface ClosestLevel {
  readonly seriesId: string;
  readonly level: number;
  readonly value: number;
  readonly target: number;
}

/** The levels earned on one Sofia day — one rail item, however many. */
export interface EarnedDay {
  readonly day: IsoDate;
  readonly levels: readonly {
    readonly seriesId: string;
    readonly level: number;
    readonly earnedAt: Date;
  }[];
}

/** What one scope page draws: a shelf, a season, the archive of ended windows, or one day's levels. */
export type FamilyScope =
  | { readonly kind: 'category'; readonly categoryId: string }
  | { readonly kind: 'season'; readonly seasonId: string }
  | { readonly kind: 'archive' }
  | { readonly kind: 'day'; readonly day: IsoDate };

const NUMERALS: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/**
 * 1 → «I» … 10 → «X»; `''` for no level. Levels are numerals, never Бронз /
 * Сребро / Злато — those words are the client's TIERS.
 */
export function levelNumeral(level: number): string {
  if (!Number.isInteger(level) || level < 1) return '';
  let rest = level;
  let out = '';
  for (const [value, glyph] of NUMERALS) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

/** The summary's unit: each earned level once — a yearly level counts once however often it was earned. */
export function earnedLevelCount(
  progress: ReadonlyMap<string, BadgeProgress>,
): number {
  return StandingSystem.earnedLevelCount(progressOf(progress));
}

/**
 * The families a scope page draws, in catalogue order. A retired family
 * stays only where the client started it. A season's grid is its own
 * families (its track is the gauge above the grid); the archive is every
 * family of the windows that have ended; a day, the families with a level
 * earned on it.
 */
export function familiesIn(
  catalog: LoyaltyCatalog,
  progress: ReadonlyMap<string, BadgeProgress>,
  scope: FamilyScope,
  today: IsoDate,
): readonly BadgeSeries[] {
  return StandingSystem.familiesIn(
    catalogOf(catalog),
    progressOf(progress),
    scopeOf(scope),
    DayKey.of(today),
    LOYALTY_ZONE,
  ).map((ref) => ref.source);
}

/**
 * Shelves and scope pages count FAMILIES, the unit they draw. `earned` —
 * the families with a level, the filled discs — is the figure a shelf, a
 * season card or a group prints as «N от M»; `started` (any progress) is
 * worded where it is used («2 от 9 започнати»): beside medals, a bare
 * started count read as earned (wave D r6).
 */
export function familyCounts(
  catalog: LoyaltyCatalog,
  progress: ReadonlyMap<string, BadgeProgress>,
  scope: FamilyScope,
  today: IsoDate,
): {
  readonly started: number;
  readonly earned: number;
  readonly total: number;
} {
  return StandingSystem.familyCounts(
    catalogOf(catalog),
    progressOf(progress),
    scopeOf(scope),
    DayKey.of(today),
    LOYALTY_ZONE,
  );
}

/**
 * «Скоро» — the diversity rule (`StandingSystem.closestLevels`): one family
 * per shelf, the most specific subject among the families one visit
 * completes together, ranked by how near each is.
 */
export function closestLevels(
  catalog: LoyaltyCatalog,
  progress: ReadonlyMap<string, BadgeProgress>,
  today: IsoDate,
  limit: number,
): readonly ClosestLevel[] {
  return StandingSystem.closestLevels(
    catalogOf(catalog),
    progressOf(progress),
    DayKey.of(today),
    limit,
  );
}

/**
 * «Последни»: earned levels grouped by their Europe/Sofia day, newest day
 * first, the newest level first within a day. A day with several levels is
 * ONE rail item.
 */
export function recentLevelsByDay(
  progress: ReadonlyMap<string, BadgeProgress>,
  limit: number,
): readonly EarnedDay[] {
  return StandingSystem.recentLevelsByDay(
    progressOf(progress),
    limit,
    LOYALTY_ZONE,
  ).map((day) => ({
    day: day.day,
    levels: day.levels.map((level) => ({
      seriesId: level.seriesId,
      level: level.level,
      earnedAt: new Date(level.earnedAtMs),
    })),
  }));
}

/** «Ново»: earned after the previous visit began; before a first visit, everything is new. */
export function isNewSince(
  earnedAt: Date,
  previousVisitAtMs: number | null,
): boolean {
  return StandingSystem.isNewSince(earnedAt.getTime(), previousVisitAtMs);
}

/**
 * The one redeem gate — the callable decides with it, the card words its
 * lock line with it. `recent` = the client's non-reversed redemptions. An
 * owed (negative) balance never redeems; a paused client earns but does not
 * redeem.
 */
export function redeemProblem(
  item: RewardCatalogItem,
  ctx: {
    readonly balance: number;
    readonly today: IsoDate;
    readonly paused: boolean;
    readonly recent: readonly RedemptionRecord[];
  },
): RedeemProblem | null {
  return RewardSystem.problem(rewardRef(item), {
    balance: ctx.balance,
    today: DayKey.of(ctx.today),
    paused: ctx.paused,
    recent: ctx.recent.map((record) => ({
      rewardId: record.rewardId as RewardId,
      on: DayKey.of(record.on),
    })),
  });
}

/** The costliest reward the balance buys today (enabled, in its window, in stock); ties by catalogue order. */
export function bestAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    RewardSystem.bestAffordable(
      rewards.map(rewardRef),
      balance,
      DayKey.of(today),
    )?.source ?? null
  );
}

/** The cheapest reward the balance does not reach yet — one that points alone keep from the client. */
export function nextAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    RewardSystem.nextAffordable(
      rewards.map(rewardRef),
      balance,
      DayKey.of(today),
    )?.source ?? null
  );
}

/**
 * The tier track: every tier a step, by rank; the current step honours an
 * override; `value` and `remaining` are the account's own (qualifying
 * visits, and what the next tier still asks).
 */
export function tierSteps(
  state: TierState,
  tiers: readonly TierDefinition[],
): {
  readonly steps: readonly {
    readonly tierId: string;
    readonly atLeast: number;
    readonly name: LocalizedText;
  }[];
  readonly value: number;
  readonly currentTierId: string;
  readonly nextTierId: string | null;
  readonly remaining: number | null;
} {
  const track = TierSystem.steps(
    {
      current: state.current as TierId,
      definitionVersion: state.definitionVersion,
      sinceMs: state.since.getTime(),
      qualifying: state.qualifying,
      next: state.next as TierId | null,
      remaining: state.remaining,
      override:
        state.override === null
          ? null
          : {
              tierId: state.override.tierId as TierId,
              until: state.override.until as DayKey | null,
              source: state.override.source,
            },
    },
    tiers.map(tierRef),
  );
  return {
    ...track,
    // The tier's own name, by reference: the catalogue's `LocalizedText`.
    steps: track.steps.map((step) => ({
      tierId: step.tierId,
      atLeast: step.atLeast,
      name: step.name as LocalizedText,
    })),
  };
}

// ── The bridge: legacy class/Map/Date ↔ ecs-core struct (Phase 4 deletes it) ──

/** A row as the system reads it, carrying the legacy object it stands for. */
type Ref<R, S> = R & { readonly source: S };

function progressOf(
  progress: ReadonlyMap<string, BadgeProgress>,
): readonly StandingProgress[] {
  const out: StandingProgress[] = [];
  for (const [seriesId, p] of progress) {
    out.push({
      id: seriesId as SeriesId,
      value: p.value,
      earned: p.earned.map((earned) => ({
        level: earned.level,
        earnedAtMs: earned.earnedAt.getTime(),
        via: earned.via,
        count: earned.count,
      })),
    });
  }
  return out;
}

function seriesRef(series: BadgeSeries): Ref<StandingSeriesRef, BadgeSeries> {
  return {
    id: series.id.value as SeriesId,
    categoryId:
      series.categoryId === null
        ? null
        : (series.categoryId.value as CategoryRefId),
    seasonId:
      series.seasonId === null ? null : (series.seasonId.value as SeasonRefId),
    order: series.order,
    levels: series.levels as unknown as readonly SystemLevel[],
    metric:
      series.metric === null
        ? null
        : {
            metric: series.metric.metric as SystemMetric,
            window: null,
            where: null,
          },
    // The system reads the subject's kind alone: the same tags.
    subject: series.subject as unknown as StandingSeriesRef['subject'],
    retiredAtMs: series.retiredAt === null ? null : series.retiredAt.getTime(),
    source: series,
  };
}

function catalogOf(
  catalog: LoyaltyCatalog,
): StandingCatalog<Ref<StandingSeriesRef, BadgeSeries>> {
  return {
    categories: catalog.categories.map((category): CatalogCategoryRef => ({
      id: category.id.value as CategoryRefId,
      order: category.order,
    })),
    families: catalog.families.map(seriesRef),
    seasons: catalog.seasons.map((season): CatalogSeasonRef => ({
      id: season.id.value as SeasonRefId,
      window: {
        from: DayKey.of(season.window.from),
        until: DayKey.of(season.window.until),
      },
      trackSeriesId:
        season.trackSeriesId === null
          ? null
          : (season.trackSeriesId.value as SeriesId),
      seriesIds: season.seriesIds.map((id) => id.value as SeriesId),
    })),
  };
}

function scopeOf(scope: FamilyScope): SystemScope {
  switch (scope.kind) {
    case 'category':
      return {
        kind: 'category',
        categoryId: scope.categoryId as CategoryRefId,
      };
    case 'season':
      return { kind: 'season', seasonId: scope.seasonId as SeasonRefId };
    case 'archive':
      return { kind: 'archive' };
    case 'day':
      return { kind: 'day', day: DayKey.of(scope.day) };
  }
}

function rewardRef(
  reward: RewardCatalogItem,
): Ref<RedeemableRewardRef, RewardCatalogItem> {
  return {
    id: reward.id as RewardId,
    cost: reward.cost as Points,
    enabled: reward.enabled,
    order: reward.order,
    available: {
      from:
        reward.available.from === null
          ? null
          : DayKey.of(reward.available.from),
      until:
        reward.available.until === null
          ? null
          : DayKey.of(reward.available.until),
    },
    limits: reward.limits,
    redeemedCount: reward.redeemedCount,
    source: reward,
  };
}

function tierRef(tier: TierDefinition): TierStepRef {
  return {
    id: tier.id as TierId,
    rank: tier.rank,
    // The catalogue's class, by reference: it reads as `{ bg, en }`.
    name: tier.name,
    qualify: {
      metric: tier.qualify.metric as SystemMetric,
      atLeast: tier.qualify.atLeast,
      window: tier.qualify.window,
    },
  };
}
