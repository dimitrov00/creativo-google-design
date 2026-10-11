import {
  LocalDate,
  type PersonalRecord as SystemRecord,
  PersonalRecordKind as SystemRecordKind,
  RecordsSystem,
  ServiceId as ServiceRefId,
  defect,
} from '@creativo/ecs-core';
import {
  type BadgeCategory,
  type BadgeProgress,
  type BadgeSeries,
  type PersonalRecord,
  type PersonalRecordKind,
  type Season,
  type SeriesStanding,
  closestLevels,
  earnedLevelCount,
  familiesIn,
  levelNumeral,
  sofiaDayOf,
} from '@creativo/application/engagement';
import type { UiIconName, UiMedalControlSize } from '@creativo/ui/controls';
import {
  type AchievementsContext,
  PENDING_RING,
  archiveRowOf,
  completesWithThisVisit,
  earnedAtOf,
  eventCardVm,
  isSingleLevel,
  latestEarned,
  localeOf,
  medalVm,
  progressOf,
  scopePageVm,
  seasonCardVm,
  shelfOrdered,
} from './achievements.presenter';
import type { AchievementScope } from './client-card.contracts';
import {
  dayLong,
  dayShort,
  figure,
  monthYearLong,
  runningCase,
  yearAlone,
} from './client-card.format';
import type {
  AchievementChipVm,
  AchievementsData,
  AchievementTileVm,
  CollectionVm,
  EventCardVm,
  MedalSectionVm,
  MedalsPageVm,
  MedalVm,
  RecordCardVm,
  ScopePageVm,
  SeasonCardVm,
  SeasonTrackVm,
} from './client-pages.vm';

/*
 * «ПОСТИЖЕНИЯ», REVISION 3 (client-card-revision-3 §2.3, §3.8): the
 * records first, the category chips, then grids — never a rail — of
 * medals that wear a RING. Pure functions of the store's
 * `AchievementsData` and the page's context, beside the built presenter
 * and over it: the domain still decides standing, the built file still
 * words a family (`medalVm`), and this file only draws the ring round it
 * and lays the page out.
 *
 * What the ring adds to a built medal:
 *
 * - THE FOURTH STATE. A family with every level won — a ladder climbed to
 *   its top, a single act done — is `complete`: a full ring.
 * - THE ARC. From the last threshold won to the next, not from zero:
 *   «Фейд» at 23 with II = 10 and III = 25 draws 13 of 15.
 * - THE RIM. The numeral is the highest level won; a single act («Добре
 *   дошъл») has no ladder for a rim to count, and wears none.
 */

// ── The rhythm, on or off ───────────────────────────────────────────────

/**
 * Whether the shop runs a rhythm today: a rule of the catalogue is in
 * force and switched on. Off, the rhythm's families that were never
 * earned and the record of the longest run leave the page (§2.3.5): what
 * nobody can earn is not offered.
 */
export function rhythmLiveOf(data: AchievementsData): boolean {
  return data.catalog.streakSchedules.some(
    (schedule) => schedule.inForceOn(data.today).enabled,
  );
}

/** What a page may know beyond its data: a flag the store read. */
export interface MedalsOptions {
  /**
   * `false` hides the rhythm as a rule that is off does (§2.3.5): the
   * caller's `loyalty.streaks` flag. Unset, the catalogue's own rule
   * decides ({@link rhythmLiveOf}); `true` never switches on a rule that
   * is off.
   */
  readonly rhythm?: boolean;
}

function rhythmShown(data: AchievementsData, options: MedalsOptions): boolean {
  return (options.rhythm ?? true) && rhythmLiveOf(data);
}

// ── One medal in its ring ───────────────────────────────────────────────

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * The ring's arc, 0 … 1 from the last threshold won to the next (§3.8).
 * `null` where there is no next threshold to draw towards: a single act,
 * a family with every level won. A windowed count that fell under the
 * level it once reached draws an empty arc, never a negative one.
 */
