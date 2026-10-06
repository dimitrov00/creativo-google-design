import { Result, fail, ok } from '@creativo/domain/kernel';
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

const byOrderThenId = (
  a: { readonly order: number; readonly id: { toString(): string } },
  b: { readonly order: number; readonly id: { toString(): string } },
): number => a.order - b.order || compareText(String(a.id), String(b.id));

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
  private constructor(
    /** The shelves, by `order`. */
    readonly categories: readonly BadgeCategory[],
    /** Every family, retired ones included, by `order`. */
    readonly families: readonly BadgeSeries[],
    /** Seasons and events, by the day they open. */
    readonly seasons: readonly Season[],
    /** By rank, lowest first. */
    readonly tiers: readonly TierDefinition[],
    /** By `order`. */
    readonly rewards: readonly RewardCatalogItem[],
    /** The rhythm's rules, by id. */
    readonly streakSchedules: readonly StreakDefinitionSchedule[],
    private readonly categoryById: ReadonlyMap<string, BadgeCategory>,
    private readonly seriesById: ReadonlyMap<string, BadgeSeries>,
    private readonly seasonById: ReadonlyMap<string, Season>,
  ) {}

  static create(
    parts: LoyaltyCatalogParts,
  ): Result<LoyaltyCatalog, LoyaltyCatalogError[]> {
    const streakSchedules = parts.streakSchedules ?? [];
    const errors: LoyaltyCatalogError[] = [
      ...duplicates(
        'badgeCategories',
        parts.categories.map((c) => c.id.value),
      ),
      ...duplicates(
        'badgeSeries',
        parts.series.map((s) => s.id.value),
      ),
      ...duplicates(
        'seasons',
        parts.seasons.map((s) => s.id.value),
      ),
      ...duplicates(
        'tierDefinitions',
        parts.tiers.map((t) => t.id),
      ),
      ...duplicates(
        'rewardsCatalog',
        parts.rewards.map((r) => r.id),
      ),
      ...duplicates(
        'streakDefinitions',
        streakSchedules.map((s) => s.id),
      ),
    ];

    const categoryById = new Map(parts.categories.map((c) => [c.id.value, c]));
    const seriesById = new Map(parts.series.map((s) => [s.id.value, s]));
    const seasonById = new Map(parts.seasons.map((s) => [s.id.value, s]));

    for (const family of parts.series) {
      const categoryId = family.categoryId?.value;
      if (categoryId !== undefined && !categoryById.has(categoryId)) {
        errors.push(
          new LoyaltyCatalogDanglingCategoryError(family.id.value, categoryId),
        );
      }
      const seasonId = family.seasonId?.value;
      if (seasonId !== undefined && !seasonById.has(seasonId)) {
        errors.push(
          new LoyaltyCatalogDanglingSeasonError(seasonId, family.id.value),
        );
      }
    }
    for (const season of parts.seasons) {
      for (const seriesId of season.familyIds()) {
        const family = seriesById.get(seriesId.value);
        if (family?.seasonId?.value !== season.id.value) {
          errors.push(
            new LoyaltyCatalogDanglingSeasonError(
              season.id.value,
              seriesId.value,
            ),
          );
        }
      }
    }

    const tiers = [...parts.tiers].sort((a, b) => a.rank - b.rank);
    if (
      tiers.some(
        (t, i) =>
          i > 0 && t.qualify.atLeast <= (tiers[i - 1]?.qualify.atLeast ?? 0),
      )
    ) {
      errors.push(
        new LoyaltyCatalogTiersNotRisingError(tiers.map((t) => t.id)),
      );
    }
    for (const reward of parts.rewards) {
      if (!Number.isInteger(reward.cost) || reward.cost <= 0) {
        errors.push(
          new LoyaltyCatalogCostNotPositiveError(reward.id, reward.cost),
        );
      }
    }

    if (errors.length > 0) return fail(errors);
    return ok(
      new LoyaltyCatalog(
        [...parts.categories].sort(byOrderThenId),
        [...parts.series].sort(byOrderThenId),
        [...parts.seasons].sort(
          (a, b) =>
            compareText(a.window.from, b.window.from) ||
            compareText(a.id.value, b.id.value),
        ),
        tiers,
        [...parts.rewards].sort(byOrderThenId),
        [...streakSchedules].sort((a, b) => compareText(a.id, b.id)),
        categoryById,
        seriesById,
        seasonById,
      ),
    );
  }

  category(id: string): BadgeCategory | null {
    return this.categoryById.get(id) ?? null;
  }

  series(id: string): BadgeSeries | null {
    return this.seriesById.get(id) ?? null;
  }

  /** A shelf's families, by `order`, retired ones included (the caller knows who started them). */
  seriesIn(categoryId: string): readonly BadgeSeries[] {
    return this.families.filter((s) => s.categoryId?.value === categoryId);
  }

  season(id: string): Season | null {
    return this.seasonById.get(id) ?? null;
  }

  /**
   * The seasons and events in one phase on a Sofia day: the running and the
   * announced in the order they open, the ended newest first — the archive
   * reads back from the latest.
   */
  seasonsIn(phase: SeasonPhase, today: IsoDate): readonly Season[] {
    const inPhase = this.seasons.filter((s) => s.phaseOn(today) === phase);
    return phase === 'ended'
      ? [...inPhase].sort(
          (a, b) =>
            compareText(b.window.until, a.window.until) ||
            compareText(a.id.value, b.id.value),
        )
      : inPhase;
  }

  tier(id: string): TierDefinition | null {
    return this.tiers.find((t) => t.id === id) ?? null;
  }

  /** A rhythm's head: the rule in force and the one that waits. */
  streakSchedule(id: string): StreakDefinitionSchedule | null {
    return this.streakSchedules.find((s) => s.id === id) ?? null;
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

function duplicates(
  collection: string,
  ids: readonly string[],
): LoyaltyCatalogDuplicateIdError[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated].map(
    (id) => new LoyaltyCatalogDuplicateIdError(collection, id),
  );
}
