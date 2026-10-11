import type { LocalizedText } from '@creativo/domain/catalog';
import {
  AchievementRuleId,
  AdjustmentId,
  BadgeCategoryId as CategoryRefId,
  BadgeSeriesId as SeriesRefId,
  LocalDate,
  RewardId,
  SeasonId as SeasonRefId,
  TierId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  AwardSummary as SystemAward,
  BadgeSubject as SystemSubject,
  type BadgeLevel as SystemLevel,
  EarnedVia,
  type EarnedLevel,
  FamilyScopeFilter,
  type Metric as SystemMetric,
  Points,
  RedeemProblem as SystemRedeemProblem,
  TierOverride,
  type TierState as SystemTierState,
} from '@core/components';
import {
  type CatalogCategoryRef,
  type CatalogSeasonRef,
  type RedeemableRewardRef,
  RewardSystem,
  type StandingCatalog,
  type StandingProgress,
  type StandingSeriesRef,
  StandingSystem,
  type TierStepRef,
  TierSystem,
} from '@core/systems';
import type { BadgeLevel, BadgeSeries } from './badge-series';
import type { AwardSummary } from './badge-vocabulary';
import type {
  RedeemProblem,
  RedemptionRecord,
  RewardCatalogItem,
  TierDefinition,
} from './catalog-entries';
import { type IsoDate, sofiaDayOf } from './loyalty-calendar';
import type { LoyaltyCatalog } from './loyalty-catalog';
import type { BadgeProgress, TierState } from './projections';

/**
 * STANDING — what the card derives from one client's progress against the
 * catalogue (client-card-redesign §4.2). A thin shim since the ECS
 * migration's Phase 2: the math is `StandingSystem`, `RewardSystem` and
 * `TierSystem` (`@core/systems`); this file carries the legacy API —
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
    dayOf(today),
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
    dayOf(today),
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
    dayOf(today),
    limit,
  ).map((closest) => ({
    seriesId: closest.badgeSeriesId,
    level: closest.level,
    value: closest.value,
    target: closest.target,
  }));
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
  return StandingSystem.recentLevelsByDay(progressOf(progress), limit).map(
    (day) => ({
      day: day.localDate,
      levels: day.levels.map((level) => ({
        seriesId: level.badgeSeriesId,
        level: level.level,
        earnedAt: new Date(level.earnedAtUtcMs),
      })),
    }),
  );
}

/** «Ново»: earned after the previous visit began; before a first visit, everything is new. */
export function isNewSince(
  earnedAt: Date,
  previousVisitAtMs: number | null,
): boolean {
  return StandingSystem.isNewSince(
    utcOf(earnedAt),
    previousVisitAtMs === null ? null : utcOfMs(previousVisitAtMs),
  );
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
  const problem = RewardSystem.problem(rewardRef(item), {
    balance: ctx.balance,
    today: dayOf(ctx.today),
    paused: ctx.paused,
    recent: ctx.recent.map((record) => ({
      rewardId: RewardId.of(record.rewardId),
      on: dayOf(record.on),
    })),
  });
  return problem === null ? null : LEGACY_REDEEM_PROBLEM[problem];
}

/** The costliest reward the balance buys today (enabled, in its window, in stock); ties by catalogue order. */
export function bestAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    RewardSystem.bestAffordable(rewards.map(rewardRef), balance, dayOf(today))
      ?.source ?? null
  );
}

/** The cheapest reward the balance does not reach yet — one that points alone keep from the client. */
export function nextAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    RewardSystem.nextAffordable(rewards.map(rewardRef), balance, dayOf(today))
      ?.source ?? null
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
  const track = TierSystem.steps(tierStateOf(state), tiers.map(tierRef));
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

/** A class instant's epoch ms as the brand — every `Date` the documents hold is inside its window. */
function utcOf(at: Date): UtcEpochMs {
  return utcOfMs(at.getTime());
}

function utcOfMs(epochMs: number): UtcEpochMs {
  const utc = UtcEpochMs.of(epochMs);
  return utc.ok ? utc.value : defect(`${epochMs} is not an instant`);
}

/** A Sofia day the card holds: a guarded document day, a clock's «today». */
function dayOf(raw: IsoDate): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/** How a level was earned, in the system's words. */
const EARNED_VIA = {
  rule: EarnedVia.Rule,
  manual: EarnedVia.Manual,
} as const satisfies Record<BadgeProgress['earned'][number]['via'], EarnedVia>;

/** Why a reward cannot be redeemed, in the legacy words. */
const LEGACY_REDEEM_PROBLEM: Readonly<
  Record<SystemRedeemProblem, RedeemProblem>
> = {
  [SystemRedeemProblem.Disabled]: 'disabled',
  [SystemRedeemProblem.NotYetAvailable]: 'notYetAvailable',
  [SystemRedeemProblem.Ended]: 'ended',
  [SystemRedeemProblem.SoldOut]: 'soldOut',
  [SystemRedeemProblem.Paused]: 'paused',
  [SystemRedeemProblem.InsufficientPoints]: 'insufficientPoints',
  [SystemRedeemProblem.PerClientLimit]: 'perClientLimit',
};

/** A family's subject, in the system's words: the kind alone is read. */
const BADGE_SUBJECT = {
  service: SystemSubject.Service,
  barber: SystemSubject.Barber,
  location: SystemSubject.Location,
} as const satisfies Record<
  NonNullable<BadgeSeries['subject']>['kind'],
  SystemSubject
>;