export function ringValueOf(
  series: BadgeSeries,
  standing: SeriesStanding,
): number | null {
  if (standing.next === null || standing.target === null) return null;
  const from = series.levelAt(standing.highestLevel)?.target ?? 0;
  const span = standing.target - from;
  return span > 0 ? clamp01((standing.value - from) / span) : null;
}

/** «23/25»: a target without its level, where a tile has no room for «до III». */
function fraction(value: number, target: number, lang: string): string {
  return `${figure(value, lang)}/${figure(target, lang)}`;
}

/** Where a ring is drawn decides what stands under it. */
interface RingOptions {
  /** «Ново» on a level earned since the previous visit: a category's grid only, one place per page. */
  readonly markNew?: boolean;
}

function ringOf(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
  size: UiMedalControlSize,
  options: RingOptions = {},
): MedalVm {
  const words = ctx.words;
  const lang = words.lang;
  // The medal alone is the face of its own page: its title is the page's.
  const worded = size !== 'extraLarge';
  const built = medalVm(series, data, ctx, {
    titled: worded,
    captioned: worded,
    markNew: options.markNew ?? false,
  });
  const progress: BadgeProgress | null = progressOf(data, series);
  const standing = series.standing(progress);
  const pending = completesWithThisVisit(series, data, ctx);
  const complete = standing.state === 'earned' && standing.next === null;
  // A family of ONE level — a single act, or one counted threshold («Есенно
  // утро», «И двата салона») — has no ladder for a rim to count: earning it
  // is the whole family, so it wears no numeral and no «ниво I» is heard;
  // the same predicate words it by its day below (review 3, round 2: a
  // completed single-level family mixed the one-off's date with a rim chip).
  const single = isSingleLevel(series);
  const last = latestEarned(progress);

  // A regular tile is 53–71 wide: «2/3», never «2/3 до I».
  const toLevel =
    standing.next !== null && standing.target !== null
      ? words.achievements.toLevel(
          standing.value,
          standing.target,
          levelNumeral(standing.next.level),
        )
      : null;
  const caption =
    size === 'regular' &&
    built.caption !== null &&
    built.caption === toLevel &&
    standing.target !== null
      ? fraction(standing.value, standing.target, lang)
      : built.caption;

  const earnedAt = earnedAtOf(progress, standing.highestLevel);
  const accessibleName =
    single && standing.state === 'earned' && earnedAt !== null
      ? `${series.title.get(localeOf(ctx))}${words.achievement.earnedOn(
          dayLong(sofiaDayOf(earnedAt), data.today, lang),
        )}${built.isNew ? words.achievement.newSuffix : ''}${
          pending ? `, ${words.achievements.withThisVisit}` : ''
        }`
      : built.accessibleName;

  if (complete) {
    return {
      ...built,
      state: 'complete',
      level: single ? null : built.level,
      caption,
      value: 1,
      // One level earned is a single act's words, its day (`stateLineOf`).
      valueText: pending
        ? built.valueText
        : single && last !== null
          ? words.achievement.oneOffEarned(
              dayShort(sofiaDayOf(last.earnedAt), data.today, lang),
            )
          : words.achievements.complete,
      accessibleName,
    };
  }
  return {
    ...built,
    level: single ? null : built.level,
    caption,
    // The built meter ran from zero; the ring runs from the level won. A
    // level this visit completes stands where the visit takes it: all but
    // closed — the closed ring is `complete`'s alone (review 3, F8).
    value:
      built.value === null
        ? null
        : pending
          ? PENDING_RING
          : (ringValueOf(series, standing) ?? built.value),
    accessibleName,
  };
}

