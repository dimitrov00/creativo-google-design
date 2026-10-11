import { UserId } from '@creativo/application/accounts';
import { firstNameOf } from '@creativo/features/shared/visits';
import {
  type Appointment,
  type ClientStatsRecord,
  ZonedDateTime,
  statWindows,
  subjectVisitOf,
} from '@creativo/application/booking';
import type {
  PersonalRecord,
  StreakDefinition,
  StreakState,
} from '@creativo/application/engagement';
import {
  AppointmentId,
  LocalDate,
  ServiceId as ServiceRefId,
  defect,
} from '@core/primitives';
import {
  type PersonalRecord as SystemRecord,
  PersonalRecordKind as SystemRecordKind,
} from '@core/components';
import { type RecordVisit, RecordsSystem } from '@core/systems';
import type { UiIconName } from '@creativo/ui/controls';
import type { AchievementsContext } from './achievements.presenter';
import {
  dayLong,
  dayWithYear,
  figure,
  monthYearLong,
  runningCase,
  shopDayOf,
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
import type { RecordRowWord } from './client-card.words';
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
  /** `clientStats/{uid}`, read for the head; `null` until it answers, and for a client without one. */
  readonly stats: ClientStatsRecord | null;
  /**
   * The rhythm's rule in force; `null` with `loyalty.streaks` off and in a
   * shop without a rhythm. A rule that is switched off is still handed
   * over: the page asks it whether it is `enabled`.
   */
  readonly ruleInForce: StreakDefinition | null;
  /** The history's loaded pages (`ClientCardStore.loadedVisits`). */
  readonly visits: readonly Appointment[];
  /** No cursor left: the loaded pages are the client's WHOLE history. */
  readonly historyComplete: boolean;
}

/** Where every visit of the card is read: the shop's zone. */
const SHOP_ZONE = 'Europe/Sofia';

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

/** Whether the page draws the rhythm: the rule in force is there, and on. */
function rhythmOn(input: RecordsPageInput): boolean {
  return input.ruleInForce !== null && input.ruleInForce.enabled;
}

/** The rhythm the rule in force projects, as the account holds it. */
function rhythmStateOf(input: RecordsPageInput): StreakState | null {
  const rule = input.ruleInForce;
  if (rule === null || !rule.enabled) return null;
  return (
    Object.values(input.data.account.streaks).find(
      (state) => state.streakId === rule.id,
    ) ?? null
  );
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
    shown.map(({ record }) => recordOf(record)),
    dayOf(data.today),
  );
  const newest = index === null ? undefined : shown.at(index);
  if (newest === undefined) return null;
  const { record, card } = newest;
  let value = card.value;
  let detail = card.detail;
  let sentence: string;
  switch (record.kind) {
    case 'favouriteService':
      value = figure(record.value, lang);
      detail = null;
      sentence = words.records.sentenceFavourite(
        runningCase(card.value, lang),
        record.value,
      );
      break;
    case 'firstVisit':
      sentence = words.records.sentence('firstVisit');
      break;
    case 'longestRhythm':
    case 'mostVisitsInYear':
      sentence = words.records.sentence(record.kind, record.value);
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
      record.kind === 'firstVisit' ? value : `${value} ${sentence}`,
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
    id: record.kind,
    theme: themeOf(record.kind),
    title: card.label,
    faceName: null,
  };
  switch (record.kind) {
    case 'firstVisit':
      return record.on === null ? null : firstVisitRow(record.on, input);
    case 'favouriteService':
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
    case 'longestRhythm':
    case 'mostVisitsInYear':
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

/** The end of the shop's today, for the windows a count is read through. */
function endOfDayMs(today: string): number | null {
  const end = ZonedDateTime.fromISO(`${today}T23:59:59`, SHOP_ZONE);
  return end.isFailure() ? null : end.value.toMillis();
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
  const rhythm = rhythmStateOf(input);
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

  if (stats !== null && stats.lifetime.visitsCompleted > 0) {
    add(
      countRow(
        'totalVisits',
        ROW_ICONS.totalVisits,
        stats.lifetime.visitsCompleted,
        null,
        input,
      ),
    );
    // The window is read at the shop's today, as every counter's is
    // (`statWindows`): a visit of thirteen months ago has left it without
    // anything being rewritten.
    const nowMs = endOfDayMs(data.today);
    if (nowMs !== null) {
      add(
        countRow(
          'last12Months',
          ROW_ICONS.last12Months,
          statWindows(stats, nowMs).visitsCompleted.last12m,
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
    stats.firstVisitAtMs !== null
  ) {
    add(firstVisitRow(shopDayOf(stats.firstVisitAtMs), input));
  }

  const barberId = stats?.preferredBarberId?.value ?? null;
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

  // «Обичайни услуги», when it holds more than the favourite alone.
  const favourite =
    records.find((record) => record.kind === 'favouriteService')?.serviceId ??
    null;
  const usual = (stats?.usualServiceIds ?? []).flatMap((id) => {
    const name = ctx.catalog.serviceName(id.value);
    return name === null ? [] : [{ id: id.value, name }];
  });
  if (usual.some((service) => service.id !== favourite)) {
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
  if (!input.historyComplete) return null;
  const { data, ctx } = input;
  const words = ctx.words;
  const subject = UserId.create(data.account.userId);
  if (subject.isFailure()) return null;

  // The worked visits of this person, by the shop's day; the counting is
  // `RecordsSystem.years`.
  const worked: RecordVisit[] = [];
  for (const appointment of input.visits) {
    const visit = subjectVisitOf(subject.value, appointment);
    if (visit === null || visit.outcome.kind !== 'worked') continue;
    worked.push({
      appointmentId: AppointmentId.of(appointment.id.value),
      localDate: dayOf(shopDayOf(visit.atMs)),
    });
  }
  const stamped =
    records.find((record) => record.kind === 'mostVisitsInYear')?.year ?? null;
  const counted = RecordsSystem.years(worked, stamped);
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
