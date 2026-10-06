import type { LocalizedText } from '@creativo/domain/catalog';
import type { BadgeSeries } from './badge-series';
import { PER_VISIT_METRICS, type BadgeSubject } from './badge-vocabulary';
import type {
  RedeemProblem,
  RedemptionRecord,
  RewardCatalogItem,
  TierDefinition,
} from './catalog-entries';
import { type IsoDate, daysBetween, sofiaDayOf } from './loyalty-calendar';
import type { LoyaltyCatalog } from './loyalty-catalog';
import type { BadgeProgress, TierState } from './projections';

/**
 * STANDING — what the card derives from one client's progress against the
 * catalogue (client-card-redesign §4.2). Pure functions over the catalogue
 * and the client's projections, the `statWindows(stats, now)` precedent:
 * the behaviour crosses both, so it belongs to neither.
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
  let count = 0;
  for (const p of progress.values()) count += p.earned.length;
  return count;
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
  const shown = (s: BadgeSeries): boolean =>
    !s.isRetired() || progress.has(s.id.value);
  switch (scope.kind) {
    case 'category':
      return catalog.seriesIn(scope.categoryId).filter(shown);
    case 'season': {
      const season = catalog.season(scope.seasonId);
      if (season === null) return [];
      return season.seriesIds
        .map((id) => catalog.series(id.value))
        .filter((s): s is BadgeSeries => s !== null && shown(s));
    }
    case 'archive': {
      const ended = new Set(
        catalog.seasonsIn('ended', today).map((s) => s.id.value),
      );
      return catalog.families.filter(
        (s) => s.seasonId !== null && ended.has(s.seasonId.value) && shown(s),
      );
    }
    case 'day':
      return catalog.families.filter(
        (s) =>
          progress
            .get(s.id.value)
            ?.earned.some((e) => sofiaDayOf(e.earnedAt) === scope.day) === true,
      );
  }
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
  const families = familiesIn(catalog, progress, scope, today);
  return {
    started: families.filter((s) => progress.has(s.id.value)).length,
    earned: families.filter(
      (s) => (progress.get(s.id.value)?.earned.length ?? 0) > 0,
    ).length,
    total: families.length,
  };
}

const SPECIFICITY: Readonly<Record<BadgeSubject['kind'] | 'none', number>> = {
  service: 3,
  barber: 2,
  location: 1,
  none: 0,
};

interface Candidate {
  readonly series: BadgeSeries;
  readonly level: number;
  readonly value: number;
  readonly target: number;
}

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
 *    worked visit — equal target − value on a per-visit count the client's
 *    visits already move (a family not started yet is moved by none of
 *    them) — only the most specific subject stays: service › barber ›
 *    location › none; ties by category order, then series order. A
 *    season's families stay outside step 3: the season is its own clock,
 *    so its track sits beside the service it shares a visit with.
 * 4. Fill to `limit` in rank order; rank ties by the nearer finish, the
 *    shelf order (seasons after categories), the series order, the id.
 */