/**
 * One family as `ui-medal` draws it in revision 3 (§3.8): the built
 * medal, its ring and the fourth state.
 *
 * `size` is the DS's, and says how much stands under the ring:
 * `extraLarge` is the medal alone (a detail's stage: no title, no
 * caption); `large` a grid's tile, titled and captioned in full («23/25
 * до III»); `regular` a card's family, titled and captioned short
 * («2/3»). A caller that wants less blanks it (`{ ...medal, caption: null }`).
 */
export function medalRingVm(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
  size: UiMedalControlSize,
): MedalVm {
  return ringOf(series, data, ctx, size);
}

/** A family as a tile of a grid; a tap opens its detail. */
function ringTile(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
  options: RingOptions = {},
): AchievementTileVm {
  return {
    key: series.id.value,
    medal: ringOf(series, data, ctx, 'large', options),
    opens: null,
  };
}

// ── Records (AE) ────────────────────────────────────────────────────────

/** A record's emblem; closed, so a kind the account gains does not compile without one. */
export const RECORD_ICONS: Readonly<Record<PersonalRecordKind, UiIconName>> = {
  longestRhythm: 'loyalty.record.longestRhythm',
  mostVisitsInYear: 'loyalty.record.mostVisitsInYear',
  favouriteService: 'loyalty.record.favouriteService',
  firstVisit: 'loyalty.record.firstVisit',
};

/** The cards' order, the account's own (`PERSONAL_RECORD_KINDS`). */
export const RECORD_ORDER: readonly PersonalRecordKind[] = [
  'longestRhythm',
  'mostVisitsInYear',
  'favouriteService',
  'firstVisit',
];

/** How long a record is «Нов рекорд»: set within this many days of the shop's today. */
export const NEW_RECORD_DAYS = 30;

/**
 * The day a record was set, for «Нов рекорд» and for the newest one: the
 * run's last visit, the record year's last day — today while that year
 * still runs, a record being set now — the first visit's day. A favourite
 * is a sum over the whole book: it has no day, `null`.
 */
export function recordSetOn(
  record: PersonalRecord,
  today: string,
): string | null {
  return RecordsSystem.setOn(recordOf(record), dayOf(today));
}

/**
 * «Нов рекорд»: set in the last {@link NEW_RECORD_DAYS} days of the shop's
 * today (§4.8). A best that was beaten, so never the first visit (a first
 * is not a record anyone broke), never a favourite (no day), and never the
 * year still running: its figure grows with every visit and is no news
 * until the year closes on it.
 */
export function isNewRecord(record: PersonalRecord, today: string): boolean {
  return RecordsSystem.isNew(recordOf(record), dayOf(today));
}

/**
 * AE — one record of the account as a card of the 2 × 2: its label, the
 * figure, one quiet detail. `null` for a record that holds nothing to
 * print: a count of zero, a year or a day the account never stamped, a
 * service the catalogue no longer knows.
 *
 * A favourite's figure is the SERVICE and its detail the count; its
 * emblem is the service's cover where the catalogue has one.
 */
export function recordCardVm(
  record: PersonalRecord,
  data: AchievementsData,
  ctx: AchievementsContext,
): RecordCardVm | null {
  const words = ctx.words;
  const lang = words.lang;
  let value: string;
  let detail: string | null;
  let spoken: string;
  let src: string | null = null;
  switch (record.kind) {
    case 'longestRhythm':
      if (record.value <= 0) return null;
      value = figure(record.value, lang);
      detail = record.on === null ? null : monthYearLong(record.on, lang);
      spoken = words.visitsModule.sectionVisits(record.value);
      break;
    case 'mostVisitsInYear':
      if (record.value <= 0 || record.year === null) return null;
      value = figure(record.value, lang);
      detail = words.records.yearValue(String(record.year));
      spoken = words.visitsModule.sectionVisits(record.value);
      break;
    case 'favouriteService': {
      const name =
        record.serviceId === null
          ? null
          : ctx.catalog.serviceName(record.serviceId);
      if (record.value <= 0 || record.serviceId === null || name === null) {
        return null;
      }
      value = name;
      detail = words.records.times(record.value);
      spoken = name;
      src = ctx.catalog.serviceCoverSrc(record.serviceId);
      break;
    }
    case 'firstVisit':
      if (record.on === null) return null;
      // The day and its month as the figure, the year as the detail: the
      // day is read against itself, so no year rides on the figure.
      value = dayLong(record.on, record.on, lang);
      detail = yearAlone(record.on, lang);
      spoken = value;
      break;
  }
  const label = words.records.label(record.kind);
  const isNew = isNewRecord(record, data.today);
  return {
    id: record.kind,
    kind: record.kind,
    label,
    value,
    detail,
    icon: RECORD_ICONS[record.kind],
    src,
    isNew,
    accessibleName: words.achievements.recordName(label, spoken, detail, isNew),
  };
}

