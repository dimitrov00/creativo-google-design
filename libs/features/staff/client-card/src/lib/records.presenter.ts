import { firstNameOf } from '@creativo/features/shared/visits';
import type { Appointment, ClientStatsRecord } from '@core/entities';
import { LocalDate, defect } from '@core/primitives';
import {
  PersonalRecord,
  PersonalRecordKind,
  type StreakState,
} from '@core/components';
import type { StreakDefinition } from '@core/entities';
import {
  ClientStatsSystem,
  RecordsSystem,
  StreakRuleSystem,
} from '@core/systems';
import type { UiIconName } from '@creativo/ui/controls';
import type { AchievementsContext } from './achievements.presenter';
import {
  dayLong,
  dayWithYear,
  figure,
  monthYearLong,
  runningCase,
} from './client-card.format';
import type {
  AchievementsData,
  FeaturedRecordVm,
  RecordGroupVm,
  RecordRowVm,
  RecordTheme,
  RecordYearVm,
  RecordsPageVm,
} from './client-pages.vm';
import { RECORD_KIND_WORDS, type RecordRowWord } from './client-card.words';
import { rhythmStateOf } from './loyalty.presenter';
import { RECORD_ICONS, recordCardVm, recordsOf } from './medals.presenter';

/*
 * «РЕКОРДИ» (client-card-revision-3 §2.3.4, §4.8) — the page behind the
 * 2 × 2 of «Постижения»: the newest record as the page's one hero figure,
 * then the account's four records and five facts the card already reads
 * for other reasons, grouped by theme, and the years as bars.
 *
 * No new read and no new domain kind: a row's id is the card's own
 * (`RecordRowVm.id`), and everything here is a pure function of what the
 * store already holds. A row whose datum is absent is absent, a group
 * without a row is absent, and the featured record is not repeated in its
 * group: each fact once.
 */

/** What the page is computed from; the store holds every part already. */
export interface RecordsPageInput {
  readonly data: AchievementsData;
  readonly ctx: AchievementsContext;
  /** `clientStats/{customerId}`, read for the head; `null` until it answers, and for a client without one. */
  readonly stats: ClientStatsRecord | null;
  /**
   * The rhythm the account is judged by (its head); `null` with
   * `loyalty.streaks` off and in a shop without a rhythm. A rule in force
   * that is switched off is still read: the page asks it whether it is
   * `enabled`.
   */
  readonly rhythm: StreakDefinition | null;
  /** The history's loaded pages (`ClientCardStore.loadedVisits`). */
  readonly visits: readonly Appointment[];
  /** No cursor left: the loaded pages are the client's WHOLE history. */
  readonly historyComplete: boolean;
}

/** The themes in the page's order, and the rows of each in theirs (§2.3.4). */
const THEMES: readonly {
  readonly theme: RecordTheme;
  readonly rows: readonly string[];
}[] = [
  { theme: 'rhythm', rows: ['longestRhythm', 'currentRhythm'] },
  {
    theme: 'visits',
    rows: ['totalVisits', 'last12Months', 'mostVisitsInYear', 'firstVisit'],
  },
  {
    theme: 'favourites',
    rows: ['favouriteService', 'preferredBarber', 'usualServices'],
  },
];

/**
 * The glyph of a row that is not a record of the account's. The barber of
 * choice has none: a face leads his row, his initials where he has no
 * picture, as a barber is drawn everywhere.
 */
const ROW_ICONS: Readonly<
  Record<Exclude<RecordRowWord, 'preferredBarber'>, UiIconName>
> = {
  currentRhythm: 'loyalty.record.currentRhythm',
  totalVisits: 'loyalty.record.totalVisits',
  last12Months: 'loyalty.record.last12Months',
  usualServices: 'loyalty.record.usualServices',
};

/** «По години» says something from the second year on: one bar is «Общо посещения» again. */
export const YEARS_MIN = RecordsSystem.YEARS_MIN;

function themeOf(id: string): RecordTheme {
  return THEMES.find((group) => group.rows.includes(id))?.theme ?? 'visits';
}

