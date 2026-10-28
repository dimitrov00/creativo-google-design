import { type BadgeSeriesId, defect } from '@core/primitives';
import {
  BadgeCategoryKind,
  FamilyScopeFilter,
  MedalRingState,
  MedalState,
  type PersonalRecord,
  PersonalRecordKind,
} from '@core/components';
import type { BadgeCategory, BadgeSeries, Season } from '@core/entities';
import {
  BadgeSystem,
  LoyaltyCatalogSystem,
  RecordsSystem,
  StandingSystem,
} from '@core/systems';
import type {
  UiIconName,
  UiMedalControlSize,
  UiMedalState,
} from '@creativo/ui/controls';
import {
  type AchievementsContext,
  PENDING_RING,
  archiveRowOf,
  completesWithThisVisit,
  completingOf,
  eventCardVm,
  familiesOf,
  familyOfMedal,
  localeOf,
  medalVm,
  progressList,
  progressOf,
  scopePageVm,
  seasonCardVm,
  seriesById,
  shelfOrdered,
  standingOf,
  trackOutlookOf,
} from './achievements.presenter';
import { AchievementScope } from './client-card.contracts';
import {
  dayLong,
  dayShort,
  levelNumeral,
  monthYearLong,
  runningCase,
  yearAlone,
} from './client-card.format';
import { RECORD_KIND_WORDS, RecordKindWord } from './client-card.words';
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
import { formatCount } from '@creativo/ui/wall-clock';

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
 * nobody can earn is not offered (`LoyaltyCatalogSystem.rhythmLive`).
 */
export function rhythmLiveOf(data: AchievementsData): boolean {
  return LoyaltyCatalogSystem.rhythmLive(data.catalog, data.today, true);
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
  return LoyaltyCatalogSystem.rhythmLive(
    data.catalog,
    data.today,
    options.rhythm ?? true,
  );
}

// ── One medal in its ring ───────────────────────────────────────────────

/** A family's medal in its ring as `ui-medal` draws it: the three standings and the fourth form, `complete` (§3.8). */
export const MEDAL_RING_STATES = {
  [MedalRingState.NotStarted]: 'notStarted',
  [MedalRingState.InProgress]: 'inProgress',
  [MedalRingState.Earned]: 'earned',
  [MedalRingState.Complete]: 'complete',
} as const satisfies Record<MedalRingState, UiMedalState>;

/** «23/25»: a target without its level, where a tile has no room for «до III». */
function fraction(value: number, target: number, lang: string): string {
  return `${formatCount(value, lang)}/${formatCount(target, lang)}`;
}

/** Where a ring is drawn decides what stands under it. */
export interface RingOptions {
  /** «Ново» on a level earned since the previous visit: a category's grid only, one place per page. */
  readonly markNew?: boolean;
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
 * `options` marks «Ново» where one page shows it.
 */
export function medalRingVm(
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
  const progress = progressOf(data, series);
  const standing = BadgeSystem.standing(series, progress);
  const pending = completesWithThisVisit(series, data, ctx);
  const ring = BadgeSystem.ringState(standing, pending);
  // A family of ONE level — a single act, or one counted threshold («Есенно
  // утро», «И двата салона») — has no ladder for a rim to count: earning it
  // is the whole family, so it wears no numeral and no «ниво I» is heard;
  // the same predicate words it by its day below (review 3, round 2: a
  // completed single-level family mixed the one-off's date with a rim chip).
  const single = BadgeSystem.isSingleLevel(series);
  const last = BadgeSystem.latestEarned(progress);

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

  const earnedOn = BadgeSystem.earnedOn(progress, standing.highestLevel);
  const accessibleName =
    single && standing.medalState === MedalState.Earned && earnedOn !== null
      ? `${series.title[localeOf(ctx)]}${words.achievement.earnedOn(
          dayLong(earnedOn, data.today, lang),
        )}${built.isNew ? words.achievement.newSuffix : ''}${
          pending ? `, ${words.achievements.withThisVisit}` : ''
        }`
      : built.accessibleName;

  if (ring === MedalRingState.Complete) {
    return {
      ...built,
      state: MEDAL_RING_STATES[MedalRingState.Complete],
      level: single ? null : built.level,
      caption,
      value: 1,
      // One level earned is a single act's words, its day (`stateLineOf`).
      valueText: pending
        ? built.valueText
        : single && last !== null
          ? words.achievement.oneOffEarned(
              dayShort(last.earnedLocalDate, data.today, lang),
            )
          : words.achievements.complete,
      accessibleName,
    };
  }
  // Short of complete, a ring's state is its face's (`BadgeSystem.ringState`),
  // which the built medal already wears.
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
          : (BadgeSystem.ringFraction(series, standing) ?? built.value),
    accessibleName,
  };
}

