import {
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubject,
  type EarnedDay,
  type EarnedLevel,
  FamilyScopeFilter,
  MedalState,
  Metric,
  PersonalRecord,
  PersonalRecordKind,
  SeasonKind,
  SeasonPhase,
  type SeriesStanding,
} from '@core/components';
import type { BadgeProgress, BadgeSeries, Season } from '@core/entities';
import {
  BadgeCategoryId,
  BadgeSeriesId,
  LocalDate,
  SeasonId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  BadgeSystem,
  LoyaltyCatalogSystem,
  SeasonSystem,
  StandingSystem,
} from '@core/systems';
import { ZonedDateTime } from '@creativo/application/booking';
import type { UiIconName, UiMark, UiMedalState } from '@creativo/ui/controls';
import type {
  AchievementScope,
  ClientCardCatalog,
  ClientCardLeg,
} from './client-card.contracts';
import {
  cardLocaleOf,
  dayLong,
  dayPlus,
  dayRange,
  dayShort,
  figure,
  levelNumeral,
  monogramOf,
} from './client-card.format';
import type {
  AchievementTileVm,
  AchievementsData,
  ArchiveRowVm,
  DetailRelatedVm,
  EventCardVm,
  GaugeVm,
  MedalVm,
  ScopePageVm,
  ScopeSectionVm,
  SeasonCardVm,
  SeasonTrackVm,
} from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';

/*
 * «ПОСТИЖЕНИЯ» — the collection, a scope, a medal (client-card-redesign
 * §3.3–§3.5), as pure functions of the store's `AchievementsData` and the
 * page's own input. The systems decide standing (`BadgeSystem.standing`,
 * `StandingSystem.closestLevels`, `.recentLevelsByDay`, `.familiesIn`,
 * `.familyCounts`) over the catalogue and the progress AS READ; this file
 * only words and draws it, so the glance strip, the collection and a
 * detail page can never tell one family two ways.
 *
 * The numeral rule holds everywhere: a medal's rim is its highest EARNED
 * level, a target lives only in words («24/25 до III»), a title never
 * carries a numeral.
 */

/**
 * Every emblem the catalogue can name, to the registry glyph it draws
 * (§8.2, `loyalty.badge.<emblem>`). Closed: a new emblem is a release, and
 * the compiler holds this map to it — there is no fallback glyph.
 */
export const BADGE_EMBLEM_ICONS: Readonly<Record<BadgeEmblem, UiIconName>> = {
  [BadgeEmblem.Visits]: 'loyalty.badge.visits',
  [BadgeEmblem.Streak]: 'loyalty.badge.streak',
  [BadgeEmblem.Referral]: 'loyalty.badge.referral',
  [BadgeEmblem.SelfService]: 'loyalty.badge.selfService',
  [BadgeEmblem.Birthday]: 'loyalty.badge.birthday',
  [BadgeEmblem.Welcome]: 'loyalty.badge.welcome',
  [BadgeEmblem.Service]: 'loyalty.badge.service',
  [BadgeEmblem.Barber]: 'loyalty.badge.barber',
  [BadgeEmblem.Shop]: 'loyalty.badge.shop',
  [BadgeEmblem.Anniversary]: 'loyalty.badge.anniversary',
  [BadgeEmblem.EarlyBird]: 'loyalty.badge.earlyBird',
  [BadgeEmblem.Weekend]: 'loyalty.badge.weekend',
  [BadgeEmblem.OnTime]: 'loyalty.badge.onTime',
  [BadgeEmblem.Waitlist]: 'loyalty.badge.waitlist',
  [BadgeEmblem.Profile]: 'loyalty.badge.profile',
  [BadgeEmblem.Party]: 'loyalty.badge.party',
  [BadgeEmblem.Explorer]: 'loyalty.badge.explorer',
  [BadgeEmblem.YearRound]: 'loyalty.badge.yearRound',
  [BadgeEmblem.Comeback]: 'loyalty.badge.comeback',
  [BadgeEmblem.Event]: 'loyalty.badge.event',
  [BadgeEmblem.Summer]: 'loyalty.badge.summer',
  [BadgeEmblem.Autumn]: 'loyalty.badge.autumn',
  [BadgeEmblem.Vacation]: 'loyalty.badge.vacation',
  [BadgeEmblem.Sailing]: 'loyalty.badge.sailing',
  [BadgeEmblem.Icecream]: 'loyalty.badge.icecream',
  [BadgeEmblem.Umbrella]: 'loyalty.badge.umbrella',
  [BadgeEmblem.Fog]: 'loyalty.badge.fog',
  [BadgeEmblem.Handshake]: 'loyalty.badge.handshake',
  [BadgeEmblem.Grooming]: 'loyalty.badge.grooming',
  [BadgeEmblem.BeardOil]: 'loyalty.badge.beardOil',
  [BadgeEmblem.Spa]: 'loyalty.badge.spa',
};

/** A shelf's heading glyph (§4.6's table). */
export const BADGE_CATEGORY_ICONS: Readonly<
  Record<BadgeCategoryKind, UiIconName>
> = {
  [BadgeCategoryKind.Milestones]: 'loyalty.category.milestones',
  [BadgeCategoryKind.Mastery]: 'loyalty.category.mastery',
  [BadgeCategoryKind.Barbers]: 'loyalty.category.barbers',
  [BadgeCategoryKind.Rhythm]: 'loyalty.category.rhythm',
  [BadgeCategoryKind.Special]: 'loyalty.category.special',
  [BadgeCategoryKind.Records]: 'loyalty.category.records',
};

/** A family's standing as `ui-medal` draws its state; the fourth state, `complete`, is the ring's (`medals.presenter`). */
export const MEDAL_STATES = {
  [MedalState.NotStarted]: 'notStarted',
  [MedalState.InProgress]: 'inProgress',
  [MedalState.Earned]: 'earned',
} as const satisfies Record<MedalState, UiMedalState>;

/** How many tiles a rail or a shelf shows; past that, the shelf's action is the way on. */
const RAIL_LIMIT = 8;

/** Where the shop's hours are read: the zone of every visit on the card. */
const SHOP_ZONE = 'Europe/Sofia';

/** The last minute a visit may start and still count as an early bird (10:00, §4.6). */
const EARLY_BIRD_LAST_MINUTE = 10 * 60;

// ── The page's context ──────────────────────────────────────────────────

/**
 * What a page adds to the store's data: the words, the catalogue's names
 * and art, whose card it is, and the visit on screen as «с това посещение»
 * measures it. The store builds it once (`ClientCardStore.achievementsContext`).
 */
export interface AchievementsContext {
  readonly words: ClientCardWords;
  readonly catalog: ClientCardCatalog;
  /** The person's display name — the scope pages' subline. */
  readonly subjectName: string;
  /**
   * The visit on screen while it can still move a family — open (not
   * settled) — or `null`. Its legs name the services and barbers, the
   * draft's shop the location, and `birthdayToday` the one yearly act a
   * visit completes on its day.
   */
  readonly visit: {
    readonly legs: readonly ClientCardLeg[];
    readonly locationId: string | null;
    readonly birthdayToday: boolean;
  } | null;
}