/** The account's records in the cards' order; the longest run only while the shop runs a rhythm. */
export function recordsOf(
  data: AchievementsData,
  rhythm: boolean,
): readonly PersonalRecord[] {
  return RecordsSystem.ordered(
    data.account.records.map((record) => ({
      ...recordOf(record),
      source: record,
    })),
    rhythm,
  ).map((ref) => ref.source);
}

// ── The families the page draws ─────────────────────────────────────────

/**
 * A category's families as the page draws them: the domain's list (a
 * retired family only where the client started it), and, while the shop
 * runs no rhythm, the rhythm's shelf cut to what was already earned
 * (§2.3.5): a level won is never taken back, a level nobody can win is
 * not offered.
 */
function categoryFamilies(
  category: BadgeCategory,
  data: AchievementsData,
  rhythm: boolean,
): readonly BadgeSeries[] {
  const families = familiesIn(
    data.catalog,
    data.progress,
    { kind: 'category', categoryId: category.id.value },
    data.today,
  );
  return category.kind === 'rhythm' && !rhythm
    ? families.filter(
        (series) =>
          series.standing(progressOf(data, series)).state === 'earned',
      )
    : families;
}

function earnedAmong(
  families: readonly BadgeSeries[],
  data: AchievementsData,
): number {
  return families.filter(
    (series) => series.standing(progressOf(data, series)).state === 'earned',
  ).length;
}

/** The categories that draw a section, in the catalogue's order, each with its families. */
function shelvesOf(
  data: AchievementsData,
  rhythm: boolean,
): readonly {
  readonly category: BadgeCategory;
  readonly families: readonly BadgeSeries[];
}[] {
  return data.catalog.categories.flatMap((category) => {
    if (category.holdsRecords()) return [];
    const families = categoryFamilies(category, data, rhythm);
    return families.length === 0 ? [] : [{ category, families }];
  });
}

/** The seasons and events the page shows today: the running ones, then the announced. */
function windowsOf(data: AchievementsData): {
  readonly season: Season | null;
  readonly events: readonly Season[];
} {
  const open = data.catalog.seasonsIn('open', data.today);
  return {
    season: open.find((s) => s.kind === 'season') ?? null,
    events: [
      ...open.filter((s) => s.kind === 'event'),
      ...data.catalog
        .seasonsIn('announced', data.today)
        .filter((s) => s.kind === 'event'),
    ],
  };
}

/** A window's medals: its track, then its own families (a retired one only where started). */
function windowFamilies(
  season: Season,
  data: AchievementsData,
): readonly BadgeSeries[] {
  const track =
    season.trackSeriesId === null
      ? null
      : data.catalog.series(season.trackSeriesId.value);
  return [
    ...(track === null ? [] : [track]),
    ...familiesIn(
      data.catalog,
      data.progress,
      { kind: 'season', seasonId: season.id.value },
      data.today,
    ),
  ];
}

// ── Sections, chips, the collection ─────────────────────────────────────

/** More families than this, and a category folds to two rows and «Покажи всички N» (AM). */
export const SECTION_FOLD_OVER = 9;