export function closestLevels(
  catalog: LoyaltyCatalog,
  progress: ReadonlyMap<string, BadgeProgress>,
  today: IsoDate,
  limit: number,
): readonly ClosestLevel[] {
  const shelfOrder = (s: BadgeSeries): number =>
    s.categoryId === null
      ? Number.POSITIVE_INFINITY
      : (catalog.category(s.categoryId.value)?.order ??
        Number.POSITIVE_INFINITY);
  const candidates = catalog.families.flatMap((series): Candidate[] => {
    const season =
      series.seasonId === null ? null : catalog.season(series.seasonId.value);
    if (
      series.isRetired() ||
      series.isCalendarDriven() ||
      (series.seasonId !== null &&
        (season === null || season.phaseOn(today) !== 'open'))
    ) {
      return [];
    }
    const standing = series.standing(progress.get(series.id.value) ?? null);
    if (standing.next === null || standing.target === null) return [];
    return [
      {
        series,
        level: standing.next.level,
        value: standing.value,
        target: standing.target,
      },
    ];
  });

  const bySubject = (a: Candidate, b: Candidate): number =>
    SPECIFICITY[b.series.subject?.kind ?? 'none'] -
      SPECIFICITY[a.series.subject?.kind ?? 'none'] ||
    shelfOrder(a.series) - shelfOrder(b.series) ||
    a.series.order - b.series.order;
  const sameVisit = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const metric = c.series.metric?.metric;
    if (
      c.value === 0 ||
      c.series.categoryId === null ||
      metric === undefined ||
      !PER_VISIT_METRICS.includes(metric)
    ) {
      continue;
    }
    const remaining = c.target - c.value;
    sameVisit.set(remaining, [...(sameVisit.get(remaining) ?? []), c]);
  }
  const yielded = new Set<Candidate>();
  for (const group of sameVisit.values()) {
    const [keep] = [...group].sort(bySubject);
    for (const c of group) if (c !== keep) yielded.add(c);
  }

  const ranked = candidates
    .filter((c) => !yielded.has(c))
    .sort(
      (a, b) =>
        b.value / b.target - a.value / a.target ||
        a.target - a.value - (b.target - b.value) ||
        shelfOrder(a.series) - shelfOrder(b.series) ||
        a.series.order - b.series.order ||
        (a.series.id.value < b.series.id.value ? -1 : 1),
    );
  const shelves = new Set<string>();
  const out: ClosestLevel[] = [];
  for (const c of ranked) {
    if (out.length >= limit) break;
    const shelf =
      c.series.categoryId?.value ?? `season:${c.series.seasonId?.value ?? ''}`;
    if (shelves.has(shelf)) continue;
    shelves.add(shelf);
    out.push({
      seriesId: c.series.id.value,
      level: c.level,
      value: c.value,
      target: c.target,
    });
  }
  return out;
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
  const days = new Map<
    IsoDate,
    { seriesId: string; level: number; earnedAt: Date }[]
  >();
  for (const p of progress.values()) {
    for (const e of p.earned) {
      const day = sofiaDayOf(e.earnedAt);
      days.set(day, [
        ...(days.get(day) ?? []),
        { seriesId: p.seriesId, level: e.level, earnedAt: e.earnedAt },
      ]);
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, Math.max(0, limit))
    .map(([day, levels]) => ({
      day,
      levels: [...levels].sort(
        (a, b) =>
          b.earnedAt.getTime() - a.earnedAt.getTime() || b.level - a.level,
      ),
    }));
}

/** «Ново»: earned after the previous visit began; before a first visit, everything is new. */
export function isNewSince(
  earnedAt: Date,
  previousVisitAtMs: number | null,
): boolean {
  return previousVisitAtMs === null || earnedAt.getTime() > previousVisitAtMs;
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
  if (!item.enabled) return 'disabled';
  if (item.available.from !== null && ctx.today < item.available.from) {
    return 'notYetAvailable';
  }
  if (item.available.until !== null && ctx.today > item.available.until) {
    return 'ended';
  }
  if (item.limits.total !== null && item.redeemedCount >= item.limits.total) {
    return 'soldOut';
  }
  if (ctx.paused) return 'paused';
  if (ctx.balance < item.cost) return 'insufficientPoints';
  const per = item.limits.perClient;
  if (per !== null) {
    const inWindow = ctx.recent.filter(
      (r) =>
        r.rewardId === item.id && daysBetween(r.on, ctx.today) < per.windowDays,
    );
    if (inWindow.length >= per.count) return 'perClientLimit';
  }
  return null;
}

const redeemableOn = (
  item: RewardCatalogItem,
  balance: number,
  today: IsoDate,
): RedeemProblem | null =>
  redeemProblem(item, { balance, today, paused: false, recent: [] });

/** The costliest reward the balance buys today (enabled, in its window, in stock); ties by catalogue order. */
export function bestAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    rewards
      .filter((r) => redeemableOn(r, balance, today) === null)
      .sort((a, b) => b.cost - a.cost || a.order - b.order)[0] ?? null
  );
}

/** The cheapest reward the balance does not reach yet — one that points alone keep from the client. */
export function nextAffordable(
  rewards: readonly RewardCatalogItem[],
  balance: number,
  today: IsoDate,
): RewardCatalogItem | null {
  return (
    rewards
      .filter((r) => redeemableOn(r, balance, today) === 'insufficientPoints')
      .sort((a, b) => a.cost - b.cost || a.order - b.order)[0] ?? null
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
  return {
    steps: [...tiers]
      .sort((a, b) => a.rank - b.rank)
      .map((t) => ({
        tierId: t.id,
        atLeast: t.qualify.atLeast,
        name: t.name,
      })),
    value: state.qualifying,
    currentTierId: state.override?.tierId ?? state.current,
    nextTierId: state.next,
    remaining: state.remaining,
  };
}