// ── Scope keys (the editor's `achievementCategory` subject id, §2.1) ────

/** `category:{id}` · `season:{id}` · `archive` · `day:{YYYY-MM-DD}`. */
export function achievementScopeKey(scope: AchievementScope): string {
  switch (scope.kind) {
    case 'category':
      return `category:${scope.categoryId}`;
    case 'season':
      return `season:${scope.seasonId}`;
    case 'archive':
      return 'archive';
    case 'day':
      return `day:${scope.day}`;
  }
}

/** The scope a key names, or `null` for a key that names none. */
export function achievementScopeOf(key: string): AchievementScope | null {
  if (key === 'archive') return { kind: 'archive' };
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (id.length === 0) return null;
  switch (kind) {
    case 'category':
      return { kind: 'category', categoryId: id };
    case 'season':
      return { kind: 'season', seasonId: id };
    case 'day':
      return /^\d{4}-\d{2}-\d{2}$/.test(id) ? { kind: 'day', day: id } : null;
    default:
      return null;
  }
}

// ── One family ──────────────────────────────────────────────────────────

/** How a medal sits where it is drawn. */
export interface MedalOptions {
  /** The family's title under the disc (rails, grids). */
  readonly titled?: boolean;
  /** The caption under the title (rails, grids). */
  readonly captioned?: boolean;
  /** The thin meter towards the next level. */
  readonly meter?: boolean;
  /** Replaces the caption (the day on «Последни», a day group's too: «4.09»). */
  readonly caption?: string;
  /** Replaces the title (an archived season's medal carries the season's name, a day group its face's family and count «В ритъм +2»). */
  readonly title?: string;
  /**
   * «Ново» when the family's latest level was earned since the previous
   * visit. Opt-in, because a family is new in ONE place per page (§3.0):
   * «Последни» (AE) and the glance strip's first slot (G1) pass it; «Скоро»,
   * the shelves, the scope grids, a season's families and «Още от …» never
   * do — a medal still to come is not «new», and the chip there repeated
   * the «Последни» fact and reserved its band over the whole rail.
   */
  readonly markNew?: boolean;
}

export function localeOf(ctx: AchievementsContext) {
  return cardLocaleOf(ctx.words.lang);
}

export function progressOf(
  data: AchievementsData,
  series: Pick<BadgeSeries, 'id'>,
): BadgeProgress | null {
  return data.progress.get(series.id) ?? null;
}

/** Every started family's progress, as the standing systems read it. */
export function progressList(data: AchievementsData): readonly BadgeProgress[] {
  return [...data.progress.values()];
}