/** The rows a folded category keeps on the overview. */
export const SECTION_FOLDED_ROWS = 2;

/**
 * How many of a section's tiles the overview draws on `columns` columns:
 * all of them, or a folded category's first two rows. The tiles are in
 * shelf order, so what a fold keeps is what was earned, then what is
 * nearest.
 */
export function sectionTilesShown(
  section: Pick<MedalSectionVm, 'tiles' | 'folded'>,
  columns: number,
): number {
  return section.folded === null
    ? section.tiles.length
    : Math.min(
        section.tiles.length,
        SECTION_FOLDED_ROWS * Math.max(1, Math.floor(columns)),
      );
}

function sectionOf(
  category: BadgeCategory,
  families: readonly BadgeSeries[],
  data: AchievementsData,
  ctx: AchievementsContext,
  whole: boolean,
): MedalSectionVm {
  return {
    categoryId: category.id.value,
    title: category.title.get(localeOf(ctx)),
    count: ctx.words.achievements.familyCount(
      earnedAmong(families, data),
      families.length,
    ),
    tiles: shelfOrdered(families, data).map((series) =>
      ringTile(series, data, ctx, { markNew: true }),
    ),
    folded:
      !whole && families.length > SECTION_FOLD_OVER ? families.length : null,
  };
}

/** The chip «Всички»: the page's overview. */
export const CHIP_ALL = 'all';

/** The chip «Сезони»: the running season, the events, the archive. */
export const CHIP_SEASONS = 'seasons';

/**
 * A chip's word. The shelf «Бръснари и салони» is the chip «Бръснари»:
 * seven chips wrap to two rows at 390 only with the short word, and the
 * section under it keeps the whole title (§2.3.2).
 */
function chipLabel(category: BadgeCategory, ctx: AchievementsContext): string {
  return category.kind === 'barbers'
    ? ctx.words.achievements.sectionBarbers
    : category.title.get(localeOf(ctx));
}

/**
 * AK — the collection: the families with a level earned, of the families
 * the page can show today. The ring's centre is ONE number; the levels
 * under it count every level ever earned, an ended season's too.
 */
function collectionOf(
  families: readonly BadgeSeries[],
  data: AchievementsData,
  ctx: AchievementsContext,
): CollectionVm {
  const words = ctx.words.achievements;
  const earned = earnedAmong(families, data);
  const total = families.length;
  const levels = earnedLevelCount(data.progress);
  const name = words.collectionName(earned, total, levels);
  return {
    ring: {
      value: earned,
      min: 0,
      max: Math.max(1, total),
      marks: [],
      label: words.title,
      valueText: name,
    },
    figure: figure(earned, ctx.words.lang),
    line: words.collectionOf(total),
    levels: words.summaryName(levels),
    accessibleName: name,
  };
}

// ── The season and the events, re-dressed ───────────────────────────────

/**
 * AG — the running season on the overview: its medal in its ring, ONE
 * sentence, and ALL its families as regular medals, named and captioned.
 * The medal keeps its rim numeral here: the I–V ladder is the season
 * page's, so nothing beside it prints the level a second time.
 */
function seasonOf(
  season: Season,
  data: AchievementsData,
  ctx: AchievementsContext,
): SeasonCardVm | null {
  const built = seasonCardVm(season, data, ctx);
  const track =
    season.trackSeriesId === null
      ? null
      : data.catalog.series(season.trackSeriesId.value);
  if (built === null || track === null) return null;
  const words = ctx.words;
  const standing = track.standing(progressOf(data, track));
  const pending = completesWithThisVisit(track, data, ctx);
  // «Ниво II · още 2 посещения до III»: the level won, then the way on.
  // The words that already open on the level («Ниво III с това
  // посещение») and a finished track («Всички нива») stand as they are.
  const sentence =
    built.sentence !== null &&
    standing.highestLevel > 0 &&
    standing.next !== null &&
    !pending
      ? words.achievement.levelRow(
          levelNumeral(standing.highestLevel),
          runningCase(built.sentence, words.lang),
        )
      : built.sentence;
  return {
    ...built,
    medal: {
      ...ringOf(track, data, ctx, 'large'),
      title: null,
      caption: null,
    },
    sentence,
    families: shelfOrdered(
      familiesIn(
        data.catalog,
        data.progress,
        { kind: 'season', seasonId: season.id.value },
        data.today,
      ),
      data,
    ).map((series) => ringOf(series, data, ctx, 'regular')),
  };
}