/** One earned level as the system reads it: the instant, and its Sofia day beside it (T5). */
function earnedOf(earned: BadgeProgress['earned'][number]): EarnedLevel {
  return {
    level: earned.level,
    earnedAtUtcMs: utcOf(earned.earnedAt),
    earnedLocalDate: dayOf(sofiaDayOf(earned.earnedAt)),
    earnedVia: EARNED_VIA[earned.via],
    count: earned.count,
  };
}

/** A legacy award as the system reads it: flat, by `awardKind`. */
function systemAwardOf(award: AwardSummary): SystemAward {
  switch (award.kind) {
    case 'points':
      return SystemAward.points(award.points);
    case 'freeze':
      return SystemAward.freeze(award.count);
    case 'perk':
      return SystemAward.perk(award.perkId, award.forDays);
    case 'coupon':
      return SystemAward.coupon({ bg: award.title.bg, en: award.title.en });
  }
}

/** A family's level as the system reads it: the same figures, the awards flat. */
function levelOf(level: BadgeLevel): SystemLevel {
  return {
    level: level.level,
    ruleId: AchievementRuleId.of(level.ruleId),
    target: level.target,
    requirement: { bg: level.requirement.bg, en: level.requirement.en },
    awards: level.awards.map(systemAwardOf),
  };
}

/** The account's tier as the system reads it: the standing and the override, flat. */
function tierStateOf(state: TierState): SystemTierState {
  const until =
    state.override === null || state.override.until === null
      ? null
      : dayOf(state.override.until);
  const override =
    state.override === null
      ? TierOverride.none()
      : state.override.source.kind === 'award'
        ? TierOverride.award(
            TierId.of(state.override.tierId),
            until,
            state.override.source.awardKey,
          )
        : TierOverride.adjustment(
            TierId.of(state.override.tierId),
            until,
            AdjustmentId.of(state.override.source.adjustmentId),
          );
  return {
    tierId: TierId.of(state.current),
    tierDefinitionVersion: state.definitionVersion,
    tierSinceUtcMs: utcOf(state.since),
    tierQualifying: state.qualifying,
    nextTierId: state.next === null ? null : TierId.of(state.next),
    tierRemaining: state.remaining,
    ...override,
  };
}

function progressOf(
  progress: ReadonlyMap<string, BadgeProgress>,
): readonly StandingProgress[] {
  const out: StandingProgress[] = [];
  for (const [seriesId, p] of progress) {
    out.push({
      id: SeriesRefId.of(seriesId),
      value: p.value,
      earned: p.earned.map(earnedOf),
    });
  }
  return out;
}

function seriesRef(series: BadgeSeries): Ref<StandingSeriesRef, BadgeSeries> {
  return {
    id: SeriesRefId.of(series.id.value),
    categoryId:
      series.categoryId === null
        ? null
        : CategoryRefId.of(series.categoryId.value),
    seasonId:
      series.seasonId === null ? null : SeasonRefId.of(series.seasonId.value),
    order: series.order,
    levels: series.levels.map(levelOf),
    metric:
      series.metric === null ? null : (series.metric.metric as SystemMetric),
    // The system reads the subject's kind alone.
    badgeSubject:
      series.subject === null ? null : BADGE_SUBJECT[series.subject.kind],
    retiredAtUtcMs: series.retiredAt === null ? null : utcOf(series.retiredAt),
    source: series,
  };
}

function catalogOf(
  catalog: LoyaltyCatalog,
): StandingCatalog<Ref<StandingSeriesRef, BadgeSeries>> {
  return {
    categories: catalog.categories.map((category): CatalogCategoryRef => ({
      id: CategoryRefId.of(category.id.value),
      order: category.order,
    })),
    families: catalog.families.map(seriesRef),
    seasons: catalog.seasons.map((season): CatalogSeasonRef => ({
      id: SeasonRefId.of(season.id.value),
      windowFrom: dayOf(season.window.from),
      windowUntil: dayOf(season.window.until),
      trackSeriesId:
        season.trackSeriesId === null
          ? null
          : SeriesRefId.of(season.trackSeriesId.value),
      seriesIds: season.seriesIds.map((id) => SeriesRefId.of(id.value)),
    })),
  };
}

function scopeOf(scope: FamilyScope): FamilyScopeFilter {
  switch (scope.kind) {
    case 'category':
      return FamilyScopeFilter.category(CategoryRefId.of(scope.categoryId));
    case 'season':
      return FamilyScopeFilter.season(SeasonRefId.of(scope.seasonId));
    case 'archive':
      return FamilyScopeFilter.archive();
    case 'day':
      return FamilyScopeFilter.day(dayOf(scope.day));
  }
}

function rewardRef(
  reward: RewardCatalogItem,
): Ref<RedeemableRewardRef, RewardCatalogItem> {
  return {
    id: RewardId.of(reward.id),
    cost: Points.of(reward.cost),
    enabled: reward.enabled,
    order: reward.order,
    availableFrom:
      reward.available.from === null ? null : dayOf(reward.available.from),
    availableUntil:
      reward.available.until === null ? null : dayOf(reward.available.until),
    perClientLimitCount: reward.limits.perClient?.count ?? null,
    perClientLimitWindowDays: reward.limits.perClient?.windowDays ?? null,
    totalLimit: reward.limits.total,
    redeemedCount: reward.redeemedCount,
    source: reward,
  };
}

function tierRef(tier: TierDefinition): TierStepRef {
  return {
    id: TierId.of(tier.id),
    rank: tier.rank,
    // The catalogue's class, by reference: it reads as `{ bg, en }`.
    name: tier.name,
    qualifyAtLeast: tier.qualify.atLeast,
  };
}
