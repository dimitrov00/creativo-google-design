import {
  AnalyticsBarPart,
  AnalyticsFigure,
  AnalyticsPeriod,
  type AnalyticsReport,
  AnalyticsSpan,
  type DayRow,
  GoalPaceTag,
  HeroChange,
  VisitGrain,
} from '@core/components';
import {
  AppointmentId,
  type BarberId,
  Currency,
  HourOfDay,
  LocalDate,
  type PriceCents,
  type ServiceId,
  type TimeZone,
  UtcEpochMs,
  type Weekday,
} from '@core/primitives';
import {
  type AnalyticsScopeChoice,
  type AnalyticsScreen,
  StaffAnalyticsSystem,
} from '@core/systems';
import { relativeTime } from '@creativo/infrastructure/i18n';
import {
  formatCents,
  formatCount,
  formatDayShort,
  formatInstant,
  formatMinute,
  formatMonthLong,
  formatPercent,
  formatSignedPercent,
  formatWallClock,
  formatWeekdayLabels,
} from '@creativo/ui/wall-clock';
import {
  type AppointmentRowVm,
  TrailingFactFace,
  StatusFactTone,
  VisitRowEntry,
  type VisitSectionVm,
  sectionVisits,
  spanWords,
  visitSectionLabel,
} from '@creativo/features/shared/visits';
import type { UiDateFieldParts } from '@creativo/ui/controls';
import type { AnalyticsWords } from './analytics.words';
import {
  type AnalyticsAheadVm,
  type AnalyticsBarberRowVm,
  type AnalyticsBlockedVm,
  type AnalyticsBodyVm,
  type AnalyticsBusyVm,
  type AnalyticsChartBarVm,
  type AnalyticsClientsVm,
  type AnalyticsDayRowVm,
  type AnalyticsDrill,
  type AnalyticsDrillVm,
  type AnalyticsGoalCheck,
  AnalyticsGoalRefusal,
  type AnalyticsGoalRingVm,
  AnalyticsGoalSave,
  type AnalyticsGoalSheetVm,
  type AnalyticsGoalVm,
  type AnalyticsHeroVm,
  type AnalyticsInfoVm,
  AnalyticsLoad,
  type AnalyticsOpenVm,
  type AnalyticsOriginsVm,
  type AnalyticsPeriodVm,
  type AnalyticsRadarsVm,
  type AnalyticsRangeCheck,
  AnalyticsRangeRefusal,
  type AnalyticsRangeVm,
  type AnalyticsScopeVm,
  type AnalyticsSeriesVm,
  type AnalyticsServicesVm,
  type AnalyticsStatusVm,
  type AnalyticsTimeSeriesVm,
  type AnalyticsTimeVm,
  AnalyticsTopic,
  type AnalyticsVm,
  BAR_PART_HOOKS,
  DrillRows,
  FIGURE_TOPICS,
  ORIGIN_PART_HOOKS,
} from './analytics.vm';

/*
 * THE «АНАЛИЗИ» SCREEN'S PRESENTER (Law 10) — a report, the screen's state
 * and the words in, the display struct out. It DECIDES NOTHING: which way
 * the takings moved, the bar's shares, which sections show, the steps of
 * the switcher, the scope picker's order and every footer total are
 * `StaffAnalyticsSystem`'s; a rate or `null` (counts instead) is the
 * report's own. This file only words them.
 */

/** The report's money is euro cents (`MoneyAllocationSystem.seatNets`, the catalogue's Takings row). */
export const REPORT_CURRENCY = Currency.EUR;

/** What the screen names from the catalogue — services and barbers. */
export interface AnalyticsNames {
  serviceName(id: ServiceId): string | null;
  barberName(id: BarberId): string | null;
  barberAvatarSrc(id: BarberId): string | null;
}

/** Everything the screen is worded from. */
export interface AnalyticsScreenInput {
  readonly words: AnalyticsWords;
  /** The default shop's zone — the clock "today" and a report's time are read on. */
  readonly zone: TimeZone;
  readonly today: LocalDate;
  /** The clock the freshness line is read against — the store's, re-read every minute. */
  readonly now: UtcEpochMs;
  readonly period: AnalyticsPeriod;
  readonly analyticsLoad: AnalyticsLoad;
  readonly report: AnalyticsReport | null;
  /** A refusal of the account, already worded (`errors.<code>`); `null` without one. */
  readonly refusal: string | null;
  /** The admin's scope picker (`StaffAnalyticsSystem.scopeChoicesOf`); `null` for a barber. */
  readonly scopeChoices: readonly AnalyticsScopeChoice[] | null;
  /** The scope chosen in the picker; `null` is the shop. */
  readonly scopeBarberId: BarberId | null;
  /** The account's own barber record; `null` for an unlinked admin. */
  readonly linkedBarberId: BarberId | null;
  /** The barber asked for no longer exists: the shop is shown instead. */
  readonly scopeGone: boolean;
  /** The barber record the open-hours card opens the schedule on; `null` is everyone. */
  readonly scheduleBarberId: BarberId | null;
  /** The store's verdict on the custom-range sheet's fields. */
  readonly rangeCheck: AnalyticsRangeCheck;
  /** The store's verdict on the goal sheet's two sums. */
  readonly goalCheck: AnalyticsGoalCheck;
  /** Where the goal's write stands. */
  readonly goalSave: AnalyticsGoalSave;
  readonly names: AnalyticsNames;
}

/** The whole screen. */
export function analyticsVm(input: AnalyticsScreenInput): AnalyticsVm {
  const { words, report } = input;
  const body =
    report === null || input.analyticsLoad === AnalyticsLoad.Refused
      ? null
      : bodyOf(input, report);
  return {
    title: words.title,
    backLabel: words.back,
    freshness: statusOf(input),
    retryLabel: words.freshness.retry,
    period: periodOf(input),
    scope: scopeOf(input),
    placeholder:
      report === null && input.analyticsLoad === AnalyticsLoad.Loading,
    blocked: blockedOf(input),
    notice: input.scopeGone ? words.freshness.scopeGone : null,
    body,
    // The figures on screen are what the file holds: none, nothing to export.
    exportLabel: body === null ? null : words.export.action,
    infoLabels: infoLabelsOf(words),
  };
}

