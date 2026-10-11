import {
  type EarnedLevel,
  BadgeSubject,
  Gamification,
  SeasonPhase,
  FamilyScope,
  type ClosestLevel,
  type EarnedDay,
  type FamilyScopeFilter,
} from '@core/components';
import type { BadgeProgress, BadgeSeries } from '@core/entities';
import {
  type BadgeSeriesId,
  type LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import { BadgeSystem } from './badge.system';
import {
  LoyaltyCatalogSystem,
  type CatalogCategoryRef,
  type CatalogSeasonRef,
} from './loyalty-catalog.system';
import { SeasonSystem } from './season.system';

/*
 * STANDING (client-card-redesign §4.2, `standing.ts:69-426`) — what the card
 * derives from one client's progress against the catalogue: the summary's
 * count, the families a scope page draws, «Скоро» (the diversity rule),
 * «Последни» and «Ново». Numbers, ids and shop days only: the Roman numeral
 * a level is drawn with is a template pipe. Zone-blind: an earned level is
 * filed under its own stored shop day (`earnedLocalDate`, T5).
 *
 * `progress` is the client's progress documents, one per started family
 * (`BadgeProgress`, id = the family's `BadgeSeriesId`); a family missing
 * from it is not started. Generic over the catalogue's family rows, which
 * come back as the very rows they were.
 */

/** What a standing reads of a family. */
export type StandingSeriesRef = Pick<
  BadgeSeries,
  | 'id'
  | 'categoryId'
  | 'seasonId'
  | 'order'
  | 'levels'
  | 'metric'
  | 'badgeSubject'
  | 'retiredAtUtcMs'
>;

/** What a standing reads of a client's progress on one family. */
export type StandingProgress = Pick<BadgeProgress, 'id' | 'value' | 'earned'>;

/** The catalogue as a standing reads it: shelves, families, seasons, in display order. */
export type StandingCatalog<S extends StandingSeriesRef = BadgeSeries> = {
  readonly categories: readonly CatalogCategoryRef[];
  readonly families: readonly S[];
  readonly seasons: readonly CatalogSeasonRef[];
};

/** Shelves and scope pages count FAMILIES: with a level, started at all, and drawn. */
export type FamilyCounts = {
  readonly started: number;
  readonly earned: number;
  readonly total: number;
};

/** How specific a family's subject is, for the diversity rule's step 3: service › barber › location › none. */
const SPECIFICITY = {
  [BadgeSubject.Service]: 3,
  [BadgeSubject.Barber]: 2,
  [BadgeSubject.Location]: 1,
} as const;

type Candidate<S> = {
  readonly series: S;
  readonly level: number;
  readonly value: number;
  readonly target: number;
};

function progressById(
  progress: readonly StandingProgress[],
): Map<string, StandingProgress> {
  const byId = new Map<string, StandingProgress>();
  for (let i = 0; i < progress.length; i++) {
    const p = progress[i] as StandingProgress;
    byId.set(p.id, p);
  }
  return byId;
}

function specificityOf(series: StandingSeriesRef): number {
  return series.badgeSubject === null ? 0 : SPECIFICITY[series.badgeSubject];
}

export const StandingSystem = {
  /** The summary's unit: each earned level once — a yearly level counts once however often it was earned. */
  earnedLevelCount(progress: readonly StandingProgress[]): number {
    let count = 0;
    for (let i = 0; i < progress.length; i++) {
      count += (progress[i] as StandingProgress).earned.length;
    }
    return count;
  },

  /**
   * The families a scope page draws, in catalogue order. A retired family
   * stays only where the client started it. A season's grid is its own
   * families (its track is the gauge above the grid); the archive is every
   * family of the windows that have ended; a day, the families with a
   * level earned on it (its stored shop day).
   */
  familiesIn<S extends StandingSeriesRef>(
    catalog: StandingCatalog<S>,
    progress: readonly StandingProgress[],
    scope: FamilyScopeFilter,
    today: LocalDate,
  ): readonly S[] {
    const byId = progressById(progress);
    const shown = (s: S): boolean =>
      !BadgeSystem.isRetired(s) || byId.has(s.id);
    const out: S[] = [];
    switch (scope.familyScope) {
      case FamilyScope.Category: {
        const shelf = LoyaltyCatalogSystem.seriesIn(catalog, scope.categoryId);
        for (let i = 0; i < shelf.length; i++) {
          const s = shelf[i] as S;
          if (shown(s)) out.push(s);
        }
        return out;
      }
      case FamilyScope.Season: {
        const season = LoyaltyCatalogSystem.season(catalog, scope.seasonId);
        if (season === null) return out;
        for (let i = 0; i < season.seriesIds.length; i++) {
          const s = LoyaltyCatalogSystem.series(
            catalog,
            season.seriesIds[i] as BadgeSeriesId,
          );
          if (s !== null && shown(s)) out.push(s);
        }
        return out;
      }
      case FamilyScope.Archive: {
        const ended = new Set<string>();
        const seasons = LoyaltyCatalogSystem.seasonsIn(
          catalog,
          SeasonPhase.Ended,
          today,
        );
        for (let i = 0; i < seasons.length; i++) {
          ended.add((seasons[i] as CatalogSeasonRef).id);
        }
        for (let i = 0; i < catalog.families.length; i++) {
          const s = catalog.families[i] as S;
          if (s.seasonId !== null && ended.has(s.seasonId) && shown(s)) {
            out.push(s);
          }
        }
        return out;
      }
      default: {
        for (let i = 0; i < catalog.families.length; i++) {
          const s = catalog.families[i] as S;
          const p = byId.get(s.id);
          if (p === undefined) continue;
          for (let k = 0; k < p.earned.length; k++) {
            const earned = p.earned[k] as EarnedLevel;
            if (earned.earnedLocalDate === scope.localDate) {
              out.push(s);
              break;
            }
          }
        }
        return out;
      }
    }
  },

  /**
   * Shelves and scope pages count FAMILIES, the unit they draw: `earned`
   * (with a level, the filled discs) is the «N от M» figure; `started` (any
   * progress) is worded where it is used.
   */
  familyCounts<S extends StandingSeriesRef>(
    catalog: StandingCatalog<S>,
    progress: readonly StandingProgress[],
    scope: FamilyScopeFilter,
    today: LocalDate,
  ): FamilyCounts {
    const families = StandingSystem.familiesIn(catalog, progress, scope, today);
    const byId = progressById(progress);
    let started = 0;
    let earned = 0;
    for (let i = 0; i < families.length; i++) {
      const p = byId.get((families[i] as S).id);
      if (p === undefined) continue;
      started += 1;
      if (p.earned.length > 0) earned += 1;
    }
    return { started, earned, total: families.length };
  },

  /**
   * «Скоро» — the diversity rule. One visit moves four to six families at
   * once; without the rule the rail is four clones of «24/25».
   *
   * 1. Candidates: not complete, not retired, not in a season that is not
   *    open, not calendar-driven, with a known next target; ranked by
   *    value / target, descending.
   * 2. At most one family per category (a season's families count as that
   *    season).
   * 3. Among CATEGORY families whose next level completes on the same next
   *    worked visit — equal target − value on a per-visit count the
   *    client's visits already move (a family not started yet is moved by
   *    none of them) — only the most specific subject stays: service ›
   *    barber › location › none; ties by category order, then series
   *    order. A season's families stay outside step 3.
   * 4. Fill to `limit` in rank order; rank ties by the nearer finish, the
   *    shelf order (seasons after categories), the series order, the id.
   */
  closestLevels<S extends StandingSeriesRef>(
    catalog: StandingCatalog<S>,
    progress: readonly StandingProgress[],
    today: LocalDate,
    limit: number,
  ): readonly ClosestLevel[] {
    const byId = progressById(progress);
    const shelfOrder = (s: S): number => {
      if (s.categoryId === null) return Number.POSITIVE_INFINITY;
      return (
        LoyaltyCatalogSystem.category(catalog, s.categoryId)?.order ??
        Number.POSITIVE_INFINITY
      );
    };

    const candidates: Candidate<S>[] = [];
    for (let i = 0; i < catalog.families.length; i++) {
      const series = catalog.families[i] as S;
      const season =
        series.seasonId === null
          ? null
          : LoyaltyCatalogSystem.season(catalog, series.seasonId);
      if (
        BadgeSystem.isRetired(series) ||
        BadgeSystem.isCalendarDriven(series) ||
        (series.seasonId !== null &&
          (season === null ||
            SeasonSystem.phaseOn(season, today) !== SeasonPhase.Open))
      ) {
        continue;
      }
      const standing = BadgeSystem.standing(
        series,
        byId.get(series.id) ?? null,
      );
      if (standing.next === null || standing.target === null) continue;
      candidates.push({
        series,
        level: standing.next.level,
        value: standing.value,
        target: standing.target,
      });
    }

    const bySubject = (a: Candidate<S>, b: Candidate<S>): number =>
      specificityOf(b.series) - specificityOf(a.series) ||
      shelfOrder(a.series) - shelfOrder(b.series) ||
      a.series.order - b.series.order;
    const sameVisit = new Map<number, Candidate<S>[]>();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] as Candidate<S>;
      const metric = c.series.metric;
      if (
        c.value === 0 ||
        c.series.categoryId === null ||
        metric === null ||
        !Gamification.isPerVisitMetric(metric)
      ) {
        continue;
      }
      const remaining = c.target - c.value;
      const group = sameVisit.get(remaining);
      if (group === undefined) sameVisit.set(remaining, [c]);
      else group.push(c);
    }
    const yielded = new Set<Candidate<S>>();
    for (const group of sameVisit.values()) {
      const keep = [...group].sort(bySubject)[0];
      for (let i = 0; i < group.length; i++) {
        const c = group[i] as Candidate<S>;
        if (c !== keep) yielded.add(c);
      }
    }

    const ranked: Candidate<S>[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] as Candidate<S>;
      if (!yielded.has(c)) ranked.push(c);
    }
    ranked.sort(
      (a, b) =>
        b.value / b.target - a.value / a.target ||
        a.target - a.value - (b.target - b.value) ||
        shelfOrder(a.series) - shelfOrder(b.series) ||
        a.series.order - b.series.order ||
        (a.series.id < b.series.id ? -1 : 1),
    );
    const shelves = new Set<string>();
    const out: ClosestLevel[] = [];
    for (let i = 0; i < ranked.length; i++) {
      if (out.length >= limit) break;
      const c = ranked[i] as Candidate<S>;
      const shelf = c.series.categoryId ?? `season:${c.series.seasonId ?? ''}`;
      if (shelves.has(shelf)) continue;
      shelves.add(shelf);
      out.push({
        badgeSeriesId: c.series.id,
        level: c.level,
        value: c.value,
        target: c.target,
      });
    }
    return out;
  },

  /**
   * «Последни»: earned levels grouped by their stored shop day, newest day
   * first, the newest level first within a day. A day with several levels
   * is ONE rail item; `limit` counts days.
   */
  recentLevelsByDay(
    progress: readonly StandingProgress[],
    limit: number,
  ): readonly EarnedDay[] {
    const days = new Map<LocalDate, EarnedDay.Level[]>();
    for (let i = 0; i < progress.length; i++) {
      const p = progress[i] as StandingProgress;
      for (let k = 0; k < p.earned.length; k++) {
        const earned = p.earned[k] as EarnedLevel;
        const day = earned.earnedLocalDate;
        const level = {
          badgeSeriesId: p.id,
          level: earned.level,
          earnedAtUtcMs: earned.earnedAtUtcMs,
        };
        const held = days.get(day);
        if (held === undefined) days.set(day, [level]);
        else held.push(level);
      }
    }
    const ordered = [...days.entries()].sort(([a], [b]) =>
      a < b ? 1 : a > b ? -1 : 0,
    );
    const out: EarnedDay[] = [];
    const count = Math.min(ordered.length, Math.max(0, limit));
    for (let i = 0; i < count; i++) {
      const [localDate, levels] = ordered[i] as [LocalDate, EarnedDay.Level[]];
      out.push({
        localDate,
        levels: levels.sort(
          (a, b) =>
            UtcEpochMs.compare(b.earnedAtUtcMs, a.earnedAtUtcMs) ||
            b.level - a.level,
        ),
      });
    }
    return out;
  },

  /** «Ново»: earned after the previous visit began (two stamps ordered, T2); before a first visit, everything is new. */
  isNewSince(
    earnedAtUtcMs: UtcEpochMs,
    previousVisitAtUtcMs: UtcEpochMs | null,
  ): boolean {
    return (
      previousVisitAtUtcMs === null ||
      UtcEpochMs.compare(earnedAtUtcMs, previousVisitAtUtcMs) > 0
    );
  },
} as const;