/** AH — an event on the overview: all its families as regular medals, named and captioned. */
function eventOf(
  season: Season,
  data: AchievementsData,
  ctx: AchievementsContext,
): EventCardVm {
  return {
    ...eventCardVm(season, data, ctx),
    medals: shelfOrdered(
      familiesIn(
        data.catalog,
        data.progress,
        { kind: 'season', seasonId: season.id.value },
        data.today,
      ),
      data,
    ).map((series) => ringOf(series, data, ctx, 'regular')),
  };
}

// ── «Почти спечелени» (AF) ──────────────────────────────────────────────

/** AF holds one row of a phone's grid. */
export const CLOSE_LIMIT = 3;

/**
 * AF — the families nearest their next level, under the domain's
 * diversity rule (`closestLevels`: one per shelf, the most specific of
 * the ones a single visit completes), a medal this visit completes first.
 *
 * The single acts this visit completes lead (a birthday visit: the domain
 * ranks counted levels only). A family nobody began is not «almost»
 * anything, however short its ladder: only what is under way, or what
 * this visit completes, is offered. The running season's track is left to
 * its own card right under the row, which already says how far its next
 * level is; and while the shop runs no rhythm, no family of the rhythm's
 * shelf is offered either.
 */
function closeTiles(
  data: AchievementsData,
  ctx: AchievementsContext,
  seasonTrackId: string | null,
  rhythm: boolean,
): readonly AchievementTileVm[] {
  const offered = (series: BadgeSeries): boolean => {
    if (series.id.value === seasonTrackId) return false;
    if (rhythm || series.categoryId === null) return true;
    return data.catalog.category(series.categoryId.value)?.kind !== 'rhythm';
  };
  const acts = data.catalog.families.filter(
    (series) =>
      series.levels.every((level) => level.target === null) &&
      completesWithThisVisit(series, data, ctx),
  );
  // Every shelf's and every season's nearest, in the domain's rank.
  const ranked = closestLevels(
    data.catalog,
    data.progress,
    data.today,
    Number.MAX_SAFE_INTEGER,
  ).flatMap((level) => {
    const series = data.catalog.series(level.seriesId);
    return series === null ? [] : [series];
  });
  const seen = new Set<string>();
  const candidates = [...acts, ...ranked].filter((series) => {
    if (seen.has(series.id.value) || !offered(series)) return false;
    seen.add(series.id.value);
    return true;
  });
  const pending = candidates.filter((series) =>
    completesWithThisVisit(series, data, ctx),
  );
  const underWay = candidates.filter(
    (series) =>
      !completesWithThisVisit(series, data, ctx) &&
      (progressOf(data, series)?.value ?? 0) > 0,
  );
  return [...pending, ...underWay]
    .slice(0, CLOSE_LIMIT)
    .map((series) => ringTile(series, data, ctx));
}

// ── The page ────────────────────────────────────────────────────────────

/**
 * «Постижения» (§2.3). The records and the chips are the page's, whatever
 * the chip; `chip` decides what stands UNDER the band:
 *
 * - `all` (and a chip the catalogue no longer has): the overview —
 *   «Почти спечелени», the season, the events, the collection, every
 *   category as a section (folded past nine families), the archive row;
 * - a category's id: that category ALONE, whole. Its sub-sections
 *   («Коса», «Брада», «Общи») are the scope page's
 *   ({@link medalScopeVm}), which the body mounts in place;
 * - `seasons`: the running season, the events and the archive row.
 *
 * The collection is counted either way: it is the page's, not a chip's.
 */