/** The ⓘ alert of one topic: its name and its definition in words. */
export function analyticsInfoVm(
  words: AnalyticsWords,
  topic: AnalyticsTopic,
): AnalyticsInfoVm {
  return {
    // eslint-disable-next-line security/detect-object-injection -- `topic` is a closed `AnalyticsTopic` literal.
    title: words.figure[topic],
    // eslint-disable-next-line security/detect-object-injection -- as above.
    message: words.info.definition[topic],
    closeLabel: words.info.close,
  };
}

/** The freshness line's ⓘ: how the figures come about. */
export function analyticsFreshnessInfoVm(
  words: AnalyticsWords,
): AnalyticsInfoVm {
  return {
    title: words.title,
    message: words.freshness.info,
    closeLabel: words.info.close,
  };
}

// ── The head ──────────────────────────────────────────────────────────────

/** An age under this is «току-що»; under the hour it is a relative phrase. */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export function statusOf(
  input: AnalyticsScreenInput,
): AnalyticsStatusVm | null {
  const { words, report } = input;
  if (input.analyticsLoad === AnalyticsLoad.Refused) return null;
  if (report === null) {
    return input.analyticsLoad === AnalyticsLoad.Loading
      ? {
          text: words.freshness.refreshing,
          retry: false,
          info: words.freshness.info,
          testId: 'analytics-status',
        }
      : null;
  }
  return input.analyticsLoad === AnalyticsLoad.Failed
    ? {
        text: words.freshness.failed(computedTimeOf(input, report)),
        retry: true,
        info: words.freshness.info,
        testId: 'analytics-status-failed',
      }
    : {
        text: freshnessOf(input, report),
        retry: false,
        info: words.freshness.info,
        testId: 'analytics-status',
      };
}

/**
 * «Freshness» (staff-analytics-v2, The screen): the report's age against
 * `now` — a staleness reading (Law 7 T2, display only) — worded in four
 * steps: «току-що» under a minute (or a negative age, a server clock ahead
 * of this one), «Обновено преди 5 мин» under the hour, «Обновено в 09:12»
 * on the same shop day, «Обновено на 27.09, 18:40» on an earlier one.
 */
function freshnessOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): string {
  const { words } = input;
  const computedAt = report.reportComputedAtUtcMs;
  const ageMs = UtcEpochMs.elapsedMs(computedAt, input.now);
  if (ageMs < MINUTE_MS) return words.freshness.justNow;
  if (ageMs < HOUR_MS) {
    return words.freshness.updatedAgo(
      relativeTime(computedAt, input.now, words.lang, 'short'),
    );
  }
  const time = computedTimeOf(input, report);
  return StaffAnalyticsSystem.computedOn(report, input.zone, input.today)
    ? words.freshness.updatedAt(time)
    : words.freshness.updatedOn(time);
}

/** «09:12» on the day it was computed, «27.09, 18:40» on an earlier one. */
function computedTimeOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): string {
  const today = StaffAnalyticsSystem.computedOn(
    report,
    input.zone,
    input.today,
  );
  return formatInstant(
    report.reportComputedAtUtcMs,
    input.zone,
    input.words.lang,
    today
      ? { hour: '2-digit', minute: '2-digit' }
      : {
          day: 'numeric',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        },
  );
}

function periodOf(input: AnalyticsScreenInput): AnalyticsPeriodVm {
  const { words, period } = input;
  const steps = StaffAnalyticsSystem.stepsOf(period, input.today);
  // The comparison period is the component's rule (Terms): read when it
  // starts within the reach, otherwise not read and the chip says so.
  const comparable = AnalyticsPeriod.isComparable(period, input.today);
  return {
    spanLabel: words.spanLabel,
    spans: [
      AnalyticsSpan.Day,
      AnalyticsSpan.Week,
      AnalyticsSpan.Month,
      AnalyticsSpan.Year,
    ].map((span) => ({
      id: span,
      // eslint-disable-next-line security/detect-object-injection -- `span` is a closed `AnalyticsSpan` literal.
      label: words.span[span],
      testId: `analytics-span-${span.toLowerCase()}`,
    })),
    selectedSpan: period.analyticsSpan,
    customOn: period.analyticsSpan === AnalyticsSpan.Custom,
    label: periodLabelOf(period, input),
    previousLabel: words.previous,
    previousEnabled: steps.previous !== null,
    nextLabel: words.next,
    nextEnabled: steps.next !== null,
    comparison: {
      text: comparable ? words.comparison.previous : words.comparison.none,
      comparable,
      testId: 'analytics-comparison-chip',
    },
    range: rangeOf(input),
  };
}

/** The sheet's two fields as a shop day — `null` while empty, half-typed or no calendar day. */
export function partsToLocalDate(
  parts: UiDateFieldParts | null,
): LocalDate | null {
  if (parts === null) return null;
  const day = LocalDate.fromParts(parts.year, parts.month, parts.day);
  return day.ok ? day.value : null;
}

/** The custom-range sheet's words, and why «Приложи» is off (the store's check, worded). */
export function rangeOf(input: AnalyticsScreenInput): AnalyticsRangeVm {
  const { words } = input;
  const refusal = rangeRefusalOf(input.rangeCheck, input);
  return {
    pillLabel: words.customRange.pill,
    title: words.customRange.title,
    fromLabel: words.customRange.from,
    toLabel: words.customRange.to,
    dayLabel: words.customRange.day,
    monthLabel: words.customRange.month,
    yearLabel: words.customRange.year,
    dayPlaceholder: words.customRange.dayPlaceholder,
    monthPlaceholder: words.customRange.monthPlaceholder,
    yearPlaceholder: words.customRange.yearPlaceholder,
    applyLabel: words.customRange.apply,
    closeLabel: words.customRange.close,
    refusal,
    applyEnabled: refusal === null,
    chooseLabel: words.customRange.choose,
    previousMonthLabel: words.customRange.previousMonth,
    nextMonthLabel: words.customRange.nextMonth,
    locale: words.lang,
    today: input.today,
    earliest: AnalyticsPeriod.earliestOn(input.today),
  };
}