/**
 * Whether the page draws the rhythm: the rule in force is there, and on
 * (`StreakRuleSystem.isOnOn`). No flag is read here: the store folded
 * `loyalty.streaks` into a `null` rhythm already.
 */
function rhythmOn(input: RecordsPageInput): boolean {
  return (
    input.rhythm !== null &&
    StreakRuleSystem.isOnOn(input.rhythm, dayOf(input.data.today), true)
  );
}

/** The rhythm the rule in force projects, as the account holds it. */
function rhythmOf(input: RecordsPageInput): StreakState | null {
  return rhythmOn(input)
    ? rhythmStateOf(input.data.account, input.rhythm)
    : null;
}

// ── RC · the featured record ────────────────────────────────────────────

/**
 * RC — the record set most recently, the page's ONE hero figure over what
 * it counts. A record without a day (a favourite) is the newest only
 * where no other record has one; the cards' order breaks a tie.
 *
 * A favourite's figure HERE is the count, and the service is in the words
 * under it («24» · «посещения с фейд»): the hero figure is a number.
 */
function featuredOf(
  records: readonly PersonalRecord[],
  input: RecordsPageInput,
): FeaturedRecordVm | null {
  const { data, ctx } = input;
  const words = ctx.words;
  const lang = words.lang;
  const shown = records.flatMap((record) => {
    const card = recordCardVm(record, data, ctx);
    return card === null ? [] : [{ record, card }];
  });
  // The record set most recently: `RecordsSystem.newest`, the cards' order
  // breaking a tie.
  const index = RecordsSystem.newest(
    shown.map(({ record }) => record),
    dayOf(data.today),
  );
  const newest = index === null ? undefined : shown.at(index);
  if (newest === undefined) return null;
  const { record, card } = newest;
  let value = card.value;
  let detail = card.detail;
  let sentence: string;
  switch (record.personalRecordKind) {
    case PersonalRecordKind.FavouriteService:
      value = figure(record.value, lang);
      detail = null;
      sentence = words.records.sentenceFavourite(
        runningCase(card.value, lang),
        record.value,
      );
      break;
    case PersonalRecordKind.FirstVisit:
      sentence = words.records.sentence('firstVisit');
      break;
    case PersonalRecordKind.LongestRhythm:
    case PersonalRecordKind.MostVisitsInYear:
      sentence = words.records.sentence(
        RECORD_KIND_WORDS[record.personalRecordKind],
        record.value,
      );
      break;
  }
  return {
    ...card,
    value,
    detail,
    sentence,
    accessibleName: words.achievements.recordName(
      card.label,
      // A date says itself; a count is heard with what it counts.
      record.personalRecordKind === PersonalRecordKind.FirstVisit
        ? value
        : `${value} ${sentence}`,
      detail,
      card.isNew,
    ),
  };
}

// ── RE · the rows ───────────────────────────────────────────────────────

/** A row of the account's own record, from its card: one wording for both. */
function recordRow(
  record: PersonalRecord,
  input: RecordsPageInput,
): RecordRowVm | null {
  const { data, ctx } = input;
  const words = ctx.words;
  const card = recordCardVm(record, data, ctx);
  if (card === null) return null;
  const base = {
    id: card.id,
    theme: themeOf(card.id),
    title: card.label,
    faceName: null,
  };
  switch (record.personalRecordKind) {
    case PersonalRecordKind.FirstVisit:
      return record.on === null ? null : firstVisitRow(record.on, input);
    case PersonalRecordKind.FavouriteService:
      return {
        ...base,
        figure: card.value,
        line: card.detail,
        // The service's cover leads; its glyph where it has none.
        icon: card.src === null ? card.icon : null,
        src: card.src,
        accessibleName: words.achievements.recordName(
          card.label,
          card.value,
          card.detail,
          false,
        ),
      };
    case PersonalRecordKind.LongestRhythm:
    case PersonalRecordKind.MostVisitsInYear:
      return {
        ...base,
        figure: card.value,
        line: card.detail,
        icon: card.icon,
        src: null,
        accessibleName: words.achievements.recordName(
          card.label,
          words.visitsModule.sectionVisits(record.value),
          card.detail,
          false,
        ),
      };
  }
}