/** A family as a tile of a grid; a tap opens its detail. */
function ringTile(
  series: BadgeSeries,
  data: AchievementsData,
  ctx: AchievementsContext,
  options: RingOptions = {},
): AchievementTileVm {
  return {
    key: series.id,
    medal: medalRingVm(series, data, ctx, 'large', options),
    opens: null,
  };
}

// ── Records (AE) ────────────────────────────────────────────────────────

/** A record's emblem, by the card's word for its kind; closed, so a kind the account gains does not compile without one. */
export const RECORD_ICONS: Readonly<Record<RecordKindWord, UiIconName>> = {
  [RecordKindWord.LongestRhythm]: 'loyalty.record.longestRhythm',
  [RecordKindWord.MostVisitsInYear]: 'loyalty.record.mostVisitsInYear',
  [RecordKindWord.FavouriteService]: 'loyalty.record.favouriteService',
  [RecordKindWord.FirstVisit]: 'loyalty.record.firstVisit',
};

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
  // What a record holds to print is the system's (`RecordsSystem.isHeld`);
  // whether the catalogue still names a favourite service is the host's.
  if (!RecordsSystem.isHeld(record)) return null;
  let value: string;
  let detail: string | null;
  let spoken: string;
  let src: string | null = null;
  switch (record.personalRecordKind) {
    case PersonalRecordKind.LongestRhythm:
      value = formatCount(record.value, lang);
      detail = record.on === null ? null : monthYearLong(record.on, lang);
      spoken = words.visitsModule.sectionVisits(record.value);
      break;
    case PersonalRecordKind.MostVisitsInYear:
      value = formatCount(record.value, lang);
      detail = words.records.yearValue(
        String(record.year ?? defect('a best year held without its year')),
      );
      spoken = words.visitsModule.sectionVisits(record.value);
      break;
    case PersonalRecordKind.FavouriteService: {
      const serviceId =
        record.serviceId ?? defect('a favourite held without its service');
      const name = ctx.catalog.serviceName(serviceId);
      if (name === null) return null;
      value = name;
      detail = words.records.times(record.value);
      spoken = name;
      src = ctx.catalog.serviceCoverSrc(serviceId);
      break;
    }
    case PersonalRecordKind.FirstVisit: {
      const on = record.on ?? defect('a first visit held without its day');
      // The day and its month as the figure, the year as the detail: the
      // day is read against itself, so no year rides on the figure.
      value = dayLong(on, on, lang);
      detail = yearAlone(on, lang);
      spoken = value;
      break;
    }
  }
  const kind = RECORD_KIND_WORDS[record.personalRecordKind];
  const label = words.records.label(kind);
  const isNew = RecordsSystem.isNew(record, data.today);
  return {
    id: kind,
    personalRecordKind: record.personalRecordKind,
    label,
    value,
    detail,
    icon: RECORD_ICONS[kind],
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
  return RecordsSystem.ordered(data.account.records, rhythm);
}

// ── The families the page draws ─────────────────────────────────────────

/** How many of `families` are earned — the filled discs a section, a chip and the collection count (`StandingSystem.earnedAmong`). */
function earnedAmong(
  families: readonly BadgeSeries[],
  data: AchievementsData,
): number {
  return StandingSystem.earnedAmong(families, progressList(data));
}

/**
 * The categories that draw a section, in the catalogue's order, each with
 * its families (`StandingSystem.shelves`): the domain's list (a retired
 * family only where the client started it), never the records' shelf,
 * and, while the shop runs no rhythm, the rhythm's shelf cut to what was
 * already earned (§2.3.5): a level won is never taken back, a level nobody
 * can win is not offered. A shelf with nothing to draw is left out.
 */
function shelvesOf(
  data: AchievementsData,
  rhythm: boolean,
): readonly {
  readonly category: BadgeCategory;
  readonly families: readonly BadgeSeries[];
}[] {
  return StandingSystem.shelves(
    data.catalog,
    progressList(data),
    data.today,
    rhythm,
  );
}

/** The seasons and events the page shows today: the running ones, then the announced (`LoyaltyCatalogSystem.windowsOn`). */
function windowsOf(data: AchievementsData): {
  readonly season: Season | null;
  readonly events: readonly Season[];
} {
  return LoyaltyCatalogSystem.windowsOn(data.catalog, data.today);
}