/** A custom range row's date — «1.11.2026» — or `null` while the row has none. */
export function rangeDateText(
  date: LocalDate | null,
  input: AnalyticsScreenInput,
): string | null {
  return date === null
    ? null
    : formatDayShort(date, input.today, input.words.lang);
}

function rangeRefusalOf(
  check: AnalyticsRangeCheck,
  input: AnalyticsScreenInput,
): string | null {
  const { words } = input;
  switch (check.rangeRefusal) {
    case null:
      return null;
    case AnalyticsRangeRefusal.Incomplete:
      return words.customRange.incomplete;
    case AnalyticsRangeRefusal.BeforeReach:
      return words.customRange.beforeReach(
        formatDayShort(
          AnalyticsPeriod.earliestOn(input.today),
          input.today,
          words.lang,
        ),
      );
    case AnalyticsRangeRefusal.AfterToday:
      return words.customRange.afterToday;
    case AnalyticsRangeRefusal.TooLong:
      return words.customRange.tooLong(AnalyticsPeriod.CUSTOM_MAX_DAYS);
  }
}

/** «Септември 2026 г.» · «28.09 – 4.10» · «вторник, 29.09». */
export function periodLabelOf(
  period: AnalyticsPeriod,
  input: AnalyticsScreenInput,
): string {
  const lang = input.words.lang;
  if (period.analyticsSpan === AnalyticsSpan.Day) {
    return dayWithWeekday(period.fromLocalDate, lang);
  }
  if (period.analyticsSpan === AnalyticsSpan.Year) {
    return formatWallClock(period.fromLocalDate, null, lang, {
      year: 'numeric',
    });
  }
  return period.analyticsSpan === AnalyticsSpan.Month
    ? visitSectionLabel(period.fromLocalDate.slice(0, 7), lang)
    : input.words.range(
        formatDayShort(period.fromLocalDate, input.today, lang),
        formatDayShort(period.toLocalDate, input.today, lang),
      );
}

export function scopeOf(input: AnalyticsScreenInput): AnalyticsScopeVm | null {
  const { words, scopeChoices } = input;
  if (scopeChoices === null) return null;
  return {
    label: words.scope.label,
    tiles: scopeChoices.map((choice) => {
      const id = choice.scopeBarberId;
      return {
        scopeBarberId: id,
        name:
          id === null
            ? words.scope.shop
            : choice.scopeMine
              ? words.scope.me
              : (input.names.barberName(id) ?? words.scope.barber),
        avatarSrc: id === null ? null : input.names.barberAvatarSrc(id),
        selected: id === input.scopeBarberId,
        testId: `analytics-scope-${id ?? 'shop'}`,
      };
    }),
  };
}

export function blockedOf(
  input: AnalyticsScreenInput,
): AnalyticsBlockedVm | null {
  if (input.analyticsLoad === AnalyticsLoad.Refused) {
    return {
      text: input.refusal ?? input.words.freshness.failedNoCache,
      retry: false,
      testId: 'analytics-refused',
    };
  }
  if (input.report === null && input.analyticsLoad === AnalyticsLoad.Failed) {
    return {
      text: input.words.freshness.failedNoCache,
      retry: true,
      testId: 'analytics-failed',
    };
  }
  return null;
}

function infoLabelsOf(
  words: AnalyticsWords,
): Readonly<Record<AnalyticsTopic, string>> {
  const out = {} as Record<AnalyticsTopic, string>;
  for (const topic of Object.values(AnalyticsTopic)) {
    // eslint-disable-next-line security/detect-object-injection -- `topic` is a closed `AnalyticsTopic` literal.
    out[topic] = words.info.label(words.figure[topic]);
  }
  return out;
}

// ── The figures ───────────────────────────────────────────────────────────

export function bodyOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsBodyVm {
  const screen = StaffAnalyticsSystem.screenOf(report);
  const { words } = input;
  return {
    empty: screen.periodEmpty
      ? {
          title: words.empty.title,
          detail: screen.rostered
            ? words.empty.rostered(
                spanWords(report.reportRosteredMinutes, words.spanWords),
              )
            : words.empty.noRoster,
        }
      : null,
    hero: heroOf(input, report, screen),
    // On DAY the hero and its delta stand alone and the day's one bar is the
    // time's whole story (v2, «The seven questions»): no line, no heatmap.
    series:
      report.reportAnalyticsSpan === AnalyticsSpan.Day
        ? null
        : seriesOf(input, report),
    time: timeOf(input, report),
    busy:
      report.reportAnalyticsSpan === AnalyticsSpan.Day
        ? null
        : busyOf(input, report),
    open: openOf(input, report, screen),
    services: servicesOf(input, report, screen),
    clients: clientsOf(input, report, screen),
    origins: screen.shopScope ? originsOf(input, report) : null,
    radars: screen.shopScope ? radarsOf(input, report) : null,
    goal: goalOf(input, report),
  };
}

// ── The month's goal ──────────────────────────────────────────────────────

/**
 * «Цел за месеца» (CUJ 6): on MONTH, the stored goal as a ring — the
 * takings against the range's high end, the pace sentence under it — and
 * «Задай цел» on a month the callable takes one for
 * (`StaffAnalyticsSystem.goalMonthOffered`: this month or the next) from
 * this account (`goalScopeAllowed`: the shop's, or its own record's — both
 * the pipeline's own rules). The pace (`reportGoalPaceTag`) and its day counts
 * are the report's; this words them. `null` off MONTH, and on a month with
 * neither a goal nor an offer.
 */
function goalOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsGoalVm | null {
  const { words, period } = input;
  if (period.analyticsSpan !== AnalyticsSpan.Month) return null;
  const offered =
    StaffAnalyticsSystem.goalMonthOffered(period, input.today) &&
    StaffAnalyticsSystem.goalScopeAllowed(
      input.scopeBarberId,
      input.linkedBarberId,
    );
  const low = report.reportGoalLowCents;
  const high = report.reportGoalHighCents;
  const stored = low !== null && high !== null;
  if (!stored && !offered) return null;
  const lang = words.lang;
  let ring: AnalyticsGoalRingVm | null = null;
  if (stored) {
    const rangeText = words.goal.range(
      formatCents(low, REPORT_CURRENCY, lang),
      formatCents(high, REPORT_CURRENCY, lang),
    );
    const takings = report.reportTakingsCents;
    const paceTag = report.reportGoalPaceTag;
    ring = {
      value: takings,
      min: 0,
      max: high,
      figure: formatPercent(takings / high, lang),
      rangeText,
      pace:
        paceTag === GoalPaceTag.None
          ? words.goal.noDays
          : words.goal.days(
              report.reportGoalDaysSoFar,
              report.reportGoalDaysInMonth,
              words.goal.pace[paceTag],
            ),
      paceTag,
      label: words.goal.label,
      accessibleName: words.goal.valueText(
        formatCents(takings, REPORT_CURRENCY, lang),
        rangeText,
      ),
    };
  }
  return {
    title: words.goal.title,
    ring,
    setLabel: offered ? (stored ? words.goal.change : words.goal.set) : null,
    prompt: stored ? null : words.goal.prompt,
    sheet: goalSheetOf(input),
  };
}

/** The goal sheet's words, and why «Запази» is off (the store's check, or a failed save). */
function goalSheetOf(input: AnalyticsScreenInput): AnalyticsGoalSheetVm {
  const { words } = input;
  const sheet = words.goal.sheet;
  let refusal: string | null;
  switch (input.goalCheck.goalRefusal) {
    case null:
      refusal =
        input.goalSave === AnalyticsGoalSave.Failed ? sheet.failed : null;
      break;
    case AnalyticsGoalRefusal.Incomplete:
      refusal = sheet.incomplete;
      break;
    case AnalyticsGoalRefusal.InvalidRange:
      refusal = sheet.invalid;
      break;
  }
  const saving = input.goalSave === AnalyticsGoalSave.Saving;
  return {
    title: sheet.title,
    lowLabel: sheet.low,
    highLabel: sheet.high,
    decreaseLabel: sheet.decrease,
    increaseLabel: sheet.increase,
    unit: '€',
    saveLabel: sheet.save,
    closeLabel: sheet.close,
    refusal,
    saveEnabled: input.goalCheck.goalRefusal === null && !saving,
    saving,
  };
}

// ── The admin's radars ────────────────────────────────────────────────────

/** The identity tones, in the catalogue's barber order. */
const IDENTITY_TONES = 5;

/**
 * «Как се справя всеки»: one radar per barber on the shop's base, the
 * comparison period's polygon on the same base; `null` on a span the
 * report carries no radars for (DAY, WEEK — the report's own rule: it
 * answers none). With too few barbers the section holds the base's word
 * alone.
 */
function radarsOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsRadarsVm | null {
  const { words } = input;
  const span = report.reportAnalyticsSpan;
  if (span === AnalyticsSpan.Day || span === AnalyticsSpan.Week) return null;
  const lang = words.lang;
  const axisWords = [
    words.radars.axis.takingsPerHour,
    words.radars.axis.fill,
    words.radars.axis.rebooking,
    words.radars.axis.tipsRate,
    words.radars.axis.reliability,
  ];
  const radars = report.reportRadars.map((row, i) => {
    const values: readonly (number | null)[] = [
      row.takingsPerHour,
      row.fill,
      row.rebooking,
      row.tipsRate,
      row.reliability,
    ];
    const comparisons: readonly (number | null)[] = [
      row.comparisonTakingsPerHour,
      row.comparisonFill,
      row.comparisonRebooking,
      row.comparisonTipsRate,
      row.comparisonReliability,
    ];
    const name = input.names.barberName(row.barberId) ?? words.scope.barber;
    const axes = axisWords.map((label, a) => ({
      label,
      value: values.at(a) ?? null,
      comparison: comparisons.at(a) ?? null,
    }));
    return {
      barberId: row.barberId,
      name,
      avatarSrc: input.names.barberAvatarSrc(row.barberId),
      tone: i % IDENTITY_TONES,
      axes,
      valueText: axes.map((axis) =>
        axis.value === null
          ? words.radars.missing
          : formatCount(Math.round(axis.value), lang),
      ),
      label: `${name}: ${axes
        .map(
          (axis) =>
            `${axis.label} ${axis.value === null ? words.radars.missing : formatCount(Math.round(axis.value), lang)}`,
        )
        .join(', ')}`,
      accessibleName: words.radars.open(name),
      testId: `analytics-radar-${row.barberId}`,
    };
  });
  return {
    title: words.radars.title,
    subtitle: words.radars.base[report.reportRadarBase],
    missingText: words.radars.missing,
    comparisonLegend:
      report.reportHeroPreviousCents === null ? null : words.radars.comparison,
    radars,
  };
}

// ── The charts' labels ────────────────────────────────────────────────────

/** The short weekday of a day — «пн». */
function weekdayShort(day: LocalDate, lang: string): string {
  return weekdayLabel(LocalDate.weekday(day), lang);
}

function weekdayLabel(weekday: Weekday, lang: string): string {
  return formatWeekdayLabels(lang)[weekday - 1] ?? String(weekday);
}

/**
 * The labels along a series' axis, by the period's grain: a week names
 * its days; a month numbers every seventh day (1, 8, 15, 22, 29) so the
 * axis breathes on a phone. Display layout, not a decision: every point is
 * drawn, only the words are thinned.
 */
