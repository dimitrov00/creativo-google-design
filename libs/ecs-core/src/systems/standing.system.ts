import {
  type BadgeLevel,
  type EarnedLevel,
  BadgeCategoryKind,
  BadgeSubject,
  type BadgeSubjectSlot,
  Gamification,
  MedalCue,
  MedalState,
  ScopeSection,
  SeasonPhase,
  type SeasonWindow,
  FamilyScope,
  FamilyScopeFilter,
  type ClosestLevel,
  type EarnedDay,
  type SeriesStanding,
} from '@core/components';
import type { BadgeCategory, BadgeProgress, BadgeSeries } from '@core/entities';
import {
  type BadgeSeriesId,
  type LocalDate,
  type SeasonId,
  type ServiceCategoryId,
  type ServiceId,
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

/** What the medals page reads of a shelf: its catalogue ref, and its kind (the rhythm's shelf, the records'). */
export type ShelfCategoryRef = Pick<
  BadgeCategory,
  'id' | 'order' | 'badgeCategoryKind'
>;

/** The catalogue as the medals page reads it: a standing's catalogue whose shelves carry their kind. */
export type ShelfCatalog<
  S extends StandingSeriesRef = BadgeSeries,
  C extends ShelfCategoryRef = BadgeCategory,
> = {
  readonly categories: readonly C[];
  readonly families: readonly S[];
  readonly seasons: readonly CatalogSeasonRef[];
};

/** One shelf the medals page draws: the category and the families it shows. */
export type StandingShelf<S, C> = {
  readonly category: C;
  readonly families: readonly S[];
};

/**
 * One day of «Последни» as the rail reads it: every level earned on the
 * day (newest first — the stack's count), and the FRESH ones among them —
 * of a family that no newer day already shows (the face candidates).
 */
export type FreshEarnedDay = {
  readonly localDate: LocalDate;
  /** All of the day's levels, in {@link StandingSystem.recentLevelsByDay}'s order. */
  readonly levels: readonly EarnedDay.Level[];
  /** The levels of a family not on a newer day, in the same order; never empty. */
  readonly fresh: readonly EarnedDay.Level[];
};

/** What «Почти спечелени» is asked to leave out and how many it holds. */
export type AlmostEarnedOptions = {
  /** The families the visit on screen completes (the caller's «с това посещение» answer). */
  readonly completing: ReadonlySet<BadgeSeriesId>;
  /** A family drawn elsewhere on the page — the running season's track — or `null`. */
  readonly excludeSeriesId: BadgeSeriesId | null;
  /** Whether the shop runs a rhythm ({@link LoyaltyCatalogSystem.rhythmLive}): off, no family of the rhythm's shelf is offered. */
  readonly rhythmLive: boolean;
  readonly limit: number;
};

/** What the glance's strip of medals is built from: ids only, every one already decided. */
export type StripInput = {
  /** The FIRST family (cue-ordered) the visit on screen completes, or `null`. */
  readonly completingFirst: BadgeSeriesId | null;
  /** The family of the newest earned level as «Последни» draws it, when it resolves; `null` otherwise. */
  readonly newestSeriesId: BadgeSeriesId | null;
  /** «Скоро»'s families, in its order. */
  readonly soonIds: readonly BadgeSeriesId[];
  readonly limit: number;
};

/**
 * The strip's slots, which one says «ново» (`null`: none), and «Скоро»'s
 * first family beside the newest one's — the family a `CLOSE` cue measures
 * ({@link StripCueInput} `closest`; `null`: none).
 */
export type MedalStrip = {
  readonly slots: readonly BadgeSeriesId[];
  readonly markNewIndex: number | null;
  readonly closestId: BadgeSeriesId | null;
};

/** What the strip's one cue is chosen from — every input already decided by its own system. */
export type StripCueInput = {
  /** The first family (cue-ordered) the visit on screen completes, and where it stands; `null` = none. */
  readonly completing: {
    readonly series: Pick<BadgeSeries, 'levels'>;
    readonly standing: Pick<SeriesStanding, 'next' | 'highestLevel'>;
  } | null;
  /** The newest earned level as «Последни» draws it (its face family's level on the newest day), when its family resolves. */
  readonly newest: {
    readonly level: number;
    readonly earnedAtUtcMs: UtcEpochMs;
  } | null;
  /** The start of the previous visit — what «Ново» is measured from; `null` before a first one. */
  readonly previousVisitAtUtcMs: UtcEpochMs | null;
  /** Where «Скоро»'s first family stands, or `null`. */
  readonly closest: Pick<SeriesStanding, 'next' | 'target'> | null;
};

/** The strip's cue (`null`: none) and the level it names (`null`: none — a single act names no level). */
export type StripCue = {
  readonly medalCue: MedalCue | null;
  readonly level: number | null;
};

/**
 * One section of a scope page: what it is about (`scopeSection`), its key —
 * the service category's id for a `SERVICE_CATEGORY` section, `null` for
 * every other (the tag is the section) — and its families, in the order
 * they came in.
 */
export type StandingSection<S> = {
  readonly scopeSection: ScopeSection;
  readonly key: ServiceCategoryId | null;
  readonly families: readonly S[];
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

/** Where a family stands, its progress looked up by id (absent = not started). */
function standingIn(
  series: Pick<BadgeSeries, 'id' | 'levels'>,
  byId: ReadonlyMap<string, StandingProgress>,
): SeriesStanding {
  return BadgeSystem.standing(series, byId.get(series.id) ?? null);
}

/**
 * THE ACTS-FIRST MERGE that «Скоро» and «Почти спечелени» share: the single
 * acts the visit on screen completes — families whose every level has no
 * target, in the catalogue's order (`closestLevels` ranks counted levels
 * only) — then `ranked`, each family once. Each caller limits on its own
 * (§7 R-10): «Скоро» before the merge and again after it, «Почти» last.
 */
function actsFirst(
  families: readonly StandingSeriesRef[],
  completing: ReadonlySet<BadgeSeriesId>,
  ranked: readonly ClosestLevel[],
): BadgeSeriesId[] {
  const seen = new Set<BadgeSeriesId>();
  const out: BadgeSeriesId[] = [];
  for (let i = 0; i < families.length; i++) {
    const series = families[i] as StandingSeriesRef;
    if (!completing.has(series.id) || seen.has(series.id)) continue;
    let act = true;
    for (let k = 0; k < series.levels.length; k++) {
      if ((series.levels[k] as BadgeLevel).target !== null) {
        act = false;
        break;
      }
    }
    if (!act) continue;
    seen.add(series.id);
    out.push(series.id);
  }
  for (let i = 0; i < ranked.length; i++) {
    const id = (ranked[i] as ClosestLevel).badgeSeriesId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
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
      LoyaltyCatalogSystem.shelfRank(catalog, a.series) -
        LoyaltyCatalogSystem.shelfRank(catalog, b.series) ||
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
        LoyaltyCatalogSystem.shelfRank(catalog, a.series) -
          LoyaltyCatalogSystem.shelfRank(catalog, b.series) ||
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

  /**
   * «Ново» on a family: it is earned, and its latest level
   * (`BadgeSystem.latestEarned`) was earned since the previous visit began
   * ({@link isNewSince}). WHERE a page marks it — once per page — is the
   * page's placement, not this rule.
   */
  isFamilyNew(
    standing: Pick<SeriesStanding, 'medalState'>,
    latest: Pick<EarnedLevel, 'earnedAtUtcMs'> | null,
    previousVisitAtUtcMs: UtcEpochMs | null,
  ): boolean {
    return (
      standing.medalState === MedalState.Earned &&
      latest !== null &&
      StandingSystem.isNewSince(latest.earnedAtUtcMs, previousVisitAtUtcMs)
    );
  },

  /**
   * A shelf's order: earned (highest level first) → in progress (closest
   * first, value ÷ target; a family with no target left ranks with the
   * nearest-nought) → not started. The order the families came in breaks
   * every tie, so they keep their places as they progress.
   */
  shelfOrdered<S extends StandingSeriesRef>(
    families: readonly S[],
    progress: readonly StandingProgress[],
  ): readonly S[] {
    const byId = progressById(progress);
    const ranked: {
      readonly series: S;
      readonly index: number;
      readonly band: number;
      readonly within: number;
    }[] = [];
    for (let i = 0; i < families.length; i++) {
      const series = families[i] as S;
      const standing = standingIn(series, byId);
      const band =
        standing.medalState === MedalState.Earned
          ? 0
          : standing.medalState === MedalState.InProgress
            ? 1
            : 2;
      const within =
        standing.medalState === MedalState.Earned
          ? -standing.highestLevel
          : standing.medalState === MedalState.InProgress &&
              standing.target !== null
            ? -(standing.value / standing.target)
            : 0;
      ranked.push({ series, index: i, band, within });
    }
    ranked.sort(
      (a, b) => a.band - b.band || a.within - b.within || a.index - b.index,
    );
    const out: S[] = [];
    for (let i = 0; i < ranked.length; i++) {
      out.push((ranked[i] as (typeof ranked)[number]).series);
    }
    return out;
  },

  /**
   * «Скоро»'s families, in order: the single acts the visit on screen
   * completes (`completing` — a birthday visit's yearly act), then
   * {@link closestLevels} under the diversity rule, each family once, at
   * most `limit`. The closest levels are limited BEFORE the merge and the
   * merge again after it (§7 R-10 — not {@link almostEarned}'s order).
   */
  soonIds<S extends StandingSeriesRef>(
    catalog: StandingCatalog<S>,
    progress: readonly StandingProgress[],
    today: LocalDate,
    completing: ReadonlySet<BadgeSeriesId>,
    limit: number,
  ): readonly BadgeSeriesId[] {
    const merged = actsFirst(
      catalog.families,
      completing,
      StandingSystem.closestLevels(catalog, progress, today, limit),
    );
    return merged.slice(0, Math.max(0, limit));
  },

  /**
   * «Почти спечелени»: the families nearest their next level, the visit on
   * screen's first. The acts it completes, then every {@link closestLevels}
   * family (no limit), each once; not `excludeSeriesId` (the running
   * season's track, drawn on its own card), and no family of the rhythm's
   * shelf while the shop runs no rhythm. Then what the visit completes,
   * then what is under way — `progress.value > 0`, never «started»: a
   * family nobody moved is not «almost» anything, an earned one at value 0
   * included — and at most `limit`, cut last (§7 R-10).
   */
  almostEarned<S extends StandingSeriesRef, C extends ShelfCategoryRef>(
    catalog: ShelfCatalog<S, C>,
    progress: readonly StandingProgress[],
    today: LocalDate,
    opts: AlmostEarnedOptions,
  ): readonly BadgeSeriesId[] {
    const merged = actsFirst(
      catalog.families,
      opts.completing,
      StandingSystem.closestLevels(
        catalog,
        progress,
        today,
        Number.MAX_SAFE_INTEGER,
      ),
    );
    const byId = progressById(progress);
    const pending: BadgeSeriesId[] = [];
    const underWay: BadgeSeriesId[] = [];
    for (let i = 0; i < merged.length; i++) {
      const id = merged[i] as BadgeSeriesId;
      const series = LoyaltyCatalogSystem.series(catalog, id);
      if (series === null || id === opts.excludeSeriesId) continue;
      if (!opts.rhythmLive && series.categoryId !== null) {
        const shelf = LoyaltyCatalogSystem.category(catalog, series.categoryId);
        if (shelf?.badgeCategoryKind === BadgeCategoryKind.Rhythm) continue;
      }
      if (opts.completing.has(id)) pending.push(id);
      else if ((byId.get(id)?.value ?? 0) > 0) underWay.push(id);
    }
    const out: BadgeSeriesId[] = [];
    const limit = Math.max(0, opts.limit);
    for (let i = 0; i < pending.length && out.length < limit; i++) {
      out.push(pending[i] as BadgeSeriesId);
    }
    for (let i = 0; i < underWay.length && out.length < limit; i++) {
      out.push(underWay[i] as BadgeSeriesId);
    }
    return out;
  },

  /**
   * «Последни» as the rail reads it, built on {@link recentLevelsByDay}
   * (every day, newest first): each day with ALL its levels and the fresh
   * ones — of a family no newer day shows (a family's medal already wears
   * its highest level, so an older day repeating it draws one face twice).
   * A day with nothing fresh is dropped. No day limit: the rail caps its
   * TILES after the host's lookups.
   */
  recentFreshLevelsByDay(
    progress: readonly StandingProgress[],
  ): readonly FreshEarnedDay[] {
    const days = StandingSystem.recentLevelsByDay(
      progress,
      Number.MAX_SAFE_INTEGER,
    );
    const shown = new Set<BadgeSeriesId>();
    const out: FreshEarnedDay[] = [];
    for (let i = 0; i < days.length; i++) {
      const day = days[i] as EarnedDay;
      const fresh: EarnedDay.Level[] = [];
      for (let k = 0; k < day.levels.length; k++) {
        const level = day.levels[k] as EarnedDay.Level;
        if (!shown.has(level.badgeSeriesId)) fresh.push(level);
      }
      for (let k = 0; k < day.levels.length; k++) {
        shown.add((day.levels[k] as EarnedDay.Level).badgeSeriesId);
      }
      if (fresh.length === 0) continue;
      out.push({ localDate: day.localDate, levels: day.levels, fresh });
    }
    return out;
  },

  /**
   * How many of `families` are EARNED (a level won — the filled discs a
   * section, a chip and the collection count). The families' own reading
   * (`medalState`), not {@link familyCounts}' `earned.length` (§7 R-4).
   */
  earnedAmong(
    families: readonly Pick<BadgeSeries, 'id' | 'levels'>[],
    progress: readonly StandingProgress[],
  ): number {
    const byId = progressById(progress);
    let earned = 0;
    for (let i = 0; i < families.length; i++) {
      const series = families[i] as Pick<BadgeSeries, 'id' | 'levels'>;
      if (standingIn(series, byId).medalState === MedalState.Earned) {
        earned += 1;
      }
    }
    return earned;
  },

  /**
   * The EARNED of `families`, in their order: what an ended season, its
   * neighbours and the rhythm's shelf while no rhythm runs still show — a
   * level won is never taken back. A step of its own, never inside
   * {@link familiesIn} (§7 R-5: a scope's «N от M» counts the whole).
   */
  earnedOnly<S extends Pick<BadgeSeries, 'id' | 'levels'>>(
    families: readonly S[],
    progress: readonly StandingProgress[],
  ): readonly S[] {
    const byId = progressById(progress);
    const out: S[] = [];
    for (let i = 0; i < families.length; i++) {
      const series = families[i] as S;
      if (standingIn(series, byId).medalState === MedalState.Earned) {
        out.push(series);
      }
    }
    return out;
  },

  /**
   * A season's families as its pages list them: once the window has ended
   * (`SeasonSystem.phaseOn` on `today`), only the EARNED of them
   * ({@link earnedOnly}) — a level won is never taken back; while it is
   * announced or open, all of `families`, as they are. The one home of the
   * ended-season rule: the season's scope page and {@link neighboursOf}.
   */
  seasonListed<S extends Pick<BadgeSeries, 'id' | 'levels'>>(
    season: SeasonWindow,
    families: readonly S[],
    progress: readonly StandingProgress[],
    today: LocalDate,
  ): readonly S[] {
    return SeasonSystem.phaseOn(season, today) === SeasonPhase.Ended
      ? StandingSystem.earnedOnly(families, progress)
      : families;
  },

  /** An archived window drawn as one medal: earned when a family of it is, in progress when one is started, else not started. */
  scopeMedalState(counts: FamilyCounts): MedalState {
    return counts.earned > 0
      ? MedalState.Earned
      : counts.started > 0
        ? MedalState.InProgress
        : MedalState.NotStarted;
  },

  /**
   * A family's neighbours, in shelf order ({@link shelfOrdered}), itself
   * left out, NOT limited: a shelf's family, its shelf's families
   * ({@link familiesIn}); a season's family, every family of its window
   * WITH the track (`SeasonSystem.familyIds`), a withdrawn one only where
   * the client started it, and — the window ended — only the earned. None
   * for a family whose shelf or season the catalogue lacks. Not
   * `familiesIn(SEASON)`, which leaves the track out (§7 R-3).
   */
  neighboursOf<S extends StandingSeriesRef>(
    catalog: StandingCatalog<S>,
    progress: readonly StandingProgress[],
    series: Pick<StandingSeriesRef, 'id' | 'categoryId' | 'seasonId'>,
    today: LocalDate,
  ): readonly S[] {
    const byId = progressById(progress);
    const neighbours: S[] = [];
    if (series.categoryId !== null) {
      const shelf = LoyaltyCatalogSystem.category(catalog, series.categoryId);
      if (shelf !== null) {
        const families = StandingSystem.familiesIn(
          catalog,
          progress,
          FamilyScopeFilter.category(shelf.id),
          today,
        );
        for (let i = 0; i < families.length; i++) {
          neighbours.push(families[i] as S);
        }
      }
    } else if (series.seasonId !== null) {
      const season = LoyaltyCatalogSystem.season(catalog, series.seasonId);
      if (season !== null) {
        const window: S[] = [];
        const ids = SeasonSystem.familyIds(season);
        for (let i = 0; i < ids.length; i++) {
          const family = LoyaltyCatalogSystem.series(
            catalog,
            ids[i] as BadgeSeriesId,
          );
          if (
            family !== null &&
            (!BadgeSystem.isRetired(family) || byId.has(family.id))
          ) {
            window.push(family);
          }
        }
        const listed = StandingSystem.seasonListed(
          season,
          window,
          progress,
          today,
        );
        for (let i = 0; i < listed.length; i++) {
          neighbours.push(listed[i] as S);
        }
      }
    }
    const others: S[] = [];
    for (let i = 0; i < neighbours.length; i++) {
      const family = neighbours[i] as S;
      if (family.id !== series.id) others.push(family);
    }
    return StandingSystem.shelfOrdered(others, progress);
  },

  /**
   * The shelves the medals page draws, in the catalogue's order, each with
   * its families ({@link familiesIn}): never the records' shelf (the
   * records are cards), the rhythm's shelf cut to the earned
   * ({@link earnedOnly}) while the shop runs no rhythm, and no shelf left
   * with nothing to draw.
   */
  shelves<S extends StandingSeriesRef, C extends ShelfCategoryRef>(
    catalog: ShelfCatalog<S, C>,
    progress: readonly StandingProgress[],
    today: LocalDate,
    rhythmLive: boolean,
  ): readonly StandingShelf<S, C>[] {
    const out: StandingShelf<S, C>[] = [];
    for (let i = 0; i < catalog.categories.length; i++) {
      const category = catalog.categories[i] as C;
      if (category.badgeCategoryKind === BadgeCategoryKind.Records) continue;
      const all = StandingSystem.familiesIn(
        catalog,
        progress,
        FamilyScopeFilter.category(category.id),
        today,
      );
      const families =
        category.badgeCategoryKind === BadgeCategoryKind.Rhythm && !rhythmLive
          ? StandingSystem.earnedOnly(all, progress)
          : all;
      if (families.length === 0) continue;
      out.push({ category, families });
    }
    return out;
  },

  /**
   * A window's medals: its track — withdrawn or not — then its own
   * families ({@link familiesIn}: a withdrawn one only where started). Not
   * {@link neighboursOf}'s list, nor `familiesIn(SEASON)` alone (§7 R-3).
   */
  windowFamilies<S extends StandingSeriesRef>(
    catalog: StandingCatalog<S>,
    progress: readonly StandingProgress[],
    season: {
      readonly id: SeasonId;
      readonly trackSeriesId: BadgeSeriesId | null;
    },
    today: LocalDate,
  ): readonly S[] {
    const out: S[] = [];
    const track =
      season.trackSeriesId === null
        ? null
        : LoyaltyCatalogSystem.series(catalog, season.trackSeriesId);
    if (track !== null) out.push(track);
    const families = StandingSystem.familiesIn(
      catalog,
      progress,
      FamilyScopeFilter.season(season.id),
      today,
    );
    for (let i = 0; i < families.length; i++) out.push(families[i] as S);
    return out;
  },

  /** Anything under way at all: a family moved or a level earned — the medals page's first-medal hint goes once there is. */
  anyUnderWay(progress: readonly StandingProgress[]): boolean {
    for (let i = 0; i < progress.length; i++) {
      const p = progress[i] as StandingProgress;
      if (p.value > 0 || p.earned.length > 0) return true;
    }
    return false;
  },

  /**
   * The glance's strip of medals: the family the visit on screen completes
   * first, the newest earned level's family, then «Скоро»'s — each once, at
   * most `limit`. Slot 0 says «ново» only when nothing completes and it is
   * the newest family. The newest family keeps its own slot, so «Скоро»'s
   * families are read beside it — the first of them is the strip's
   * `closestId`, whatever the limit.
   */
  strip(input: StripInput): MedalStrip {
    const seen = new Set<BadgeSeriesId>();
    const slots: BadgeSeriesId[] = [];
    const limit = Math.max(0, input.limit);
    const push = (id: BadgeSeriesId): void => {
      if (slots.length >= limit || seen.has(id)) return;
      seen.add(id);
      slots.push(id);
    };
    if (input.completingFirst !== null) push(input.completingFirst);
    if (input.newestSeriesId !== null) push(input.newestSeriesId);
    let closestId: BadgeSeriesId | null = null;
    for (let i = 0; i < input.soonIds.length; i++) {
      const id = input.soonIds[i] as BadgeSeriesId;
      if (id === input.newestSeriesId) continue;
      if (closestId === null) closestId = id;
      push(id);
    }
    return {
      slots,
      markNewIndex:
        input.completingFirst === null &&
        input.newestSeriesId !== null &&
        slots[0] === input.newestSeriesId
          ? 0
          : null,
      closestId,
    };
  },

  /**
   * The strip's ONE cue, first match wins: the visit on screen completes a
   * family → `WITH_THIS_VISIT`, naming the level it reaches
   * (`BadgeSystem.nextLevelNumber`) — none for a single act
   * (`BadgeSystem.isOneOff`); else the newest level was earned since the
   * previous visit ({@link isNewSince}) → `NEW`, naming THAT level (the
   * face family's on the newest day — never `BadgeSystem.latestEarned`,
   * whose ties differ); else «Скоро»'s first family has a next level with a
   * threshold → `CLOSE`, naming it; else none.
   */
  stripCue(input: StripCueInput): StripCue {
    if (input.completing !== null) {
      return {
        medalCue: MedalCue.WithThisVisit,
        level: BadgeSystem.isOneOff(input.completing.series)
          ? null
          : BadgeSystem.nextLevelNumber(input.completing.standing),
      };
    }
    if (
      input.newest !== null &&
      StandingSystem.isNewSince(
        input.newest.earnedAtUtcMs,
        input.previousVisitAtUtcMs,
      )
    ) {
      return { medalCue: MedalCue.New, level: input.newest.level };
    }
    const closest = input.closest;
    if (closest !== null && closest.next !== null && closest.target !== null) {
      return { medalCue: MedalCue.Close, level: closest.next.level };
    }
    return { medalCue: null, level: null };
  },

  /**
   * A shelf's sections on its scope page, by what its families are about:
   * MASTERY by the service's category (`serviceCategoryOf`, in the order
   * the categories first appear; a family of no service, or of a service
   * with no category, under `GENERAL`, last); BARBERS as `BARBERS`,
   * `SHOPS`, then `GENERAL` (no subject, or a service); any other shelf ONE
   * `WHOLE` section of every family, even none. Empty sections are left
   * out of the first two; the families keep their order within a section.
   */
  sectionsOf<S extends BadgeSubjectSlot>(
    kind: BadgeCategoryKind,
    families: readonly S[],
    serviceCategoryOf: ReadonlyMap<ServiceId, ServiceCategoryId>,
  ): readonly StandingSection<S>[] {
    if (kind === BadgeCategoryKind.Mastery) {
      const byCategory = new Map<ServiceCategoryId, S[]>();
      const general: S[] = [];
      for (let i = 0; i < families.length; i++) {
        const series = families[i] as S;
        const slot: BadgeSubjectSlot = series;
        const category =
          slot.badgeSubject === BadgeSubject.Service
            ? (serviceCategoryOf.get(slot.subjectServiceId) ?? null)
            : null;
        if (category === null) {
          general.push(series);
          continue;
        }
        const held = byCategory.get(category);
        if (held === undefined) byCategory.set(category, [series]);
        else held.push(series);
      }
      const out: StandingSection<S>[] = [];
      for (const [key, held] of byCategory) {
        out.push({
          scopeSection: ScopeSection.ServiceCategory,
          key,
          families: held,
        });
      }
      if (general.length > 0) {
        out.push({
          scopeSection: ScopeSection.General,
          key: null,
          families: general,
        });
      }
      return out;
    }
    if (kind === BadgeCategoryKind.Barbers) {
      const barbers: S[] = [];
      const shops: S[] = [];
      const general: S[] = [];
      for (let i = 0; i < families.length; i++) {
        const series = families[i] as S;
        if (series.badgeSubject === BadgeSubject.Barber) barbers.push(series);
        else if (series.badgeSubject === BadgeSubject.Location) {
          shops.push(series);
        } else general.push(series);
      }
      const out: StandingSection<S>[] = [];
      if (barbers.length > 0) {
        out.push({
          scopeSection: ScopeSection.Barbers,
          key: null,
          families: barbers,
        });
      }
      if (shops.length > 0) {
        out.push({
          scopeSection: ScopeSection.Shops,
          key: null,
          families: shops,
        });
      }
      if (general.length > 0) {
        out.push({
          scopeSection: ScopeSection.General,
          key: null,
          families: general,
        });
      }
      return out;
    }
    return [{ scopeSection: ScopeSection.Whole, key: null, families }];
  },
} as const;