export function medalsPageVm(
  data: AchievementsData,
  ctx: AchievementsContext,
  chip: string,
  options: MedalsOptions = {},
): MedalsPageVm {
  const words = ctx.words.achievements;
  const rhythm = rhythmShown(data, options);
  const shelves = shelvesOf(data, rhythm);
  const windows = windowsOf(data);
  const season =
    windows.season === null ? null : seasonOf(windows.season, data, ctx);
  const events = windows.events.map((event) => eventOf(event, data, ctx));
  const archive = archiveRowOf(data, ctx);

  // What the page can show today: every shelf's families and the open and
  // announced windows' medals. An ended season's are the archive's.
  const seasonal = [
    ...(windows.season === null ? [] : [windows.season]),
    ...windows.events,
  ].flatMap((window) => windowFamilies(window, data));
  const published = [
    ...shelves.flatMap((shelf) => shelf.families),
    ...seasonal,
  ];
  const seasons = season !== null || events.length > 0 || archive !== null;

  const chips: AchievementChipVm[] = [
    {
      id: CHIP_ALL,
      label: ctx.words.loyalty.all,
      accessibleName: words.chipName(
        ctx.words.loyalty.all,
        earnedAmong(published, data),
        published.length,
      ),
    },
    ...shelves.map(({ category, families }) => ({
      id: category.id.value,
      label: chipLabel(category, ctx),
      accessibleName: words.chipName(
        category.title.get(localeOf(ctx)),
        earnedAmong(families, data),
        families.length,
      ),
    })),
    ...(seasons
      ? [
          {
            id: CHIP_SEASONS,
            label: words.chipSeasons,
            accessibleName:
              seasonal.length === 0
                ? words.chipSeasons
                : words.chipName(
                    words.chipSeasons,
                    earnedAmong(seasonal, data),
                    seasonal.length,
                  ),
          },
        ]
      : []),
  ];
  const chosen = chips.some((c) => c.id === chip) ? chip : CHIP_ALL;
  const overview = chosen === CHIP_ALL;
  const windowsShown = overview || chosen === CHIP_SEASONS;

  const underWay = [...data.progress.values()].some(
    (progress) => progress.value > 0 || progress.earned.length > 0,
  );

  return {
    records: recordsOf(data, rhythm).flatMap((record) => {
      const card = recordCardVm(record, data, ctx);
      return card === null ? [] : [card];
    }),
    chips,
    close: overview
      ? closeTiles(data, ctx, season?.medal.seriesId ?? null, rhythm)
      : [],
    season: windowsShown ? season : null,
    events: windowsShown ? events : [],
    collection: collectionOf(published, data, ctx),
    sections: shelves
      .filter(({ category }) => overview || category.id.value === chosen)
      .map(({ category, families }) =>
        sectionOf(category, families, data, ctx, !overview),
      ),
    archive: windowsShown ? archive : null,
    emptyHint: overview && !underWay ? words.firstHint : null,
  };
}

// ── A scope, in rings ───────────────────────────────────────────────────

/** A scope's track: the season's medal in its ring, beside the steps that print its level. */
function trackInRing(
  track: SeasonTrackVm,
  data: AchievementsData,
  ctx: AchievementsContext,
): SeasonTrackVm {
  const series = data.catalog.series(track.medal.seriesId);
  if (series === null) return track;
  const ring = ringOf(series, data, ctx, 'large');
  return {
    ...track,
    medal: {
      ...ring,
      title: null,
      caption: null,
      // The rim is empty while the steps print the level (`seasonTrack`).
      level: track.medal.level === null ? null : ring.level,
    },
  };
}