function axisLabels(
  points: readonly { readonly localDate: LocalDate }[],
  span: AnalyticsSpan,
  lang: string,
): readonly string[] {
  // A day's one bar carries no word: the period's label names the day.
  if (span === AnalyticsSpan.Day) return points.map(() => '');
  if (
    span === AnalyticsSpan.Week ||
    (span === AnalyticsSpan.Custom && points.length <= 7)
  ) {
    return points.map((point) => weekdayShort(point.localDate, lang));
  }
  // A year's points are its months; a custom range over 93 days is in
  // weeks, each named by its first day.
  if (span === AnalyticsSpan.Year) {
    return points.map((point) =>
      formatWallClock(point.localDate, null, lang, { month: 'short' }),
    );
  }
  if (span === AnalyticsSpan.Custom && points.length > 0) {
    const first = points[0]?.localDate;
    const last = points[points.length - 1]?.localDate;
    if (
      first !== undefined &&
      last !== undefined &&
      LocalDate.daysBetween(first, last) + 1 > points.length
    ) {
      return points.map((point, i) =>
        i % 4 === 0
          ? formatDayShort(point.localDate, point.localDate, lang)
          : '',
      );
    }
  }
  return points.map((point, i) =>
    i % 7 === 0 ? String(LocalDate.parts(point.localDate).day) : '',
  );
}

/** «10:00» — a wall-clock hour. */
function hourLabel(hour: HourOfDay, lang: string): string {
  return formatMinute(HourOfDay.startMinute(hour), lang);
}

// ── The takings line ──────────────────────────────────────────────────────

function seriesOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsSeriesVm {
  const { words } = input;
  const lang = words.lang;
  const points = report.reportSeries;
  const labels = axisLabels(points, report.reportAnalyticsSpan, lang);
  const average = StaffAnalyticsSystem.seriesAverageCentsOf(report);
  return {
    points: points.map((point, i) => ({
      label: labels.at(i) ?? '',
      value: point.takingsCents,
      comparison: point.comparisonTakingsCents,
    })),
    average,
    valueText: points.map((point) => money(point.takingsCents, lang)),
    averageText:
      average === null ? null : words.charts.average(money(average, lang)),
    // The report's own "there is a previous period" signal (the hero's).
    comparisonLegend:
      report.reportHeroPreviousCents === null ? null : words.charts.comparison,
    label: words.charts.line,
  };
}

// ── The time bars ─────────────────────────────────────────────────────────

/** Each bar part's field of a time point — the stacked bar's six segments, in the legend's order. */
const TIME_POINT_FIELDS = {
  [AnalyticsBarPart.Worked]: 'workedMinutes',
  [AnalyticsBarPart.NoShow]: 'noShowMinutes',
  [AnalyticsBarPart.Unmarked]: 'unmarkedMinutes',
  [AnalyticsBarPart.Blocked]: 'blockedMinutes',
  [AnalyticsBarPart.Unsold]: 'unsoldMinutes',
  [AnalyticsBarPart.Other]: 'otherMinutes',
} as const satisfies Record<AnalyticsBarPart, keyof AnalyticsReport.TimePoint>;

const TIME_PARTS: readonly AnalyticsBarPart[] = Object.values(AnalyticsBarPart);

function timeBarsOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsTimeSeriesVm {
  const { words } = input;
  const points = report.reportTimeSeries;
  const labels = axisLabels(points, report.reportAnalyticsSpan, words.lang);
  const totals: number[] = [];
  const bars: AnalyticsChartBarVm[] = points.map((point, i) => {
    let total = 0;
    const parts = TIME_PARTS.map((part) => {
      // eslint-disable-next-line security/detect-object-injection -- `part` is a closed `AnalyticsBarPart` literal.
      const value = point[TIME_POINT_FIELDS[part]];
      total += value;
      // eslint-disable-next-line security/detect-object-injection -- as above.
      return { part: BAR_PART_HOOKS[part], value };
    });
    totals.push(total);
    return { label: labels.at(i) ?? '', parts };
  });
  return {
    bars,
    valueText: totals.map((total) => spanWords(total, words.spanWords)),
    label: words.charts.timeBars,
  };
}

// ── When the chair is busy ────────────────────────────────────────────────

function busyOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsBusyVm | null {
  const cells = report.reportHourGrid;
  if (cells.length === 0) return null;
  const { words } = input;
  const lang = words.lang;
  // The grid's own axes: the weekdays and hours that have a cell, in order
  // (the report lists cells weekday-then-hour, so each axis is the sorted
  // distinct values).
  const weekdays: Weekday[] = [];
  const hours: HourOfDay[] = [];
  for (const cell of cells) {
    if (!weekdays.includes(cell.weekday)) weekdays.push(cell.weekday);
    if (!hours.includes(cell.hour)) hours.push(cell.hour);
  }
  weekdays.sort((a, b) => a - b);
  hours.sort((a, b) => a - b);
  const at = (weekday: Weekday, hour: HourOfDay): string =>
    words.busy.at(weekdayLabel(weekday, lang), hourLabel(hour, lang));
  const busiest =
    report.reportBusiestWeekday !== null && report.reportBusiestHour !== null
      ? at(report.reportBusiestWeekday, report.reportBusiestHour)
      : null;
  const emptiest =
    report.reportEmptiestWeekday !== null && report.reportEmptiestHour !== null
      ? at(report.reportEmptiestWeekday, report.reportEmptiestHour)
      : null;
  return {
    title: words.busy.title,
    rows: weekdays.map((weekday) => weekdayLabel(weekday, lang)),
    columns: hours.map((hour) => String(hour)),
    cells: cells.map((cell) => ({
      row: weekdays.indexOf(cell.weekday),
      column: hours.indexOf(cell.hour),
      value: cell.workedMinutes,
      // A cell with no rostered minute is drawn at no strength.
      max: Math.max(cell.rosteredMinutes, 1),
    })),
    sentence:
      busiest === null || emptiest === null
        ? words.busy.pending
        : words.busy.sentence(busiest, emptiest),
    label: words.busy.label,
  };
}

// ── The open-hours card's bars ────────────────────────────────────────────

function aheadBarsOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
  emptiest: LocalDate | null,
): AnalyticsAheadVm {
  const { words } = input;
  const days = report.reportAheadDays;
  const highlight =
    emptiest === null
      ? -1
      : days.findIndex((day) => day.localDate === emptiest);
  return {
    bars: days.map((day) => ({
      label: weekdayShort(day.localDate, words.lang),
      parts: [
        {
          part: BAR_PART_HOOKS[AnalyticsBarPart.Worked],
          value: day.openMinutes,
        },
      ],
    })),
    highlightIndex: highlight === -1 ? null : highlight,
    valueText: days.map((day) => spanWords(day.openMinutes, words.spanWords)),
    label: words.charts.ahead,
  };
}