/** «Първо посещение · 1.03.2025 г.»: the whole date is the figure, always with its year. */
function firstVisitRow(day: string, input: RecordsPageInput): RecordRowVm {
  const words = input.ctx.words;
  const title = words.records.label('firstVisit');
  return {
    id: 'firstVisit',
    theme: themeOf('firstVisit'),
    title,
    figure: dayWithYear(day, words.lang),
    line: null,
    icon: RECORD_ICONS.firstVisit,
    src: null,
    faceName: null,
    accessibleName: words.achievements.recordName(
      title,
      dayLong(day, input.data.today, words.lang),
      null,
      false,
    ),
  };
}

/** A row that is not a record of the account's: a count the card already holds. */
function countRow(
  id: Extract<RecordRowWord, 'currentRhythm' | 'totalVisits' | 'last12Months'>,
  icon: UiIconName,
  count: number,
  line: string | null,
  input: RecordsPageInput,
): RecordRowVm {
  const words = input.ctx.words;
  const title = words.records.row(id);
  const value = figure(count, words.lang);
  return {
    id,
    theme: themeOf(id),
    title,
    figure: value,
    line,
    icon,
    src: null,
    faceName: null,
    accessibleName: words.achievements.recordName(
      title,
      // «Общо посещения: 23» names its own unit; the others are heard with it.
      id === 'totalVisits' ? value : words.visitsModule.sectionVisits(count),
      line,
      false,
    ),
  };
}

/** Every row the page can draw, by id; a row whose datum is absent is not in it. */
function rowsOf(
  records: readonly PersonalRecord[],
  input: RecordsPageInput,
): ReadonlyMap<string, RecordRowVm> {
  const { data, ctx, stats } = input;
  const words = ctx.words;
  const lang = words.lang;
  const rows = new Map<string, RecordRowVm>();
  const add = (row: RecordRowVm | null) => {
    if (row !== null) rows.set(row.id, row);
  };

  for (const record of records) add(recordRow(record, input));

  // «Ритъм сега»: the run in progress and the day it began. The day is
  // the state's own (`runStartedOn`): the track keeps twelve periods, a
  // run can be longer, so it is never read off the track.
  const rhythm = rhythmOf(input);
  if (rhythm !== null && rhythm.current > 0) {
    add(
      countRow(
        'currentRhythm',
        ROW_ICONS.currentRhythm,
        rhythm.current,
        rhythm.runStartedOn === null
          ? null
          : words.records.since(monthYearLong(rhythm.runStartedOn, lang)),
        input,
      ),
    );
  }

  if (stats !== null && stats.lifetimeVisitsCompleted > 0) {
    add(
      countRow(
        'totalVisits',
        ROW_ICONS.totalVisits,
        stats.lifetimeVisitsCompleted,
        null,
        input,
      ),
    );
    // The window is read over the shop's whole today, as every counter's
    // is (`ClientStatsSystem.statWindowsOnDay`): a visit of thirteen months
    // ago has left it without anything being rewritten. A today that is no
    // shop day reads no window: no row.
    const today = LocalDate.parse(data.today);
    if (today.ok) {
      add(
        countRow(
          'last12Months',
          ROW_ICONS.last12Months,
          ClientStatsSystem.statWindowsOnDay(stats, today.value).visitsCompleted
            .last12m,
          null,
          input,
        ),
      );
    }
  }

  // The book knows the first visit before the account stamps its record.
  if (
    !rows.has('firstVisit') &&
    stats !== null &&
    stats.firstVisitLocalDate !== null
  ) {
    add(firstVisitRow(stats.firstVisitLocalDate, input));
  }

  const barberId: string | null = stats?.preferredBarberId ?? null;
  const barber = barberId === null ? null : ctx.catalog.barberName(barberId);
  if (barberId !== null && barber !== null) {
    const title = words.records.row('preferredBarber');
    add({
      id: 'preferredBarber',
      theme: themeOf('preferredBarber'),
      title,
      // The figure is his FIRST name, as every line of the card names him
      // (§2.3.4 «Иван»; the glance's «12.09 · Иван»): the whole name is
      // for a list that must tell two people apart, and for a reader.
      figure: firstNameOf(barber),
      line: null,
      // A face leads, the barber's initials where he has no picture.
      icon: null,
      src: ctx.catalog.barberAvatarSrc(barberId),
      faceName: barber,
      accessibleName: words.achievements.recordName(title, barber, null, false),
    });
  }

  // «Обичайни услуги», when it holds more than the favourite alone
  // (`RecordsSystem.usualBeyondFavourite`, over the services the catalogue
  // still names).
  const favourite =
    PersonalRecord.find(records, PersonalRecordKind.FavouriteService)
      ?.serviceId ?? null;
  const usual = (stats?.usualServiceIds ?? []).flatMap((id) => {
    const name = ctx.catalog.serviceName(id);
    return name === null ? [] : [{ id, name }];
  });
  if (
    RecordsSystem.usualBeyondFavourite(
      usual.map((service) => service.id),
      favourite,
    )
  ) {
    const title = words.records.row('usualServices');
    add({
      id: 'usualServices',
      theme: themeOf('usualServices'),
      title,
      figure: usual.map((service) => service.name).join(' · '),
      line: null,
      icon: ROW_ICONS.usualServices,
      src: null,
      faceName: null,
      accessibleName: words.achievements.recordName(
        title,
        usual.map((service) => service.name).join(', '),
        null,
        false,
      ),
    });
  }
  return rows;
}