/** A window's medals: its track, then its own families (a retired one only where started) — `StandingSystem.windowFamilies`. */
function windowFamilies(
  season: Season,
  data: AchievementsData,
): readonly BadgeSeries[] {
  return StandingSystem.windowFamilies(
    data.catalog,
    progressList(data),
    season,
    data.today,
  );
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
    categoryId: category.id,
    title: category.title[localeOf(ctx)],
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
  return category.badgeCategoryKind === BadgeCategoryKind.Barbers
    ? ctx.words.achievements.sectionBarbers
    : category.title[localeOf(ctx)];
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
  const levels = StandingSystem.earnedLevelCount(progressList(data));
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
    figure: formatCount(earned, ctx.words.lang),
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
      : LoyaltyCatalogSystem.series(data.catalog, season.trackSeriesId);
  if (built === null || track === null) return null;
  const words = ctx.words;
  const standing = standingOf(track, data);
  // «Ниво II · още 2 посещения до III»: the level won, then the way on.
  // The words that already open on the level («Ниво III с това
  // посещение») and a finished track («Всички нива») stand as they are
  // (`SeasonSystem.trackOutlook`'s `fromLevel`).
  const sentence =
    built.sentence !== null &&
    trackOutlookOf(season, track, data, ctx).fromLevel
      ? words.achievement.levelRow(
          levelNumeral(standing.highestLevel),
          runningCase(built.sentence, words.lang),
        )
      : built.sentence;
  return {
    ...built,
    medal: {
      ...medalRingVm(track, data, ctx, 'large'),
      title: null,
      caption: null,
    },
    sentence,
    families: shelfOrdered(
      familiesOf(data, FamilyScopeFilter.season(season.id)),
      data,
    ).map((series) => medalRingVm(series, data, ctx, 'regular')),
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
      familiesOf(data, FamilyScopeFilter.season(season.id)),
      data,
    ).map((series) => medalRingVm(series, data, ctx, 'regular')),
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
  seasonTrackId: BadgeSeriesId | null,
  rhythm: boolean,
): readonly AchievementTileVm[] {
  return StandingSystem.almostEarned(
    data.catalog,
    progressList(data),
    data.today,
    {
      completing: completingOf(data, ctx),
      excludeSeriesId: seasonTrackId,
      rhythmLive: rhythm,
      limit: CLOSE_LIMIT,
    },
  ).flatMap((id) => {
    const series = seriesById(data, id);
    return series === null ? [] : [ringTile(series, data, ctx)];
  });
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
      id: category.id,
      label: chipLabel(category, ctx),
      accessibleName: words.chipName(
        category.title[localeOf(ctx)],
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

  const underWay = StandingSystem.anyUnderWay(progressList(data));

  return {
    records: recordsOf(data, rhythm).flatMap((record) => {
      const card = recordCardVm(record, data, ctx);
      return card === null ? [] : [card];
    }),
    chips,
    close: overview
      ? closeTiles(
          data,
          ctx,
          // The running season's card draws its TRACK family (`seasonOf`),
          // so the family its own card already shows is the track's.
          season === null ? null : (windows.season?.trackSeriesId ?? null),
          rhythm,
        )
      : [],
    season: windowsShown ? season : null,
    events: windowsShown ? events : [],
    collection: collectionOf(published, data, ctx),
    sections: shelves
      .filter(({ category }) => overview || category.id === chosen)
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
  const series = familyOfMedal(data, track.medal);
  if (series === null) return track;
  const ring = medalRingVm(series, data, ctx, 'large');
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
    scope.achievementScope === AchievementScope.Category
      ? LoyaltyCatalogSystem.category(data.catalog, scope.categoryId)
      : null;
  // The category's families as the page's shelves draw them; a category
  // the page draws no shelf of has none.
  const drawn =
    category === null
      ? null
      : (shelvesOf(data, rhythm).find(
          (shelf) => shelf.category.id === category.id,
        )?.families ?? []);
  if (drawn !== null && drawn.length === 0) return null;
  const kept = drawn === null ? null : new Set<string>(drawn.map((s) => s.id));

  const tileInRing = (tile: AchievementTileVm): AchievementTileVm => {
    const series = familyOfMedal(data, tile.medal);
    if (series === null) return tile;
    if (tile.opens === null) {
      return ringTile(series, data, ctx, { markNew: category !== null });
    }
    // An archived season's tile: its track, under the season's own name
    // and dates.
    return {
      ...tile,
      medal: {
        ...medalRingVm(series, data, ctx, 'large'),
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
                earnedAmong(
                  tiles.flatMap((tile) => {
                    const series = familyOfMedal(data, tile.medal);
                    return series === null ? [] : [series];
                  }),
                  data,
                ),
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
            category.title[localeOf(ctx)],
            earnedAmong(drawn, data),
            drawn.length,
          ),
    track: built.track === null ? null : trackInRing(built.track, data, ctx),
    sections,
  };
}