export function money(cents: PriceCents, lang: string): string {
  return formatCents(cents, REPORT_CURRENCY, lang);
}

function heroOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
  screen: AnalyticsScreen,
): AnalyticsHeroVm {
  const { words } = input;
  const lang = words.lang;
  const change = StaffAnalyticsSystem.heroChangeOf(report);
  const rate = change.heroChangeRate;
  const value = money(report.reportTakingsCents, lang);
  const delta =
    rate === null || change.heroChange === HeroChange.Flat
      ? null
      : formatSignedPercent(rate, lang);
  const comparison = comparisonOf(change.heroChange, rate, words);
  const tipsValue = money(report.reportTipsCents, lang);
  return {
    caption: words.hero.caption,
    value,
    delta,
    trend:
      delta === null
        ? null
        : change.heroChange === HeroChange.Up
          ? 'up'
          : 'down',
    comparison,
    tipsLabel: words.hero.tips,
    tipsValue,
    excluded: screen.excludesVisits
      ? words.hero.excluded(report.reportExcludedVisitCount)
      : null,
    accessibleName: [
      `${words.hero.caption} ${value}`,
      delta === null ? comparison : `${delta} ${comparison}`,
      `${words.hero.tips} ${tipsValue}`,
    ].join(', '),
  };
}

function comparisonOf(
  heroChange: HeroChange,
  rate: number | null,
  words: AnalyticsWords,
): string {
  switch (heroChange) {
    case HeroChange.None:
      return words.hero.noComparison;
    case HeroChange.Flat:
      return words.hero.flat;
    case HeroChange.Up:
    case HeroChange.Down:
      return rate === null ? words.hero.fromNothing : words.hero.versus;
  }
}

function timeOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsTimeVm {
  const { words } = input;
  const span = (minutes: number) => spanWords(minutes, words.spanWords);
  return {
    title: words.time.title,
    barName: words.time.barName,
    bars: timeBarsOf(input, report),
    segments: StaffAnalyticsSystem.barSegmentsOf(report).map((segment) => ({
      part: BAR_PART_HOOKS[segment.analyticsBarPart],
      share: segment.share,
      label: words.time.part[segment.analyticsBarPart],
      value: span(segment.minutes),
      testId: `analytics-bar-${BAR_PART_HOOKS[segment.analyticsBarPart]}`,
    })),
    ahead: words.time.ahead(
      span(report.reportBookedAheadMinutes),
      span(report.reportOpenMinutes),
    ),
    byDay: words.time.byDay,
  };
}

/** «вторник, 29.09». */
function dayWithWeekday(day: LocalDate, lang: string): string {
  return formatWallClock(day, null, lang, {
    weekday: 'long',
    day: 'numeric',
    month: '2-digit',
  });
}

function openOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
  screen: AnalyticsScreen,
): AnalyticsOpenVm {
  const { words } = input;
  const value = spanWords(report.reportBookableOpenMinutes, words.spanWords);
  const emptiest = screen.opensEmptiestDay
    ? report.reportEmptiestLocalDate
    : null;
  const dayName =
    emptiest === null ? null : dayWithWeekday(emptiest, words.lang);
  const detail =
    dayName === null ? words.open.none : words.open.emptiest(dayName);
  return {
    title: words.open.title,
    value,
    caption: words.open.caption,
    detail,
    link:
      emptiest === null
        ? null
        : {
            day: emptiest,
            view: 'agenda',
            barber: input.scheduleBarberId,
            free: '1',
          },
    bars: aheadBarsOf(input, report, emptiest),
    accessibleName:
      dayName === null
        ? `${words.open.title} ${value} ${words.open.caption}, ${detail}`
        : `${words.open.title} ${value} ${words.open.caption}, ${words.open.action(dayName)}`,
  };
}

/** The services ranked: a horizontal bar per service in the report's order (largest first), each opening its seats. */
function servicesOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
  screen: AnalyticsScreen,
): AnalyticsServicesVm {
  const { words } = input;
  const lang = words.lang;
  const rows = report.reportServices;
  return {
    title: words.services.title,
    bars: rows.map((row) => {
      const name =
        input.names.serviceName(row.serviceId) ?? words.unknownService;
      return {
        label:
          row.takingsPerHourCents === null
            ? name
            : words.services.barLabel(
                name,
                money(row.takingsPerHourCents, lang),
              ),
        parts: [
          {
            part: BAR_PART_HOOKS[AnalyticsBarPart.Worked],
            value: row.takingsCents,
          },
        ],
      };
    }),
    valueText: rows.map((row) =>
      words.services.barValue(
        money(row.takingsCents, lang),
        words.services.count(row.workedSeatCount),
      ),
    ),
    drills: rows.map((row) =>
      screen.drillsToSeats
        ? { analyticsFigure: AnalyticsFigure.Takings, serviceId: row.serviceId }
        : null,
    ),
    label: words.charts.services,
    empty: rows.length === 0 ? words.services.none : null,
  };
}

function clientsOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
  screen: AnalyticsScreen,
): AnalyticsClientsVm {
  const { words } = input;
  const lang = words.lang;
  const rateOr = (rate: number | null, count: number, base: number): string =>
    rate === null
      ? words.clients.ofBase(formatCount(count, lang), formatCount(base, lang))
      : formatPercent(rate, lang);
  const drill = (analyticsFigure: AnalyticsFigure): AnalyticsDrill => ({
    analyticsFigure,
    serviceId: null,
  });
  return {
    title: words.clients.title,
    rows: [
      {
        topic: AnalyticsTopic.Rebooked,
        label: words.figure[AnalyticsTopic.Rebooked],
        value: rateOr(
          report.reportRebookedRate,
          report.reportRebookedCount,
          report.reportRebookedBase,
        ),
        drill: drill(AnalyticsFigure.Rebooked),
        testId: 'analytics-rebooked',
      },
      {
        topic: AnalyticsTopic.NoShows,
        label: words.figure[AnalyticsTopic.NoShows],
        value: rateOr(
          report.reportNoShowRate,
          report.reportNoShowCount,
          report.reportNoShowBase,
        ),
        drill: drill(AnalyticsFigure.NoShows),
        testId: 'analytics-no-shows',
      },
      {
        topic: AnalyticsTopic.LateCancellations,
        label: words.figure[AnalyticsTopic.LateCancellations],
        value: formatCount(report.reportLateCancellationCount, lang),
        drill: drill(AnalyticsFigure.LateCancellations),
        testId: 'analytics-late-cancellations',
      },
    ],
    note: screen.smallSample ? words.smallSample : null,
  };
}