// ── RF · «По години» ────────────────────────────────────────────────────

/**
 * RF — the worked visits of the loaded history, counted by the shop's
 * year, newest first, each against the best year. `null` unless the
 * loaded pages are the client's WHOLE history: a year is never
 * under-counted. A year between two others without a visit is a bar of
 * nought, so the run of years reads unbroken.
 *
 * The record year is the account's own («Най-много за година») where it
 * is one of the best; else the earliest of the best: a record is set by
 * the year that first reached it.
 */
function yearsOf(
  records: readonly PersonalRecord[],
  input: RecordsPageInput,
): readonly RecordYearVm[] | null {
  const { data, ctx } = input;
  const words = ctx.words;

  // The worked visits of this person — the client RECORD's own seats, the
  // loyalty account being the record's (D29) — by the shop's day, only
  // over a WHOLE history; the counting is `RecordsSystem.yearsOfHistory`.
  const counted = RecordsSystem.yearsOfHistory(
    data.account.customerId,
    input.visits,
    records,
    input.historyComplete,
  );
  if (counted === null) return null;

  const years: RecordYearVm[] = [];
  for (const { year: number, count, best, record } of counted) {
    const label = String(number);
    const name = words.records.yearName(label, count, record);
    years.push({
      year: label,
      count: figure(count, words.lang),
      gauge: {
        value: count,
        min: 0,
        max: best,
        marks: [],
        label,
        valueText: name,
      },
      record,
      accessibleName: name,
    });
  }
  return years;
}

// ── The page ────────────────────────────────────────────────────────────

/** «Рекорди» (§2.3.4). With no record and no fact yet, the page is its empty state. */
export function recordsPageVm(input: RecordsPageInput): RecordsPageVm {
  const words = input.ctx.words;
  const rhythm = rhythmOn(input);
  // The longest run is a record only while the shop runs a rhythm.
  const records = recordsOf(input.data, rhythm);
  const featured = featuredOf(records, input);
  const rows = rowsOf(records, input);
  const groups: RecordGroupVm[] = THEMES.flatMap(({ theme, rows: ids }) => {
    if (theme === 'rhythm' && !rhythm) return [];
    const drawn = ids.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined || id === featured?.id ? [] : [row];
    });
    return drawn.length === 0
      ? []
      : [{ theme, title: words.records.group(theme), rows: drawn }];
  });
  return {
    subline: input.ctx.subjectName,
    featured,
    groups,
    years: yearsOf(records, input),
  };
}

// ── The card's own values → ecs-core structs ──────────────────────────────

/** A shop day the card holds: a clock's «today». */
function dayOf(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}