/**
 * One scope page in rings (§2.3.3): the built page (`scopePageVm`: the
 * same sections, the same order, the same words), every medal drawn by
 * {@link medalRingVm}. The chosen chip's body, mounted in place, and the
 * pushed scopes — a season, the archive, a day — read it alike, so a
 * family never changes ring between the overview and its category.
 *
 * A CATEGORY's quiet line counts what was EARNED («Майсторство · 3 от 9
 * спечелени»), the figure its chip and its section print; its grid marks
 * a level earned since the previous visit «Ново», as its section does.
 * `null` for a scope the catalogue lacks, and for a category the page
 * does not draw (the rhythm's shelf with nothing earned, the rule off).
 */
export function medalScopeVm(
  data: AchievementsData,
  scope: AchievementScope,
  ctx: AchievementsContext,
  options: MedalsOptions = {},
): ScopePageVm | null {
  const built = scopePageVm(data, scope, ctx);
  if (built === null) return null;
  const rhythm = rhythmShown(data, options);
  const category =
    scope.kind === 'category' ? data.catalog.category(scope.categoryId) : null;
  const drawn =
    category === null ? null : categoryFamilies(category, data, rhythm);
  if (drawn !== null && drawn.length === 0) return null;
  const kept = drawn === null ? null : new Set(drawn.map((s) => s.id.value));

  const tileInRing = (tile: AchievementTileVm): AchievementTileVm => {
    const series = data.catalog.series(tile.medal.seriesId);
    if (series === null) return tile;
    if (tile.opens === null) {
      return ringTile(series, data, ctx, { markNew: category !== null });
    }
    // An archived season's tile: its track, under the season's own name
    // and dates.
    return {
      ...tile,
      medal: {
        ...ringOf(series, data, ctx, 'large'),
        title: tile.medal.title,
        caption: tile.medal.caption,
        accessibleName: tile.medal.accessibleName,
      },
    };
  };

  const sections = built.sections.flatMap((section) => {
    const tiles = section.tiles.filter(
      (tile) => kept === null || kept.has(tile.medal.seriesId),
    );
    if (tiles.length === 0) return [];
    return [
      {
        ...section,
        detail:
          section.detail === null
            ? null
            : ctx.words.achievements.familyCount(
                tiles.filter(
                  (tile) =>
                    tile.medal.state === 'earned' ||
                    tile.medal.state === 'complete',
                ).length,
                tiles.length,
              ),
        tiles: tiles.map(tileInRing),
      },
    ];
  });

  return {
    ...built,
    subline:
      category === null || drawn === null
        ? built.subline
        : ctx.words.achievements.categorySummary(
            category.title.get(localeOf(ctx)),
            earnedAmong(drawn, data),
            drawn.length,
          ),
    track: built.track === null ? null : trackInRing(built.track, data, ctx),
    sections,
  };
}

// ── The bridge: legacy record → ecs-core struct (Phase 4 deletes it) ─────

/** A record's kind, in the system's words. */
const RECORD_KIND = {
  longestRhythm: SystemRecordKind.LongestRhythm,
  mostVisitsInYear: SystemRecordKind.MostVisitsInYear,
  favouriteService: SystemRecordKind.FavouriteService,
  firstVisit: SystemRecordKind.FirstVisit,
} as const satisfies Record<PersonalRecord['kind'], SystemRecordKind>;

/** A shop day the card holds: a guarded document day, a clock's «today». */
function dayOf(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/** A personal record as `RecordsSystem` reads it: the same figures, the kind the dictionary's, days and ids as brands. */
function recordOf(record: PersonalRecord): SystemRecord {
  return {
    personalRecordKind: RECORD_KIND[record.kind],
    value: record.value,
    on: record.on === null ? null : dayOf(record.on),
    year: record.year,
    serviceId:
      record.serviceId === null ? null : ServiceRefId.of(record.serviceId),
  };
}