/** Where bookings come from: one stacked bar of the three origins, and a row per origin with its swatch. */
function originsOf(
  input: AnalyticsScreenInput,
  report: AnalyticsReport,
): AnalyticsOriginsVm {
  const { words } = input;
  const lang = words.lang;
  const shares = StaffAnalyticsSystem.originSharesOf(report);
  return {
    title: words.origins.title,
    bars: [
      {
        // The section's header names the bar; no word of its own.
        label: '',
        parts: report.reportOrigins.map((row) => ({
          part: ORIGIN_PART_HOOKS[row.bookingOrigin],
          value: row.visitCount,
        })),
      },
    ],
    label: words.charts.origins,
    rows: report.reportOrigins.map((row, i) => ({
      part: ORIGIN_PART_HOOKS[row.bookingOrigin],
      title: words.origins.origin[row.bookingOrigin],
      detail: words.origins.visits(row.visitCount),
      value: formatPercent(shares.at(i) ?? 0, lang),
      testId: `analytics-origin-${row.bookingOrigin.toLowerCase()}`,
    })),
  };
}

// ── The drill-down ────────────────────────────────────────────────────────

/** What a drill-down page is worded from. */
export interface AnalyticsDrillInput {
  readonly words: AnalyticsWords;
  readonly today: LocalDate;
  readonly report: AnalyticsReport;
  readonly drill: AnalyticsDrill;
  /** The report is the callable's answer, its seat rows held — a cached one keeps none. */
  readonly seatRowsHeld: boolean;
  readonly names: AnalyticsNames;
}

/** The drill-down page of one figure: its rows, and a footer equal to the figure. */
export function analyticsDrillVm(input: AnalyticsDrillInput): AnalyticsDrillVm {
  const { words, report, drill } = input;
  const screen = StaffAnalyticsSystem.screenOf(report);
  const topic = FIGURE_TOPICS[drill.analyticsFigure];
  const serviceName =
    drill.serviceId === null
      ? null
      : (input.names.serviceName(drill.serviceId) ?? words.unknownService);
  const base = {
    // eslint-disable-next-line security/detect-object-injection -- `topic` is a closed `AnalyticsTopic` literal.
    title: serviceName ?? words.figure[topic],
    // eslint-disable-next-line security/detect-object-injection -- as above.
    lede: words.info.definition[topic],
    footerLabel: words.drill.total,
    closeLabel: words.info.close,
    sections: [] as readonly VisitSectionVm[],
    days: [] as readonly AnalyticsDayRowVm[],
    barbers: [] as readonly AnalyticsBarberRowVm[],
    waiting: null,
  };
  if (screen.shopScope) {
    const barbers = report.reportBarbers.map((row) =>
      barberRowOf(row, drill.analyticsFigure, input),
    );
    return {
      ...base,
      drillRows: DrillRows.Barbers,
      barbers,
      empty: barbers.length === 0 ? words.drill.empty : null,
      footerValue: figureValueOf(report, drill.analyticsFigure, input),
    };
  }
  if (drill.analyticsFigure === AnalyticsFigure.Time) {
    const days = StaffAnalyticsSystem.dayRowsFor(report, {
      serviceId: null,
      localDate: null,
    }).map((row) => dayRowOf(row, input));
    return {
      ...base,
      drillRows: DrillRows.Days,
      days,
      empty: days.length === 0 ? words.drill.empty : null,
      footerValue: spanWords(report.reportWorkedMinutes, words.spanWords),
    };
  }
  const rows = StaffAnalyticsSystem.seatRowsFor(report, drill.analyticsFigure, {
    serviceId: drill.serviceId,
    localDate: null,
  });
  const total = StaffAnalyticsSystem.seatRowsTotalOf(
    rows,
    drill.analyticsFigure,
  );
  const lang = words.lang;
  return {
    ...base,
    drillRows: DrillRows.Seats,
    sections: sectionVisits(
      rows.map((row) => seatRowOf(row, drill.analyticsFigure, input)),
      {
        grain: VisitGrain.Month,
        labels: {
          upcoming: '',
          section: (key) => visitSectionLabel(key, lang),
        },
        testIdPrefix: 'analytics-seats',
      },
    ),
    waiting: input.seatRowsHeld ? null : words.drill.seatsLater,
    empty: input.seatRowsHeld && rows.length === 0 ? words.drill.empty : null,
    footerValue:
      drill.analyticsFigure === AnalyticsFigure.Takings ||
      drill.analyticsFigure === AnalyticsFigure.Tips
        ? money(total.totalCents, lang)
        : drill.analyticsFigure === AnalyticsFigure.Rebooked
          ? words.drill.rebookedTotal(
              formatCount(StaffAnalyticsSystem.rebookedCountOf(rows), lang),
              formatCount(total.rowCount, lang),
            )
          : words.drill.count(total.rowCount),
  };
}

/** The figure itself, as the shop drill-down's footer says it. */
function figureValueOf(
  report: AnalyticsReport,
  figure: AnalyticsFigure,
  input: AnalyticsDrillInput,
): string {
  const { words } = input;
  const lang = words.lang;
  switch (figure) {
    case AnalyticsFigure.Takings:
      return money(report.reportTakingsCents, lang);
    case AnalyticsFigure.Tips:
      return money(report.reportTipsCents, lang);
    case AnalyticsFigure.NoShows:
      return words.drill.count(report.reportNoShowCount);
    case AnalyticsFigure.LateCancellations:
      return words.drill.count(report.reportLateCancellationCount);
    case AnalyticsFigure.Rebooked:
      return words.drill.rebookedTotal(
        formatCount(report.reportRebookedCount, lang),
        formatCount(report.reportRebookedBase, lang),
      );
    case AnalyticsFigure.Time:
      return spanWords(report.reportWorkedMinutes, words.spanWords);
  }
}