/** A shop day the card holds — the clock's «today», a scope's day: always a day. */
export function cardDayOf(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/** The card's «Ново» mark: the start of the previous visit, as the stamp it is; `null` before a first one. */
export function previousVisitOf(data: AchievementsData): UtcEpochMs | null {
  const at = data.previousVisitAtMs;
  if (at === null) return null;
  const utc = UtcEpochMs.of(at);
  return utc.ok ? utc.value : defect(`${at} is not an instant`);
}

/** The shop day a level was earned on (a yearly one keeps its latest) — the stored day (T5), never re-bucketed. */
export function earnedOnOf(
  progress: BadgeProgress | null,
  level: number,
): LocalDate | null {
  return (
    progress?.earned.find((e) => e.level === level)?.earnedLocalDate ?? null
  );
}

export function latestEarned(
  progress: BadgeProgress | null,
): EarnedLevel | null {
  let latest: EarnedLevel | null = null;
  for (const earned of progress?.earned ?? []) {
    if (
      latest === null ||
      UtcEpochMs.compare(earned.earnedAtUtcMs, latest.earnedAtUtcMs) > 0
    ) {
      latest = earned;
    }
  }
  return latest;
}

/** The season or event a family belongs to, or `null`. */
export function seasonOfSeries(
  series: Pick<BadgeSeries, 'seasonId'>,
  data: AchievementsData,
): Season | null {
  return series.seasonId === null
    ? null
    : LoyaltyCatalogSystem.season(data.catalog, series.seasonId);
}

/** Where a season's window stands on the card's today. */
export function seasonPhaseOf(
  season: Season,
  data: AchievementsData,
): SeasonPhase {
  return SeasonSystem.phaseOn(season, cardDayOf(data.today));
}

/** A family by its id (a VM's `seriesId`, a route's), or `null`. */
export function seriesById(
  data: AchievementsData,
  seriesId: string,
): BadgeSeries | null {
  return LoyaltyCatalogSystem.series(data.catalog, BadgeSeriesId.of(seriesId));
}

/** Where a family stands for this client. */
export function standingOf(
  series: BadgeSeries,
  data: AchievementsData,
): SeriesStanding {
  return BadgeSystem.standing(series, progressOf(data, series));
}

/** The families a scope page draws, by the systems' scope filter. */
export function familyScopeOf(scope: AchievementScope): FamilyScopeFilter {
  switch (scope.kind) {
    case 'category':
      return FamilyScopeFilter.category(BadgeCategoryId.of(scope.categoryId));
    case 'season':
      return FamilyScopeFilter.season(SeasonId.of(scope.seasonId));
    case 'archive':
      return FamilyScopeFilter.archive();
    case 'day':
      return FamilyScopeFilter.day(cardDayOf(scope.day));
  }
}

/** The families a scope draws, in catalogue order (`StandingSystem.familiesIn`). */
export function familiesOf(
  data: AchievementsData,
  scope: FamilyScopeFilter,
): readonly BadgeSeries[] {
  return StandingSystem.familiesIn(
    data.catalog,
    progressList(data),
    scope,
    cardDayOf(data.today),
  );
}

/** A scope's families counted: earned, started, drawn (`StandingSystem.familyCounts`). */
export function familyCountsOf(
  data: AchievementsData,
  scope: FamilyScopeFilter,
): {
  readonly started: number;
  readonly earned: number;
  readonly total: number;
} {
  return StandingSystem.familyCounts(
    data.catalog,
    progressList(data),
    scope,
    cardDayOf(data.today),
  );
}

/**
 * THE PENDING RING — how far the arc of a level this visit completes is
 * drawn: all but closed. The closed ring is the `complete` form alone
 * (§3.8: four states told apart by FORM — a grey in-progress face inside
 * a full ring read as complete, review 3, F8); the gap left is the gauge's
 * own cap, and the sentence says the rest («с това посещение»).
 */
export const PENDING_RING = 0.92;

/** A single act: one level with no target («Добре дошъл», «Рожден ден в салона»). */
export function isOneOff(series: BadgeSeries): boolean {
  return series.levels.length === 1 && series.levels[0]?.target === null;
}

/**
 * A family of ONE level, counted or not («Есенно утро», «Всеки летен
 * месец», «Добре дошъл»): earning it is the whole family, so once earned
 * it is worded as a single act — by its day — never «Всички нива», the
 * words for a ladder climbed to its top.
 */
export function isSingleLevel(series: BadgeSeries): boolean {
  return series.levels.length === 1;
}

/**
 * The family's season or event has ended on `data.today` (CF): it keeps
 * the levels it reached and can reach no more, so nothing about it reads
 * as progress — no meter, no «3/4 до IV», no «Още …».
 */
export function inEndedSeason(
  series: BadgeSeries,
  data: AchievementsData,
): boolean {
  const season = seasonOfSeries(series, data);
  return season !== null && seasonPhaseOf(season, data) === SeasonPhase.Ended;
}

/**
 * The day a calendar-driven family's next level lands — tenure's: the
 * first worked visit and the level's days («Години с нас» II on the second
 * anniversary). Its caption, state line and sentences word THAT date,
 * never «576/730 до II»: a count of days is not a unit a barber reads at a
 * glance (wave D r4). The meter keeps the day fraction. Never before
 * today: a level due and not yet stamped lands today. `null` for every
 * other family, and for a complete one.
 */
export function landsOn(
  series: BadgeSeries,
  standing: SeriesStanding,
  data: AchievementsData,
): string | null {
  if (!BadgeSystem.isCalendarDriven(series) || standing.target === null) {
    return null;
  }
  const first =
    PersonalRecord.find(data.account.records, PersonalRecordKind.FirstVisit)
      ?.on ?? null;
  const day =
    first === null
      ? dayPlus(data.today, Math.max(0, standing.target - standing.value))
      : dayPlus(first, standing.target);
  return day < data.today ? data.today : day;
}

/** The start of the visit's first leg, in minutes from the shop's midnight. */
function earliestStartMinute(legs: readonly ClientCardLeg[]): number | null {
  let earliest: number | null = null;
  for (const leg of legs) {
    const start = ZonedDateTime.fromISO(leg.startsAtIso, SHOP_ZONE);
    if (start.isFailure()) continue;
    const minute = start.value.hour * 60 + start.value.minute;
    if (earliest === null || minute < earliest) earliest = minute;
  }
  return earliest;
}

/**
 * «с това посещение» (§3.3.3): the visit on screen is open and would
 * complete the family's next level — one short on a count the visit moves
 * (visits; visits with one of its services, its barber or its shop; an
 * early-bird start by 10:00), a season's families only while the season
 * runs — or it is the client's birthday visit and the yearly act is not
 * yet this year's. Presenter-only: nothing is written.
 */
export function completesWithThisVisit(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
): boolean {
  const visit = ctx.visit;
  if (
    visit === null ||
    BadgeSystem.isRetired(series) ||
    BadgeSystem.isCalendarDriven(series)
  ) {
    return false;
  }
  if (series.seasonId !== null) {
    const season = seasonOfSeries(series, data);
    if (season === null || seasonPhaseOf(season, data) !== SeasonPhase.Open) {
      return false;
    }
  }
  const progress = progressOf(data, series);
  if (series.repeatable && series.emblem === BadgeEmblem.Birthday) {
    const last = latestEarned(progress);
    // The year it was last earned is its stored shop day's (T5).
    return (
      visit.birthdayToday &&
      (last === null ||
        last.earnedLocalDate.slice(0, 4) < data.today.slice(0, 4))
    );
  }
  const standing = BadgeSystem.standing(series, progress);
  if (standing.next === null || standing.target === null) return false;
  if (standing.target - standing.value > 1) return false;
  switch (series.metric) {
    case Metric.VisitsCompleted: {
      const serviceId = series.metricScopeServiceId;
      if (serviceId !== null) {
        return visit.legs.some((leg) => leg.serviceId === serviceId);
      }
      const barberId = series.metricScopeBarberId;
      if (barberId !== null) {
        return visit.legs.some((leg) => leg.barberId === barberId);
      }
      if (series.metricScopeLocationId !== null) {
        return visit.locationId === series.metricScopeLocationId;
      }
      return true;
    }
    case Metric.VisitsEarlyBird: {
      const minute = earliestStartMinute(visit.legs);
      return minute !== null && minute <= EARLY_BIRD_LAST_MINUTE;
    }
    default:
      return false;
  }
}

/**
 * Owner art › the subject's art (the barber's face, the service's or the
 * shop's cover) — ONE FACE PER FAMILY, catalogue-wide (§3.3.3, wave D r6):
 *
 * - A season's or an event's family never draws its subject's art (nor its
 *   letter, `monogramFor`): the service's cover is the perennial family's
 *   face, and «Есенна брада», «Брада на седмицата» and «Оформяне на брада»
 *   were one beard photo three times on one scroll. It draws its own
 *   emblem, a limited edition's.
 * - Two families whose subjects share one picture (a shop that reuses a
 *   photo: the seed's «Пълна грижа» wears «Класическа подстрижка»'s cover,
 *   «Баща и син» «Модерна визия»'s) are not one face twice: the first in
 *   the catalogue's order keeps it, the other draws its letter, the
 *   avatar-fallback grammar — on every page alike, so a family never
 *   changes face between the shelf, its scope and its detail.
 */
function artOf(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
): string | null {
  if (series.artPath !== null) {
    const owner = ctx.catalog.badgeArtSrc?.(series.artPath) ?? null;
    if (owner !== null) return owner;
  }
  if (series.seasonId !== null) return null;
  const src = subjectArtOf(series, ctx);
  return src !== null && artOwnersOf(data, ctx).get(src) === series.id
    ? src
    : null;
}

/** Which family each subject picture belongs to, per catalogue and shop (`artOwnersOf`). */
const ART_OWNERS = new WeakMap<
  AchievementsData['catalog'],
  WeakMap<ClientCardCatalog, ReadonlyMap<string, string>>
>();

/**
 * Each subject picture to the one family that draws it (`artOf`): the
 * first in the catalogue's order — shelf by shelf, each in its own order,
 * the live families before the retired — among the families no season
 * holds.
 */
function artOwnersOf(
  data: AchievementsData,
  ctx: AchievementsContext,
): ReadonlyMap<string, string> {
  let byShop = ART_OWNERS.get(data.catalog);
  if (byShop === undefined) {
    byShop = new WeakMap();
    ART_OWNERS.set(data.catalog, byShop);
  }
  const known = byShop.get(ctx.catalog);
  if (known !== undefined) return known;
  const shelved = data.catalog.categories.flatMap((category) =>
    LoyaltyCatalogSystem.seriesIn(data.catalog, category.id),
  );
  const owners = new Map<string, string>();
  for (const series of [
    ...shelved.filter((s) => !BadgeSystem.isRetired(s)),
    ...shelved.filter((s) => BadgeSystem.isRetired(s)),
  ]) {
    if (series.seasonId !== null) continue;
    const src = subjectArtOf(series, ctx);
    if (src !== null && !owners.has(src)) owners.set(src, series.id);
  }
  byShop.set(ctx.catalog, owners);
  return owners;
}

/** The picture of the thing a family is about, if the catalogue has one. */
function subjectArtOf(
  series: BadgeSeries,
  ctx: AchievementsContext,
): string | null {
  switch (series.badgeSubject) {
    case null:
      return null;
    case BadgeSubject.Barber:
      return ctx.catalog.barberAvatarSrc(series.subjectBarberId);
    case BadgeSubject.Service:
      return ctx.catalog.serviceCoverSrc(series.subjectServiceId);
    case BadgeSubject.Location:
      return ctx.catalog.locationCoverSrc(series.subjectLocationId);
  }
}

/**
 * The letter a family about ONE thing draws when it has no art — the
 * avatar-fallback grammar, so a shelf of shops or barbers without covers
 * or portraits reads «Ц» · «М», never a row of identical storefronts
 * (§3.3: families drawn with their own art).
 *
 * A service family takes its title's letter («Фейд» → «Ф»): it is named
 * after its service. A barber's or a shop's family is titled as a phrase
 * («С Иван», «Със Стефан» — every barber an «С»), so its letter comes from
 * the name the catalogue gives the barber or the shop («Иван» → «И»,
 * «Център» → «Ц»). A subject the catalogue no longer knows, a family about
 * no one thing, and a season's or an event's family (a limited edition
 * wears its own emblem, `artOf`) draw their emblem.
 */
function monogramFor(
  series: BadgeSeries,
  ctx: AchievementsContext,
): string | null {
  if (series.seasonId !== null) return null;
  let name: string | null;
  switch (series.badgeSubject) {
    case null:
      return null;
    case BadgeSubject.Service:
      name = series.title[localeOf(ctx)];
      break;
    case BadgeSubject.Barber:
      name = ctx.catalog.barberName(series.subjectBarberId);
      break;
    case BadgeSubject.Location:
      name = ctx.catalog.locationName(series.subjectLocationId);
      break;
  }
  return name === null ? null : monogramOf(name, ctx.words.lang);
}

/** The caption a medal carries on a rail or a grid, by the numeral rule. */
function captionOf(
  series: BadgeSeries,
  standing: SeriesStanding,
  progress: BadgeProgress | null,
  withThisVisit: boolean,
  data: AchievementsData,
  ctx: AchievementsContext,
): string | null {
  const words = ctx.words.achievements;
  if (withThisVisit) return words.withThisVisit;
  const last = latestEarned(progress);
  // An ended season's family stopped where it stopped (CF): its rim says
  // where, and no target is left to word — never «3/4 до IV». Nor its
  // day: a season's last visit completes several of its families at once,
  // so the day repeated the state line of the detail beside it («7.08»).
  if (standing.next !== null && last !== null && inEndedSeason(series, data)) {
    return null;
  }
  if (standing.next !== null) {
    const on = landsOn(series, standing, data);
    if (on !== null) {
      // The date is one unit: a narrow tile wraps before it («II на» ·
      // «1.03.2027 г.»), never inside it (an orphaned «г.»).
      return words.toLevelOn(
        levelNumeral(standing.next.level),
        dayShort(on, data.today, ctx.words.lang).replace(/ /gu, ' '),
      );
    }
    return standing.target === null
      ? ctx.words.achievement.oneOffNotYet
      : words.toLevel(
          standing.value,
          standing.target,
          levelNumeral(standing.next.level),
        );
  }
  if ((isSingleLevel(series) || series.repeatable) && last !== null) {
    return dayShort(last.earnedLocalDate, data.today, ctx.words.lang);
  }
  return words.complete;
}

/**
 * One family as `ui-medal` draws it (§5.1.13): its state, its art, the rim
 * numeral of its highest earned level, a caption in words, the thin meter,
 * «Ново» when earned since the previous visit and the place asks for it
 * (`markNew`), and one sentence for a screen reader.
 */
export function medalVm(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
  options: MedalOptions = {},
): MedalVm {
  const lang = ctx.words.lang;
  const locale = localeOf(ctx);
  const progress = progressOf(data, series);
  const standing = BadgeSystem.standing(series, progress);
  const withThisVisit = completesWithThisVisit(series, data, ctx);
  const title = options.title ?? series.title[locale];
  const src = artOf(series, data, ctx);
  const monogram = src === null ? monogramFor(series, ctx) : null;
  const latest = latestEarned(progress);
  const isNew =
    (options.markNew ?? false) &&
    standing.medalState === MedalState.Earned &&
    latest !== null &&
    StandingSystem.isNewSince(latest.earnedAtUtcMs, previousVisitOf(data));
  // An ended season's family has no next level to be drawn towards (CF).
  const toNext =
    standing.next !== null &&
    standing.target !== null &&
    !inEndedSeason(series, data)
      ? {
          value: standing.value,
          target: standing.target,
          level: levelNumeral(standing.next.level),
        }
      : null;
  // THE PENDING FACE (wave D r4, Critique 3): a level the visit on screen
  // completes is the one thing to say now, so it never looks like the
  // dullest medal on the card. Short of earned it is drawn in progress —
  // the solid ring, the art or glyph in full ink, never the grey dashed
  // silhouette — and its meter stands where the visit takes it: all but
  // closed (`PENDING_RING`). An earned family's rim keeps its highest
  // EARNED level (the numeral rule); its meter stands the same. The
  // sentence still says where it truly stands.
  const nextLevel = levelNumeral(
    standing.next?.level ?? standing.highestLevel + 1,
  );
  // A calendar-driven family (tenure) is worded by the day its next level
  // lands, not by days counted (`landsOn`); its meter keeps the fraction.
  const on = toNext === null ? null : landsOn(series, standing, data);
  const meter =
    (options.meter ?? true) && withThisVisit
      ? {
          value: PENDING_RING,
          text: ctx.words.achievements.nextWithThisVisit(nextLevel),
        }
      : (options.meter ?? true) &&
          standing.medalState !== MedalState.NotStarted &&
          toNext !== null
        ? {
            value: Math.min(1, Math.max(0, toNext.value / toNext.target)),
            text:
              on === null
                ? ctx.words.achievement.stateToNext(
                    toNext.value,
                    toNext.target,
                    toNext.level,
                  )
                : ctx.words.achievement.stateToNextOn(
                    toNext.level,
                    dayShort(on, data.today, lang),
                  ),
          }
        : null;
  const caption =
    options.caption ??
    ((options.captioned ?? true)
      ? captionOf(series, standing, progress, withThisVisit, data, ctx)
      : null);

  const achievement = ctx.words.achievement;
  const withVisitSuffix = withThisVisit
    ? `, ${ctx.words.achievements.withThisVisit}`
    : '';
  let accessibleName: string;
  if (standing.medalState === MedalState.Earned) {
    const earnedOn = earnedOnOf(progress, standing.highestLevel);
    accessibleName =
      achievement.medalEarnedName(
        title,
        levelNumeral(standing.highestLevel),
        earnedOn === null ? '' : dayLong(earnedOn, data.today, lang),
        toNext === null
          ? ''
          : on !== null
            ? achievement.nextOnSuffix(
                toNext.level,
                dayLong(on, data.today, lang),
              )
            : achievement.nextSuffix(toNext.value, toNext.target, toNext.level),
        isNew ? achievement.newSuffix : '',
      ) + withVisitSuffix;
  } else if (standing.medalState === MedalState.InProgress && toNext !== null) {
    accessibleName =
      (on !== null
        ? `${title}${achievement.nextOnSuffix(
            toNext.level,
            dayLong(on, data.today, lang),
          )}`
        : achievement.medalProgressName(
            title,
            toNext.value,
            toNext.target,
            toNext.level,
          )) + withVisitSuffix;
  } else if (standing.medalState === MedalState.InProgress) {
    accessibleName = `${title}, ${achievement.oneOffNotYet}${withVisitSuffix}`;
  } else {
    accessibleName =
      achievement.medalNotStartedName(
        title,
        series.levels[0]?.requirement[locale] ?? series.requirement[locale],
      ) + withVisitSuffix;
  }

  return {
    seriesId: series.id,
    state:
      withThisVisit && standing.medalState === MedalState.NotStarted
        ? MEDAL_STATES[MedalState.InProgress]
        : MEDAL_STATES[standing.medalState],
    icon: BADGE_EMBLEM_ICONS[series.emblem],
    src,
    monogram,
    level:
      standing.highestLevel > 0 ? levelNumeral(standing.highestLevel) : null,
    title: (options.titled ?? true) ? title : null,
    caption,
    value: meter?.value ?? null,
    valueText: meter?.text ?? null,
    isNew,
    accessibleName,
  };
}

/** A family as a tile of a rail or a grid; a tap opens its detail. */
export function familyTile(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
  options: MedalOptions = {},
): AchievementTileVm {
  return {
    key: series.id,
    medal: medalVm(series, data, ctx, options),
    opens: null,
  };
}

/**
 * What a disc SHOWS, to tell two discs apart on one screen: its art, else
 * its letter, else its glyph — whatever family it belongs to (wave D r5).
 * One face per family holds across the catalogue's seasons too since
 * wave D r6 (§3.3.3: «Съботен» and «Лятна събота» wore one sofa, every
 * season's track one rosette), so on the seeded catalogue a face names one
 * family; this still keys by face for a shop whose own catalogue repeats
 * one. The rim is left out on purpose: one face at two levels still reads
 * as one medal twice.
 */
function faceKey(
  src: string | null,
  monogram: string | null,
  icon: UiIconName | null,
): string {
  return src !== null
    ? `art:${src}`
    : monogram !== null
      ? `letter:${monogram}`
      : `glyph:${icon ?? ''}`;
}

/** The face a medal draws (`faceKey`). */
function faceOf(medal: MedalVm): string {
  return faceKey(medal.src, medal.monogram, medal.icon);
}

/** The face a family draws (`faceKey`), without wording it. */
function familyFace(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
): string {
  const src = artOf(series, data, ctx);
  return faceKey(
    src,
    src === null ? monogramFor(series, ctx) : null,
    BADGE_EMBLEM_ICONS[series.emblem],
  );
}

/**
 * A shelf's order: earned (highest level first) → in progress (closest
 * first) → not started (series order). The catalogue's own order breaks
 * every tie, so the families keep their places as they progress.
 */
export function shelfOrdered(
  families: readonly BadgeSeries[],
  data: AchievementsData,
): readonly BadgeSeries[] {
  const rank = (series: BadgeSeries) => {
    const standing = standingOf(series, data);
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
    return { band, within };
  };
  return families
    .map((series, index) => ({ series, index, ...rank(series) }))
    .sort((a, b) => a.band - b.band || a.within - b.within || a.index - b.index)
    .map((entry) => entry.series);
}

// ── «Скоро» and «Последни» ─────────────────────────────────────────────

/**
 * The families «Скоро» shows, in order: the single acts this very visit
 * completes (a birthday visit — `closestLevels` holds only counted levels),
 * then `closestLevels` under the diversity rule. The glance strip reads the
 * same list, so the strip and the rail never disagree; the rail only
 * leaves out what its own page already draws — the season track its
 * season card words, the families «Последни» shows (`soonTiles`).
 */
export function soonSeriesIds(
  data: AchievementsData,
  ctx: AchievementsContext,
  limit: number,
): readonly string[] {
  const acts = data.catalog.families
    .filter(
      (series) =>
        series.levels.every((level) => level.target === null) &&
        completesWithThisVisit(series, data, ctx),
    )
    .map((series): string => series.id);
  const closest = StandingSystem.closestLevels(
    data.catalog,
    progressList(data),
    cardDayOf(data.today),
    limit,
  ).map((level): string => level.badgeSeriesId);
  return [...new Set([...acts, ...closest])].slice(0, Math.max(0, limit));
}

/**
 * The faces the page draws beside «Последни» on its first screen — the
 * season card's (AF) — for a day group to keep clear of (`latestTiles`).
 */
export interface FacesBeside {
  /** Large discs: the card's track medal. */
  readonly medals: ReadonlySet<string>;
  /** Small discs: the card's preview of its families. */
  readonly previews: ReadonlySet<string>;
}

const NOTHING_BESIDE: FacesBeside = { medals: new Set(), previews: new Set() };

/**
 * «Последни»: earned levels by their day, newest first. A day with one
 * level is that family, captioned with the day; a day with several is ONE
 * item — the DS's stack, titled by the family on its face and how many
 * more the day holds («Лятна събота +1»), captioned «13.06» — opening that
 * day's scope. One count, once, and the date is always the caption, so the
 * rail's timeline reads along one line.
 *
 * A family shows once, on the newest day it moved: its medal already wears
 * its highest level, so an older day repeating it would draw the same face
 * twice (the rail's one rule, §3.3). A day whose every family is already
 * on the rail is left out; the rail stops at eight items.
 *
 * A day's face is the newest of its families whose face nothing near it
 * draws yet (wave D r5): not a face the rail already shows, nor the season
 * card's medal — the summer track's rosette at III over the autumn card's
 * rosette read as one medal at two levels — and, failing that, not one of
 * the card's small previews either. Only when every family of the day
 * clashes does its newest stay the face.
 */
export function latestTiles(
  data: AchievementsData,
  ctx: AchievementsContext,
  beside: FacesBeside = NOTHING_BESIDE,
): readonly AchievementTileVm[] {
  const words = ctx.words;
  const shown = new Set<string>();
  const faces = new Set<string>();
  const tiles: AchievementTileVm[] = [];
  const push = (tile: AchievementTileVm) => {
    tiles.push(tile);
    faces.add(faceOf(tile.medal));
  };
  for (const day of StandingSystem.recentLevelsByDay(
    progressList(data),
    Number.MAX_SAFE_INTEGER,
  )) {
    if (tiles.length >= RAIL_LIMIT) break;
    const fresh = day.levels.filter((level) => !shown.has(level.badgeSeriesId));
    for (const level of day.levels) shown.add(level.badgeSeriesId);
    const newest = fresh[0];
    if (newest === undefined) continue;
    const short = dayShort(day.localDate, data.today, words.lang);
    if (day.levels.length === 1) {
      const series = LoyaltyCatalogSystem.series(
        data.catalog,
        newest.badgeSeriesId,
      );
      if (series === null) continue;
      push(
        familyTile(series, data, ctx, {
          caption: short,
          meter: false,
          markNew: true,
        }),
      );
      continue;
    }
    const series = fresh
      .flatMap((level, index) => {
        const family = LoyaltyCatalogSystem.series(
          data.catalog,
          level.badgeSeriesId,
        );
        if (family === null) return [];
        const face = familyFace(family, data, ctx);
        const clash =
          faces.has(face) || beside.medals.has(face)
            ? 2
            : beside.previews.has(face)
              ? 1
              : 0;
        return [{ family, index, clash }];
      })
      .sort((a, b) => a.clash - b.clash || a.index - b.index)[0]?.family;
    if (series === undefined) continue;
    // What on the title line, when on the caption line — the single tile's
    // grammar, so every date on the rail sits on one line to scan: the
    // face's family and the day's other levels, counted once («В ритъм
    // +2», the count bound to the name), over «28.09».
    const count = day.levels.length;
    const medal = medalVm(series, data, ctx, {
      title: `${series.title[localeOf(ctx)]}\u00a0+${figure(
        count - 1,
        words.lang,
      )}`,
      caption: short,
      meter: false,
    });
    const isNew = StandingSystem.isNewSince(
      newest.earnedAtUtcMs,
      previousVisitOf(data),
    );
    push({
      key: day.localDate,
      medal: {
        ...medal,
        isNew,
        accessibleName:
          words.achievements.dayGroupName(
            dayLong(day.localDate, data.today, words.lang),
            count,
          ) + (isNew ? words.achievement.newSuffix : ''),
      },
      opens: { kind: 'day', day: day.localDate },
    });
  }
  return tiles;
}

/** What the season card (AF) draws, for «Последни» to keep clear of (`latestTiles`). */
function facesBesideCard(card: SeasonCardVm | null): FacesBeside {
  return card === null
    ? NOTHING_BESIDE
    : {
        medals: new Set([faceOf(card.medal)]),
        previews: new Set(card.families.map(faceOf)),
      };
}

/**
 * The newest earned level AS «Последни» DRAWS IT (wave D r6): the family
 * on the face of its first item — the newest day, beside the running
 * season's card, the r5 clash rank — and that family's level on the day.
 * The glance strip's newest slot reads it, so the strip and the rail one
 * push away draw the newest day as one medal: Мартин's 21.08 is «Всеки
 * летен месец» I on both, never «Лято 2026» III on the glance. `null`
 * before the first earned level.
 */
export function newestFaceLevel(
  data: AchievementsData,
  ctx: AchievementsContext,
): EarnedDay.Level | null {
  const day = StandingSystem.recentLevelsByDay(progressList(data), 1)[0];
  if (day === undefined) return null;
  const season = LoyaltyCatalogSystem.seasonsIn(
    data.catalog,
    SeasonPhase.Open,
    cardDayOf(data.today),
  ).find((s) => s.seasonKind === SeasonKind.Season);
  const card = season === undefined ? null : seasonCardVm(season, data, ctx);
  const lead = latestTiles(data, ctx, facesBesideCard(card))[0];
  return (
    day.levels.find((level) => level.badgeSeriesId === lead?.medal.seriesId) ??
    day.levels[0] ??
    null
  );
}

// ── Seasons and events ─────────────────────────────────────────────────

function seasonTrack(
  season: Season,
  data: AchievementsData,
  ctx: AchievementsContext,
): SeasonTrackVm | null {
  const track =
    season.trackSeriesId === null
      ? null
      : LoyaltyCatalogSystem.series(data.catalog, season.trackSeriesId);
  if (track === null) return null;
  const words = ctx.words.achievements;
  const standing = standingOf(track, data);
  const value =
    data.seasonProgress.get(season.id)?.trackValue ?? standing.value;
  // An ended season can reach nothing more: its track is the levels it
  // reached, the last one current and none ringed next.
  const ended = seasonPhaseOf(season, data) === SeasonPhase.Ended;
  const levels = ended
    ? track.levels.filter((level) => level.level <= standing.highestLevel)
    : track.levels;
  if (levels.length === 0) return null;
  const marks: readonly UiMark[] = levels.map((level) => ({
    value: level.target ?? level.level,
    label: null,
    short: levelNumeral(level.level),
  }));
  const max = marks.at(-1)?.value ?? 1;
  const next =
    standing.next !== null && standing.target !== null
      ? { level: levelNumeral(standing.next.level), target: standing.target }
      : null;
  // The visit in the chair counts, as the glance's cue says it does — in
  // the steps too (wave D r5): the medal beside them wears the pending face
  // with its level «с това посещение», so the steps stand where the visit
  // takes them, the level it lands the current node — what the track
  // shows once the visit is saved. Nothing is written.
  const pending =
    !ended && next !== null && completesWithThisVisit(track, data, ctx);
  const sentence = ended
    ? null
    : next === null
      ? words.complete
      : pending
        ? words.nextWithThisVisit(next.level)
        : words.seasonNext(Math.max(1, next.target - value), next.level);
  const drawn = Math.min(pending && next !== null ? next.target : value, max);
  const gauge: GaugeVm = {
    value: drawn,
    min: 0,
    max,
    marks,
    label: season.title[localeOf(ctx)],
    valueText:
      sentence ?? words.seasonEndedAt(levelNumeral(standing.highestLevel)),
  };
  const medal = medalVm(track, data, ctx, {
    titled: false,
    captioned: false,
    meter: false,
  });
  // The steps' current node prints the level (DV14), so the medal leading
  // them leaves its rim empty — the same numeral twice on one row (§3.0,
  // wave D r5). A finished track of earned levels prints no numeral (its
  // last node is checked, an ended season's always): there the rim is the
  // one place the level is drawn. The medal's sentence keeps the level.
  const finished = !pending && drawn >= max;
  return {
    seasonId: season.id,
    medal: finished ? medal : { ...medal, level: null },
    gauge,
    sentence,
  };
}

/** AF — the season running today: its medal over its steps, its families under them. */
export function seasonCardVm(
  season: Season,
  data: AchievementsData,
  ctx: AchievementsContext,
): SeasonCardVm | null {
  const track = seasonTrack(season, data, ctx);
  if (track === null) return null;
  const words = ctx.words;
  const title = season.title[localeOf(ctx)];
  const scope = FamilyScopeFilter.season(season.id);
  const counts = familyCountsOf(data, scope);
  const families = familiesOf(data, scope);
  const level = data.seasonProgress.get(season.id)?.trackLevel ?? 0;
  const until = words.achievements.eventUntil(
    dayLong(season.windowUntil, data.today, words.lang),
  );
  return {
    ...track,
    title,
    dates: dayRange(
      season.windowFrom,
      season.windowUntil,
      data.today,
      words.lang,
    ),
    // A preview in shelf order: the card draws as many as its line holds
    // and «+N» for the rest (the body's preview); the scope it opens has all.
    families: shelfOrdered(families, data).map((series) =>
      medalVm(series, data, ctx, {
        titled: false,
        captioned: false,
        meter: false,
      }),
    ),
    familiesCaption: words.achievements.seasonFamilies(
      counts.earned,
      counts.total,
    ),
    accessibleName:
      level > 0
        ? `${words.achievements.seasonFact(title, levelNumeral(level))}, ${until}`
        : `${title}, ${until}`,
  };
}

/** AG — an open event, or an announced one (never hidden, never counted yet). */
export function eventCardVm(
  season: Season,
  data: AchievementsData,
  ctx: AchievementsContext,
): EventCardVm {
  const words = ctx.words;
  const title = season.title[localeOf(ctx)];
  const scope = FamilyScopeFilter.season(season.id);
  const announced = seasonPhaseOf(season, data) === SeasonPhase.Announced;
  const counts = familyCountsOf(data, scope);
  const count = announced
    ? null
    : words.achievements.familyCount(counts.earned, counts.total);
  const when = announced
    ? words.achievements.eventAnnounced(
        dayShort(season.windowFrom, data.today, words.lang),
      )
    : words.achievements.eventUntil(
        dayShort(season.windowUntil, data.today, words.lang),
      );
  const spoken = announced
    ? words.achievements.eventAnnounced(
        dayLong(season.windowFrom, data.today, words.lang),
      )
    : words.achievements.eventUntil(
        dayLong(season.windowUntil, data.today, words.lang),
      );
  return {
    seasonId: season.id,
    title,
    when,
    // A preview in shelf order, as the season card's.
    medals: shelfOrdered(familiesOf(data, scope), data).map((series) =>
      medalVm(series, data, ctx, {
        titled: false,
        captioned: false,
        meter: false,
      }),
    ),
    count,
    accessibleName: [title, count, spoken]
      .filter((part): part is string => part !== null)
      .join(', '),
  };
}

/** The ended seasons and events the client took part in, newest first. */
function archivedSeasons(data: AchievementsData): readonly Season[] {
  return LoyaltyCatalogSystem.seasonsIn(
    data.catalog,
    SeasonPhase.Ended,
    cardDayOf(data.today),
  ).filter(
    (season) =>
      data.seasonProgress.has(season.id) ||
      SeasonSystem.familyIds(season).some((id) => data.progress.has(id)),
  );
}

export function archiveRowOf(
  data: AchievementsData,
  ctx: AchievementsContext,
): ArchiveRowVm | null {
  const count = archivedSeasons(data).length;
  if (count === 0) return null;
  const text = figure(count, ctx.words.lang);
  return {
    count: text,
    accessibleName: `${ctx.words.achievements.archive}, ${text}`,
  };
}

// ── A scope ─────────────────────────────────────────────────────────────

/** The scope's title — the page's `h2` and the bar's compact title; `null` for a scope the catalogue lacks. */
export function scopeTitleOf(
  data: AchievementsData,
  scope: AchievementScope,
  words: ClientCardWords,
): string | null {
  const locale = cardLocaleOf(words.lang);
  switch (scope.kind) {
    case 'category':
      return (
        LoyaltyCatalogSystem.category(
          data.catalog,
          BadgeCategoryId.of(scope.categoryId),
        )?.title[locale] ?? null
      );
    case 'season':
      return (
        LoyaltyCatalogSystem.season(data.catalog, SeasonId.of(scope.seasonId))
          ?.title[locale] ?? null
      );
    case 'archive':
      return words.achievements.archive;
    case 'day':
      return words.achievements.dayTitle(
        dayShort(scope.day, data.today, words.lang),
      );
  }
}

function sectionOf(
  key: string,
  title: string | null,
  families: readonly BadgeSeries[],
  data: AchievementsData,
  ctx: AchievementsContext,
  counted: boolean,
): ScopeSectionVm {
  // Earned, the filled discs under it: «Общи · 1 от 1» over a hollow ring
  // read as earned (wave D r6).
  const earned = families.filter(
    (s) => standingOf(s, data).medalState === MedalState.Earned,
  ).length;
  return {
    key,
    title,
    detail: counted
      ? ctx.words.achievements.familyCount(earned, families.length)
      : null,
    tiles: shelfOrdered(families, data).map((series) =>
      familyTile(series, data, ctx),
    ),
  };
}

/**
 * A category's sections, by what its families are about: mastery by the
 * service's category («Коса», «Брада»), then «Общи»; barbers and shops as
 * «Бръснари», «Салони», «Общи»; any other shelf one unlabelled grid.
 */
function categorySections(
  kind: BadgeCategoryKind,
  categoryId: string,
  families: readonly BadgeSeries[],
  data: AchievementsData,
  ctx: AchievementsContext,
): readonly ScopeSectionVm[] {
  const words = ctx.words.achievements;
  const groups = new Map<string, { title: string; families: BadgeSeries[] }>();
  const add = (key: string, title: string, series: BadgeSeries) => {
    const group = groups.get(key);
    if (group) group.families.push(series);
    else groups.set(key, { title, families: [series] });
  };
  if (kind === BadgeCategoryKind.Mastery) {
    const general: BadgeSeries[] = [];
    for (const series of families) {
      const category =
        series.badgeSubject === BadgeSubject.Service
          ? ctx.catalog.serviceCategory(series.subjectServiceId)
          : null;
      if (category === null) general.push(series);
      else add(category.id, category.name, series);
    }
    for (const series of general) add('general', words.sectionGeneral, series);
  } else if (kind === BadgeCategoryKind.Barbers) {
    const ordered = [
      ...families.filter((s) => s.badgeSubject === BadgeSubject.Barber),
      ...families.filter((s) => s.badgeSubject === BadgeSubject.Location),
      ...families.filter(
        (s) =>
          s.badgeSubject === null || s.badgeSubject === BadgeSubject.Service,
      ),
    ];
    for (const series of ordered) {
      if (series.badgeSubject === BadgeSubject.Barber) {
        add('barbers', words.sectionBarbers, series);
      } else if (series.badgeSubject === BadgeSubject.Location) {
        add('shops', words.sectionShops, series);
      } else {
        add('general', words.sectionGeneral, series);
      }
    }
  } else {
    return [sectionOf(categoryId, null, families, data, ctx, false)];
  }
  return [...groups.entries()].map(([key, group]) =>
    sectionOf(key, group.title, group.families, data, ctx, true),
  );
}

/** An archived season or event as a tile that opens its own scope. */
function archivedSeasonTile(
  season: Season,
  data: AchievementsData,
  ctx: AchievementsContext,
): AchievementTileVm {
  const words = ctx.words;
  const locale = localeOf(ctx);
  const title = season.title[locale];
  const range = dayRange(
    season.windowFrom,
    season.windowUntil,
    data.today,
    words.lang,
  );
  const track =
    season.trackSeriesId === null
      ? null
      : LoyaltyCatalogSystem.series(data.catalog, season.trackSeriesId);
  const opens: AchievementScope = { kind: 'season', seasonId: season.id };
  if (track !== null) {
    return {
      key: season.id,
      medal: medalVm(track, data, ctx, {
        title,
        caption: range,
        meter: false,
      }),
      opens,
    };
  }
  const counts = familyCountsOf(data, FamilyScopeFilter.season(season.id));
  const familyCount = words.achievements.familyCount(
    counts.earned,
    counts.total,
  );
  return {
    key: season.id,
    medal: {
      seriesId: season.id,
      state:
        counts.earned > 0
          ? 'earned'
          : counts.started > 0
            ? 'inProgress'
            : 'notStarted',
      icon: BADGE_EMBLEM_ICONS[season.emblem],
      src: null,
      monogram: null,
      level: null,
      title,
      caption: range,
      value: null,
      valueText: null,
      isNew: false,
      accessibleName: `${title}, ${familyCount}, ${range}`,
    },
    opens,
  };
}

/** One scope page (§3.4): a category, a season, the archive or a day; `null` for a scope the catalogue lacks. */
export function scopePageVm(
  data: AchievementsData,
  scope: AchievementScope,
  ctx: AchievementsContext,
): ScopePageVm | null {
  const words = ctx.words;
  const title = scopeTitleOf(data, scope, words);
  if (title === null) return null;
  switch (scope.kind) {
    case 'category': {
      const category = LoyaltyCatalogSystem.category(
        data.catalog,
        BadgeCategoryId.of(scope.categoryId),
      );
      if (category === null) return null;
      const filter = familyScopeOf(scope);
      const families = familiesOf(data, filter);
      const counts = familyCountsOf(data, filter);
      return {
        title,
        subline: words.achievements.scopeSubline(
          ctx.subjectName,
          counts.started,
          counts.total,
        ),
        track: null,
        ended: null,
        sections: categorySections(
          category.badgeCategoryKind,
          scope.categoryId,
          families,
          data,
          ctx,
        ),
      };
    }
    case 'season': {
      const season = LoyaltyCatalogSystem.season(
        data.catalog,
        SeasonId.of(scope.seasonId),
      );
      if (season === null) return null;
      const ended = seasonPhaseOf(season, data) === SeasonPhase.Ended;
      const families = familiesOf(data, familyScopeOf(scope)).filter(
        (s) => !ended || standingOf(s, data).medalState === MedalState.Earned,
      );
      return {
        title,
        subline: dayRange(
          season.windowFrom,
          season.windowUntil,
          data.today,
          words.lang,
        ),
        track: seasonTrack(season, data, ctx),
        // CF — that it closed, once: the subline above holds the dates, and
        // the rim and the track's ringed node the level it closed on (the
        // level stays in the track's value text, for a reader).
        ended: ended ? words.achievements.seasonEnded : null,
        sections:
          families.length === 0
            ? []
            : [sectionOf(season.id, null, families, data, ctx, false)],
      };
    }
    case 'archive': {
      const byYear = new Map<string, Season[]>();
      for (const season of archivedSeasons(data)) {
        const year = season.windowUntil.slice(0, 4);
        byYear.set(year, [...(byYear.get(year) ?? []), season]);
      }
      return {
        title,
        subline: ctx.subjectName,
        track: null,
        ended: null,
        sections: [...byYear.entries()]
          .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
          .map(([year, seasons]) => ({
            key: year,
            title: year,
            detail: null,
            tiles: seasons.map((season) =>
              archivedSeasonTile(season, data, ctx),
            ),
          })),
      };
    }
    case 'day': {
      const families = familiesOf(data, familyScopeOf(scope));
      return {
        title,
        subline: ctx.subjectName,
        track: null,
        ended: null,
        sections:
          families.length === 0
            ? []
            : [sectionOf(scope.day, null, families, data, ctx, false)],
      };
    }
  }
}

/** DE — the family's neighbours on its shelf or in its season; a tap replaces the detail. */
export function relatedOf(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
): DetailRelatedVm | null {
  const locale = localeOf(ctx);
  let scopeTitle: string | null = null;
  let icon: UiIconName | null = null;
  let neighbours: readonly BadgeSeries[] = [];
  if (series.categoryId !== null) {
    const category = LoyaltyCatalogSystem.category(
      data.catalog,
      series.categoryId,
    );
    if (category !== null) {
      scopeTitle = category.title[locale];
      icon = BADGE_CATEGORY_ICONS[category.badgeCategoryKind];
      neighbours = familiesOf(data, FamilyScopeFilter.category(category.id));
    }
  } else if (series.seasonId !== null) {
    const season = LoyaltyCatalogSystem.season(data.catalog, series.seasonId);
    if (season !== null) {
      scopeTitle = season.title[locale];
      icon =
        season.seasonKind === SeasonKind.Event
          ? 'loyalty.event'
          : 'loyalty.season';
      // An ended season lists only what was earned (CF), as its scope page
      // does; the tiles then carry no meter and no target (`medalVm`).
      const ended = seasonPhaseOf(season, data) === SeasonPhase.Ended;
      neighbours = SeasonSystem.familyIds(season)
        .map((id) => LoyaltyCatalogSystem.series(data.catalog, id))
        .filter(
          (s): s is BadgeSeries =>
            s !== null &&
            (!BadgeSystem.isRetired(s) || data.progress.has(s.id)) &&
            (!ended || standingOf(s, data).medalState === MedalState.Earned),
        );
    }
  }
  const tiles = shelfOrdered(
    neighbours.filter((s) => s.id !== series.id),
    data,
  )
    .slice(0, RAIL_LIMIT)
    .map((s) => familyTile(s, data, ctx));
  if (scopeTitle === null || tiles.length === 0) return null;
  return { title: ctx.words.achievement.more(scopeTitle), icon, tiles };
}