function barberRowOf(
  row: AnalyticsReport.BarberFigures,
  figure: AnalyticsFigure,
  input: AnalyticsDrillInput,
): AnalyticsBarberRowVm {
  const { words } = input;
  const lang = words.lang;
  const name = input.names.barberName(row.barberId) ?? words.scope.barber;
  const span = (minutes: number) => spanWords(minutes, words.spanWords);
  const value = ((): string => {
    switch (figure) {
      case AnalyticsFigure.Takings:
        return money(row.takingsCents, lang);
      case AnalyticsFigure.Tips:
        return money(row.tipsCents, lang);
      case AnalyticsFigure.NoShows:
        return formatCount(row.noShowCount, lang);
      case AnalyticsFigure.LateCancellations:
        return formatCount(row.lateCancellationCount, lang);
      case AnalyticsFigure.Rebooked:
        return row.rebookedRate === null
          ? words.clients.ofBase(
              formatCount(row.rebookedCount, lang),
              formatCount(row.rebookedBase, lang),
            )
          : formatPercent(row.rebookedRate, lang);
      case AnalyticsFigure.Time:
        return span(row.workedMinutes);
    }
  })();
  const detail =
    figure === AnalyticsFigure.Time
      ? words.drill.barberLine(
          span(row.workedMinutes),
          span(row.rosteredMinutes),
        )
      : null;
  return {
    barberId: row.barberId,
    name,
    avatarSrc: input.names.barberAvatarSrc(row.barberId),
    detail,
    value,
    accessibleName: `${words.drill.openBarber(name)}, ${value}`,
    testId: `analytics-barber-${row.barberId}`,
  };
}

function dayRowOf(row: DayRow, input: AnalyticsDrillInput): AnalyticsDayRowVm {
  const { words } = input;
  const span = (minutes: number) => spanWords(minutes, words.spanWords);
  // Beyond 93 days the report's rows are months (the callable v2 contract);
  // a month opens the MONTH span.
  const monthly = StaffAnalyticsSystem.dayRowsAreMonths(input.report);
  return {
    id: `${row.barberId}__${row.localDate}`,
    title: monthly
      ? formatMonthLong(row.localDate, words.lang)
      : formatWallClock(row.localDate, null, words.lang, {
          weekday: 'short',
          day: 'numeric',
          month: '2-digit',
        }),
    month: monthly ? row.localDate : null,
    detail: words.drill.dayLine(
      span(row.dayRosteredMinutes),
      span(row.dayUnsoldMinutes),
    ),
    value: span(row.dayWorkedMinutes),
    testId: `analytics-day-${row.localDate}`,
  };
}

/**
 * One seat as a row of the shared visits list (`lib-visit-list`, ir-2-11):
 * the date tile, the service, the time, and the figure's own fact at the
 * end of the line — the seat's net, its tip, or its outcome in words. The
 * row id is the seat's within its visit, so two seats of one party are two
 * rows.
 */
function seatRowOf(
  row: AnalyticsReport.SeatRow,
  figure: AnalyticsFigure,
  input: AnalyticsDrillInput,
): AppointmentRowVm {
  const { words } = input;
  const lang = words.lang;
  const title = input.names.serviceName(row.serviceId) ?? words.unknownService;
  const time = formatMinute(row.startMinutes, lang);
  const day = LocalDate.parts(row.localDate);
  const fact = ((): AppointmentRowVm['trailingFact'] => {
    switch (figure) {
      case AnalyticsFigure.Takings:
        return amountFact(money(row.netCents, lang));
      case AnalyticsFigure.Tips:
        return amountFact(money(row.tipCents, lang));
      case AnalyticsFigure.NoShows:
        return statusFact('visit.noShow', words.drill.noShow, true);
      case AnalyticsFigure.LateCancellations:
        return statusFact('visit.cancelled', words.drill.late, true);
      case AnalyticsFigure.Rebooked:
        return row.seatRebooked === true
          ? statusFact('visit.repeat', words.drill.rebookedYes, false)
          : statusFact('visit.last', words.drill.rebookedNo, false);
      case AnalyticsFigure.Time:
        return null;
    }
  })();
  const factText = fact === null ? '' : `, ${fact.text}`;
  const dayName = formatDayShort(row.localDate, input.today, lang);
  return {
    id: AppointmentId.of(`${row.appointmentId}~${row.seatId}`),
    visitRowEntry: VisitRowEntry.Visit,
    localDate: row.localDate,
    startMinutes: row.startMinutes,
    sectionKey: row.localDate.slice(0, 7),
    upcoming: false,
    tile: {
      caption: formatWallClock(row.localDate, null, lang, { weekday: 'short' }),
      day: day.day,
      tone: 'past',
    },
    leadingIcon: null,
    title,
    struck: false,
    lines: [{ text: time }],
    quote: null,
    trailing: null,
    trailingFact: fact,
    marks: [],
    outcome: null,
    bookingStatus: null,
    accessibleName: `${title}, ${dayName} ${time}${factText}`,
    testId: `analytics-seat-${row.seatId}`,
  };
}

function amountFact(text: string): AppointmentRowVm['trailingFact'] {
  return {
    trailingFactFace: TrailingFactFace.Amount,
    text,
    emphasis: 'primary',
    struck: false,
  };
}

function statusFact(
  icon: 'visit.noShow' | 'visit.cancelled' | 'visit.repeat' | 'visit.last',
  text: string,
  warning: boolean,
): AppointmentRowVm['trailingFact'] {
  return {
    trailingFactFace: TrailingFactFace.Status,
    icon,
    text,
    tone: warning ? StatusFactTone.Warning : StatusFactTone.Neutral,
  };
}
