import type { StreakDefinitionVersion } from '@core/entities';
import { type LocalDate, Tag, type TimeZone } from '@core/primitives';
import { StreakRuleField } from '@core/errors';
import {
  RhythmEffectiveChoice,
  type StreakExcuse,
  StreakInterval,
  type StreakIntervalRule,
  StreakOnBreak,
  type StreakPreview,
  StreakPreviewOutcome,
  StreakQualifier,
  StreakRuleParameter,
  type StreakRuleInput,
  type StreakStandingCounts,
  type StreakState,
  type StreakTrackMark,
  StreakTrackMarkKind,
} from '@core/components';
import {
  RhythmDraftSystem,
  StreakPreviewSystem,
  StreakPublishSystem,
  StreakRuleSystem,
  StreakSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type RhythmClosedMark,
  type RhythmRuleWords,
  type VisitTranslate,
  isRhythmClosedMark,
  rhythmClosedMarkPeriod,
} from '@creativo/features/shared/visits';
import {
  pluralForm,
  streakPeriodReasonWords,
} from '@creativo/infrastructure/i18n';
import { formatCount, formatWallClock } from '@creativo/ui/wall-clock';
import type {
  UiChoiceOption,
  UiSliderMark,
  UiStreakPeriod,
} from '@creativo/ui/controls';
import { ADMIN_RHYTHM_CHOICES } from '../admin-rhythm.store';

/*
 * «РИТЪМ», THE ADMIN PAGE'S WORDS (client-card revision 3 §2.6, §6.1):
 * every sentence the page and its sheets print that is not a bare key, as
 * PURE functions over the catalogue's `translate`. The rule's own
 * sentences are `rhythmRuleWords` (shared); this file words what is the
 * page's alone: a value row's reading, a history row, the preview's
 * lines, the menus' options, the sample track's marks, a refused field's
 * name.
 *
 * A COUNT is a number (the words choose the plural form); a worded fact
 * is a string; an absent fact is `null`. The keys are `admin.rhythm.*`
 * (K1, K1b-5) plus the rule's units (`rhythmRule.*`, through the shared
 * words) and the track's descriptions (`clientCard.rhythm.*`, read by key).
 *
 * The rule is the FLAT `StreakRule` (a draft: `StreakRuleInput`), its tags
 * SCREAMING (`@core/components`); the keys and the test ids keep their
 * lowercase spelling through the words tables below, each
 * `satisfies Record<Dictionary, …>`, so the text on screen is unchanged. A
 * menu's option id is the domain tag itself (`StreakQualifier`,
 * `StreakInterval`, `StreakOnBreak`, `RhythmEffectiveChoice` — one
 * dictionary per tag family, never a copy): `ui-choice-menu` only tracks,
 * compares and hands back an id, so no id reaches the page.
 */

/** What every function below reads: the catalogue, the day and the rule's units. */
export interface AdminRhythmContext {
  readonly translate: VisitTranslate;
  readonly lang: string;
  /** The shop's today, read in its zone at the store's edge: a date in another year says its year. */
  readonly today: LocalDate;
  /** The shop's zone (Law 7.2): the day a version was published on is read in it. */
  readonly zone: TimeZone;
  /** «7 дни» · «6 седмици» — the rule's own units (`rhythmRuleWords(...).days / .weeks`). */
  readonly rule: Pick<RhythmRuleWords, 'days' | 'weeks'>;
}

const DAYS_IN_WEEK = 7;

// ── The words tables: a SCREAMING tag, its lowercase key ───────────────────

/** What counts, as its key (`admin.rhythm.history.change.qualifier.*`). */
const QUALIFIER_KEY = {
  [StreakQualifier.AnyVisit]: 'anyVisit',
  [StreakQualifier.Services]: 'services',
  [StreakQualifier.Categories]: 'categories',
} as const satisfies Record<StreakQualifier, string>;

/**
 * «shopClosure» — an excuse as its key and its test id
 * (`admin.rhythm.excuses.*`): the word of the shared
 * `streakPeriodReasonWords` table (`@creativo/infrastructure/i18n`), ONE
 * table for the `StreakExcuse` family.
 */
export function excuseKey(excuse: StreakExcuse): string {
  // eslint-disable-next-line security/detect-object-injection -- `excuse` is a member of the closed dictionary the table is total over.
  return streakPeriodReasonWords[excuse];
}

/** What a miss does, as its key (`admin.rhythm.onBreak.*`, `admin.rhythm.history.change.onBreak.*`). */
const ON_BREAK_KEY = {
  [StreakOnBreak.Restart]: 'restart',
  [StreakOnBreak.Hold]: 'hold',
} as const satisfies Record<StreakOnBreak, string>;

/** «restart» · «hold» — what a miss does, as its key (`admin.rhythm.onBreak.*`). */
export function onBreakKey(onBreak: StreakOnBreak): string {
  // eslint-disable-next-line security/detect-object-injection -- `onBreak` is a member of the closed dictionary the table is total over.
  return ON_BREAK_KEY[onBreak];
}

/**
 * The menu's id (a `StreakOnBreak` member, `ui-choice-menu`'s untyped
 * answer) back to what a miss does: `HOLD` holds the count, anything else
 * starts it over.
 */
export function onBreakOf(id: string): StreakOnBreak {
  return Tag.or(StreakOnBreak, id, StreakOnBreak.Restart);
}

/** The typographic minus, as the spec draws a signed figure. */
const MINUS = '−';

// ── Dates (the house form, R59; the shared wall-clock face) ────────────────

/** A shop day in the locale's form, on the cached wall-clock formatter (read back in UTC, no `Date` built). */
function formatDay(
  day: LocalDate,
  lang: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return formatWallClock(day, null, lang, options);
}

const yearUnlessCurrent = (
  day: LocalDate,
  today: LocalDate,
): Pick<Intl.DateTimeFormatOptions, 'year'> =>
  day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' };

/** «1.09» · «1.03.2025 г.» — a capsule's or a row's date, the year only outside today's. */
export function shortDay(
  day: LocalDate,
  today: LocalDate,
  lang: string,
): string {
  return formatDay(day, lang, {
    day: 'numeric',
    month: '2-digit',
    ...yearUnlessCurrent(day, today),
  });
}

/** «4 септември» — a date someone hears. */
export function longDay(
  day: LocalDate,
  today: LocalDate,
  lang: string,
): string {
  return formatDay(day, lang, {
    day: 'numeric',
    month: 'long',
    ...yearUnlessCurrent(day, today),
  });
}

/** «септември» — the month in words (a track mark's description). */
export function monthWord(day: LocalDate, lang: string): string {
  return formatDay(day, lang, { month: 'long' });
}

// ── Counting ─────────────────────────────────────────────────────────────

/** A counted sentence in the count's plural: `key.one` / `key.other`. */
function counted(
  context: AdminRhythmContext,
  key: string,
  count: number,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return context.translate(`${key}.${pluralForm(count, context.lang)}`, {
    count,
    ...params,
  });
}

/**
 * «12 450» — a figure grouped the language's way, through the shared
 * cached `formatCount` (pass E, E-12).
 */
function figure(context: AdminRhythmContext, value: number): string {
  return formatCount(value, context.lang);
}

/**
 * «+17» · «−3» — a movement the system measured, signed; `null` for none
 * (the zero form and the sign glyph are the words', D-2.2/D-2.3).
 */
function signedMovement(
  context: AdminRhythmContext,
  delta: number,
): string | null {
  if (delta === 0) return null;
  return delta > 0
    ? `+${figure(context, delta)}`
    : `${MINUS}${figure(context, -delta)}`;
}

/** Days ↔ weeks, as the interval is edited in weeks and held in days: `RhythmDraftSystem`'s unit arithmetic. */
export const weeksOf = (days: number): number =>
  RhythmDraftSystem.weeksOf(days);
export const daysOf = (weeks: number): number =>
  RhythmDraftSystem.daysOf(weeks);

// ── The menus ────────────────────────────────────────────────────────────

const option = (id: string, label: string, testId: string): UiChoiceOption => ({
  id,
  label,
  testId: `admin-rhythm-option-${testId}`,
});

/** P2 «Брои се»: every completed visit, or a visit with chosen services. */
export function qualifierOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  const t = context.translate;
  return [
    option(
      StreakQualifier.AnyVisit,
      t('admin.rhythm.counts.any'),
      'qualifier-anyVisit',
    ),
    option(
      StreakQualifier.Services,
      t('admin.rhythm.counts.services'),
      'qualifier-services',
    ),
  ];
}

/** P5 «Срок»: the same for everyone, or by the client's habit. */
export function intervalOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  const t = context.translate;
  return [
    option(
      StreakInterval.Fixed,
      t('admin.rhythm.interval.fixed'),
      'interval-fixed',
    ),
    option(
      StreakInterval.Personal,
      t('admin.rhythm.interval.personal'),
      'interval-personal',
    ),
  ];
}

/** A menu of day counts («3 дни»), ids the figures. */
function dayOptions(
  context: AdminRhythmContext,
  days: readonly number[],
  testId: string,
): readonly UiChoiceOption[] {
  return days.map((count) =>
    option(String(count), context.rule.days(count), `${testId}-${count}`),
  );
}

/** P7 «Подсети екипа преди срока»: 0 · 3 · 7 · 14 days. */
export function riskLeadOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  return dayOptions(context, ADMIN_RHYTHM_CHOICES.riskLeadDays, 'risk-lead');
}

/** P8b «Нова защита»: «на всеки N посещения». */
export function earnEveryOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  return ADMIN_RHYTHM_CHOICES.earnEvery.map((count) =>
    option(
      String(count),
      counted(context, 'admin.rhythm.protections.everyValue', count),
      `protections-every-${count}`,
    ),
  );
}

/** P10 «До колко дни годишно»: 30 · 60 · 90. */
export function pauseDaysOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  return dayOptions(
    context,
    ADMIN_RHYTHM_CHOICES.pauseDaysPerYear,
    'pause-days',
  );
}

/** P11 «В рамките на»: 7 · 14 · 21 · 30 days. */
export function repairWindowOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  return dayOptions(
    context,
    ADMIN_RHYTHM_CHOICES.repairWindowDays,
    'repair-window',
  );
}

/** P11 «Пъти годишно»: 1 · 2 · 3, bare figures. */
export function repairPerYearOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  return ADMIN_RHYTHM_CHOICES.repairPerYear.map((count) =>
    option(String(count), figure(context, count), `repair-per-year-${count}`),
  );
}

/** P12 «Ритъмът»: starts over, or continues from there. */
export function onBreakOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  const t = context.translate;
  return [
    option(
      StreakOnBreak.Restart,
      t('admin.rhythm.onBreak.restart'),
      'on-break-restart',
    ),
    option(StreakOnBreak.Hold, t('admin.rhythm.onBreak.hold'), 'on-break-hold'),
  ];
}

/** P13 «От»: tomorrow, the first of next month, a day of the admin's own (`RhythmEffectiveChoice`). */
export function effectiveOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  const t = context.translate;
  return [
    option(
      RhythmEffectiveChoice.Tomorrow,
      t('admin.rhythm.effective.tomorrow'),
      'effective-tomorrow',
    ),
    option(
      RhythmEffectiveChoice.FirstOfMonth,
      t('admin.rhythm.effective.firstOfMonth'),
      'effective-first-of-month',
    ),
    option(
      RhythmEffectiveChoice.Picked,
      t('admin.rhythm.effective.pick'),
      'effective-pick',
    ),
  ];
}

/**
 * Which of P13's three the day in hand is — `RhythmDraftSystem.effectiveChoiceOf`'s
 * answer (tomorrow wins a tie) — and the trigger's reading: «От утре»,
 * «От 1-во число», or the day itself («от 12.10»).
 */
export function effectiveReading(
  context: AdminRhythmContext,
  day: LocalDate,
  days: { readonly tomorrow: LocalDate; readonly firstOfMonth: LocalDate },
): { readonly choice: RhythmEffectiveChoice; readonly label: string } {
  const t = context.translate;
  const choice = RhythmDraftSystem.effectiveChoiceOf(day, days);
  switch (choice) {
    case RhythmEffectiveChoice.Tomorrow:
      return { choice, label: t('admin.rhythm.effective.tomorrow') };
    case RhythmEffectiveChoice.FirstOfMonth:
      return { choice, label: t('admin.rhythm.effective.firstOfMonth') };
    case RhythmEffectiveChoice.Picked:
      return {
        choice,
        label: t('admin.rhythm.effective.picked', {
          date: shortDay(day, context.today, context.lang),
        }),
      };
  }
}

// ── The sliders' marks ───────────────────────────────────────────────────

/**
 * The weeks under the interval's ruler: EVENLY spaced, every six weeks from
 * the floor to the ceiling, so the words read as a scale (every third
 * major tick is named, as the grace ruler names every seventh day). The
 * value is the readout's alone («6 седмици»); a label never stands for it.
 */
const WEEK_MARKS = [2, 8, 14, 20, 26] as const;
/** The days under the grace ruler. */
const GRACE_MARKS = [0, 7, 14, 21] as const;
/** The percents under the tolerance ruler. */
const TOLERANCE_MARKS = [0, 50, 100] as const;

const marksUpTo = (
  values: readonly number[],
  max: number,
  label: (value: number) => string = String,
): readonly UiSliderMark[] =>
  values
    .filter((value) => value <= max)
    .map((value) => ({ value, label: label(value) }));

export const weekMarks = (): readonly UiSliderMark[] =>
  marksUpTo(WEEK_MARKS, WEEK_MARKS[WEEK_MARKS.length - 1] ?? 26);

/** The grace ruler's marks end where the ruler does (it follows the interval). */
export const graceMarks = (max: number): readonly UiSliderMark[] =>
  marksUpTo(GRACE_MARKS, max);

export const toleranceMarks = (): readonly UiSliderMark[] =>
  marksUpTo(TOLERANCE_MARKS, 100, (value) => `${value} %`);

// ── The value rows ───────────────────────────────────────────────────────

/** «3 услуги» — the services row's trailing. */
export function servicesCount(
  context: AdminRhythmContext,
  count: number,
): string {
  return counted(context, 'admin.rhythm.counts.servicesCount', count);
}

/** «До 2 в запас» · «Изключени» — the protections row. */
export function protectionsRow(
  context: AdminRhythmContext,
  draft: StreakRuleInput,
): string {
  const t = context.translate;
  return draft.protectionsEnabled
    ? t('admin.rhythm.row.protections', { count: draft.protectionsMaxBanked })
    : t('admin.rhythm.row.protectionsOff');
}

/** «3 от 4» · «3 от 4 · пауза до 90 дни» — the excuses row. */
export function excusesRow(
  context: AdminRhythmContext,
  draft: StreakRuleInput,
): string {
  const t = context.translate;
  const { on, all } = StreakRuleSystem.excuseCount(draft);
  return draft.clientPauseEnabled
    ? t('admin.rhythm.row.excusesPause', {
        on,
        all,
        days: context.rule.days(draft.clientPauseMaxDaysPerYear),
      })
    : t('admin.rhythm.row.excuses', { on, all });
}

/** «Започва отначало» · «Продължава оттам» — the after-a-miss row. */
export function afterMissRow(
  context: AdminRhythmContext,
  draft: StreakRuleInput,
): string {
  return context.translate(`admin.rhythm.onBreak.${onBreakKey(draft.onBreak)}`);
}

/**
 * THE JOINT of a fact line («гратис 7 дни · защити до 2 в запас»): the dot
 * stays with the word before it — the ledger's and the visit card's joint —
 * so a line that wraps ends on the dot and never opens with one (seen at
 * 330: «· извинения 3 от 4» on a line of its own).
 */
const JOINT = '\u00a0· ';

/** A sentence the catalogue joins on ` · ` takes the same joint. */
function jointed(text: string): string {
  return text.replaceAll(' · ', JOINT);
}

/** What the rule card digests under its sentence, in the rule's order (§2.6.1 MC). */
const DIGEST_ORDER: readonly StreakRuleParameter[] = [
  StreakRuleParameter.GraceDays,
  StreakRuleParameter.Protections,
  StreakRuleParameter.Excuses,
];

/**
 * «гратис 7 дни · защити до 2 в запас · извинения 3 от 4» — the rule
 * card's DIGEST: one `·`-joined callout line under the live sentence
 * (§2.6.1 draws it two lines long), in place of the rule's seven clauses,
 * which the sheets' footnotes and the client card's «Цялото правило» keep.
 * The three facts are the quieter parameters' own change words (the
 * history's fragments, lowercase facts that join on a `·`), so a figure
 * reads here as it reads in the history. `null` while the rule is off: an
 * off rule says only that it is off.
 */
export function ruleDigest(
  context: AdminRhythmContext,
  draft: StreakRuleInput,
): string | null {
  if (!draft.enabled) return null;
  return DIGEST_ORDER.map((parameter) => changeWord(context, parameter, draft))
    .filter((word): word is string => word !== null)
    .join(JOINT);
}

/** «+50 %» — the personal interval's readout. */
export function toleranceReadout(
  context: AdminRhythmContext,
  percent: number,
): string {
  return context.translate('admin.rhythm.interval.tolerance', { percent });
}

/** The habit the tolerance is explained on: a client who comes every four weeks. */
const EXAMPLE_HABIT_DAYS = 28;

/**
 * «Клиент, който идва на 4 седмици, има срок 6 седмици.» — the tolerance
 * explained on one habit. The period is the rule's own
 * (`StreakRuleSystem.exampleDue`, through `StreakIntervalRule.daysFor`),
 * never a copy of it.
 */
export function toleranceExample(
  context: AdminRhythmContext,
  interval: StreakIntervalRule.Personal,
): string {
  const due = StreakRuleSystem.exampleDue(interval, EXAMPLE_HABIT_DAYS);
  return context.translate('admin.rhythm.interval.example', {
    habit: context.rule.weeks(weeksOf(EXAMPLE_HABIT_DAYS)),
    interval: context.rule.weeks(weeksOf(due.days)),
  });
}

/** «В сила от 1.09» · «От 1.10» — the rule card's capsule. */
export function inForceCapsule(
  context: AdminRhythmContext,
  day: LocalDate,
  scheduled: boolean,
): string {
  return context.translate(
    scheduled ? 'admin.rhythm.scheduled' : 'admin.rhythm.inForce',
    { date: shortDay(day, context.today, context.lang) },
  );
}

/** «От 1.10: на всеки 5 седмици» — the waiting version's line under the rule. */
export function upcomingLine(
  context: AdminRhythmContext,
  day: LocalDate,
  short: string,
): string {
  return context.translate('rhythmRule.upcoming', {
    date: shortDay(day, context.today, context.lang),
    rule: short,
  });
}

// ── The history ──────────────────────────────────────────────────────────

/**
 * One parameter's change, lower case, no stop (`admin.rhythm.history.change.*`).
 * The parameter is read as a stored version lists it: anything that is no
 * `StreakRuleParameter` (a version's identity — its number, its day) is no
 * change and says nothing (`null`).
 */
export function changeWord(
  context: AdminRhythmContext,
  parameter: string,
  rule: StreakRuleInput,
): string | null {
  const t = context.translate;
  const { days, weeks } = context.rule;
  const key = 'admin.rhythm.history.change';
  switch (parameter) {
    case StreakRuleParameter.Name:
      return t(`${key}.name`);
    case StreakRuleParameter.Enabled:
      return t(`${key}.enabled.${rule.enabled ? 'on' : 'off'}`);
    case StreakRuleParameter.Qualifier:
      return t(`${key}.qualifier.${QUALIFIER_KEY[rule.streakQualifier]}`);
    case StreakRuleParameter.MinGapDays:
      return t(`${key}.minGapDays`, { days: days(rule.minGapDays) });
    case StreakRuleParameter.BookingHold:
      return rule.bookingHoldEnabled
        ? t(`${key}.bookingHold.on`, {
            days: days(rule.bookingHoldMaxDaysPastDue),
          })
        : t(`${key}.bookingHold.off`);
    case StreakRuleParameter.Interval:
      return rule.streakInterval === StreakInterval.Fixed
        ? t(`${key}.interval.fixed`, {
            interval: weeks(rule.intervalDays / DAYS_IN_WEEK),
          })
        : t(`${key}.interval.personal`);
    case StreakRuleParameter.GraceDays:
      return rule.graceDays > 0
        ? t(`${key}.graceDays.days`, { days: days(rule.graceDays) })
        : t(`${key}.graceDays.none`);
    case StreakRuleParameter.RiskLeadDays:
      return rule.riskLeadDays > 0
        ? t(`${key}.riskLeadDays.days`, { days: days(rule.riskLeadDays) })
        : t(`${key}.riskLeadDays.none`);
    case StreakRuleParameter.Protections:
      return rule.protectionsEnabled
        ? t(`${key}.protections.on`, { count: rule.protectionsMaxBanked })
        : t(`${key}.protections.off`);
    case StreakRuleParameter.Excuses: {
      const { on, all } = StreakRuleSystem.excuseCount(rule);
      return t(`${key}.excuses`, { on, all });
    }
    case StreakRuleParameter.ClientPause:
      return rule.clientPauseEnabled
        ? t(`${key}.clientPause.on`, {
            days: days(rule.clientPauseMaxDaysPerYear),
          })
        : t(`${key}.clientPause.off`);
    case StreakRuleParameter.Repair:
      return rule.repairEnabled
        ? t(`${key}.repair.on`, { days: days(rule.repairWindowDays) })
        : t(`${key}.repair.off`);
    case StreakRuleParameter.OnBreak:
      return t(`${key}.onBreak.${onBreakKey(rule.onBreak)}`);
    default:
      return null;
  }
}

/**
 * The changes a version made, each worded, in the order and the selection
 * `StreakRuleSystem.changesInRuleOrder` gives (the rule's parts, the name
 * last; what is no parameter left out).
 */
function changeWords(
  context: AdminRhythmContext,
  changed: readonly string[],
  rule: StreakRuleInput,
): readonly string[] {
  return StreakRuleSystem.changesInRuleOrder(changed)
    .map((parameter) => changeWord(context, parameter, rule))
    .filter((word): word is string => word !== null);
}

/** One row of «История». */
export interface AdminRhythmHistoryRow {
  readonly version: number;
  /** «От 1.09 · интервал 6 седмици» · «От 1.03.2025 г. · първо правило». */
  readonly title: string;
  /** «Иван · 28.08» · «системата» (the day said once: see `historyRow`). */
  readonly by: string;
  /** Called off, or replaced, before its day: drawn quiet. */
  readonly withdrawn: boolean;
}

/**
 * A version as the history lists it: the day it took (or takes) effect
 * and what it changed — the first change in the rule's order, and how
 * many more («… и още 2»); the first version says «първо правило». The
 * by-line names the publisher: «системата» for the seed, else the uid
 * the server wrote (the page knows no staff directory: a delta) — and
 * the day it was published (its Sofia day) ONLY when that is another day
 * than the one the title opens with (a rule saved on its own day, the
 * seed's first rule among them, would say the date twice: the
 * wireframe's «системата» stands alone). The version IS the flat rule.
 */
export function historyRow(
  context: AdminRhythmContext,
  version: StreakDefinitionVersion,
): AdminRhythmHistoryRow {
  const t = context.translate;
  const { today, lang } = context;
  const words = changeWords(context, version.changed, version);
  const [first] = words;
  const change =
    first === undefined
      ? t('admin.rhythm.history.first')
      : words.length > 1
        ? t('admin.rhythm.history.more', {
            change: first,
            count: words.length - 1,
          })
        : first;
  const name: string = StreakPublishSystem.isSystemPublisher(version)
    ? t('admin.rhythm.history.system')
    : version.publishedByUserId;
  const publishedOn = ZonedTimeSystem.toLocal(
    version.publishedAtUtcMs,
    context.zone,
  ).localDate;
  return {
    version: version.version,
    title: jointed(
      t('admin.rhythm.history.row', {
        date: shortDay(version.effectiveFromLocalDate, today, lang),
        change,
      }),
    ),
    by:
      publishedOn === version.effectiveFromLocalDate
        ? name
        : t('admin.rhythm.history.by', {
            name,
            date: shortDay(publishedOn, today, lang),
          }),
    withdrawn: version.withdrawnAtUtcMs !== null,
  };
}

// ── The preview ──────────────────────────────────────────────────────────

/**
 * The preview's three figures — the field `id` of a metric, the ONLY source
 * of these strings (Law 1). Values: external contract — each is the
 * figure's test-id segment (`admin-rhythm-preview-<id>`), so the spelling
 * stays as the page prints it.
 */
export const RhythmPreviewMetric = {
  /** Clients in their rhythm. */
  InRhythm: 'inRhythm',
  /** Clients past their due date, inside the grace. */
  InGrace: 'inGrace',
  /** Clients whose rhythm is broken. */
  Broken: 'broken',
} as const;
export type RhythmPreviewMetric =
  (typeof RhythmPreviewMetric)[keyof typeof RhythmPreviewMetric];

/** One of the preview's three figures. */
export interface AdminRhythmPreviewMetric {
  readonly id: RhythmPreviewMetric;
  /** «В ритъм». */
  readonly caption: string;
  /** The count under the new rule, «148». */
  readonly value: string;
  /** «+17» · «−3»; `null` when the count does not move. */
  readonly delta: string | null;
  /** «В ритъм: 131 → 148» — what a reader hears. */
  readonly label: string;
}

/**
 * What «Какво ще се промени» can say — the field `rhythmEstimate`, the ONLY
 * source of these strings (Law 6): the estimate, or why there is none.
 */
export const RhythmEstimate = {
  /** The counts the draft would move. */
  Estimate: 'ESTIMATE',
  /** No estimate for this draft (the line says why). */
  Unavailable: 'UNAVAILABLE',
} as const;
export type RhythmEstimate =
  (typeof RhythmEstimate)[keyof typeof RhythmEstimate];

/** «Какво ще се промени», worded. */
export type RhythmEstimateLine =
  | {
      readonly rhythmEstimate: typeof RhythmEstimate.Estimate;
      /** «214 клиенти с посещение за 12 месеца». */
      readonly clients: string;
      /** «от първите 1 000 клиенти»; `null` unless the walk stopped short. */
      readonly capped: string | null;
      /** Three figures; empty while either rule is off (an off rule judges nobody). */
      readonly metrics: readonly AdminRhythmPreviewMetric[];
      /** «17 се връщат в ритъм · никой не излиза от ритъм». */
      readonly summary: string;
    }
  | {
      readonly rhythmEstimate: typeof RhythmEstimate.Unavailable;
      readonly reason: string;
    };

/** One standing's count, read by name (no dynamic index). */
function standingOf(
  counts: StreakStandingCounts,
  id: RhythmPreviewMetric,
): number {
  switch (id) {
    case RhythmPreviewMetric.InRhythm:
      return counts.inRhythm;
    case RhythmPreviewMetric.InGrace:
      return counts.inGrace;
    case RhythmPreviewMetric.Broken:
      return counts.broken;
  }
}

const STANDINGS = [
  [RhythmPreviewMetric.InRhythm, 'admin.rhythm.preview.inRhythm'],
  [RhythmPreviewMetric.InGrace, 'admin.rhythm.preview.inGrace'],
  [RhythmPreviewMetric.Broken, 'admin.rhythm.preview.broken'],
] as const;

export function previewWords(
  context: AdminRhythmContext,
  preview: StreakPreview,
  capped: boolean,
  cap: number,
): RhythmEstimateLine {
  const t = context.translate;
  if (preview.streakPreviewOutcome === StreakPreviewOutcome.Unavailable) {
    return {
      rhythmEstimate: RhythmEstimate.Unavailable,
      reason: t('admin.rhythm.preview.unavailable'),
    };
  }
  const { before, after } = preview;
  // How far each standing moves is the system's (`movement`): `null` while
  // either rule is off, and then there are no figures to say.
  const moved = StreakPreviewSystem.movement(before, after);
  const metrics: AdminRhythmPreviewMetric[] =
    before === null || after === null || moved === null
      ? []
      : STANDINGS.map(([id, key]) => {
          const caption = t(key);
          const from = standingOf(before, id);
          const to = standingOf(after, id);
          return {
            id,
            caption,
            value: figure(context, to),
            delta: signedMovement(context, standingOf(moved, id)),
            label: `${caption}: ${t('admin.rhythm.preview.delta', {
              from: figure(context, from),
              to: figure(context, to),
            })}`,
          };
        });
  const back =
    preview.back === 0
      ? t('admin.rhythm.preview.nobodyBack')
      : counted(context, 'admin.rhythm.preview.back', preview.back);
  const out =
    preview.out === 0
      ? t('admin.rhythm.preview.nobodyOut')
      : counted(context, 'admin.rhythm.preview.out', preview.out);
  return {
    rhythmEstimate: RhythmEstimate.Estimate,
    clients: counted(context, 'admin.rhythm.preview.clients', preview.clients),
    capped: capped
      ? t('admin.rhythm.preview.capped', { count: figure(context, cap) })
      : null,
    metrics,
    summary: jointed(t('admin.rhythm.preview.summary', { back, out })),
  };
}

// ── The sample track ─────────────────────────────────────────────────────

/** A closed period of the sample, worded (`rhythmClosedMarkPeriod`, the card's word source too); its id is its mark, its day and its place in the run. */
function sampleClosed(
  context: AdminRhythmContext,
  mark: RhythmClosedMark,
  index: number,
): UiStreakPeriod {
  const t = context.translate;
  const { today, lang } = context;
  return rhythmClosedMarkPeriod(
    mark,
    {
      idSuffix: `-${index}`,
      month: (on) => monthWord(on, lang),
      day: (on) => shortDay(on, today, lang),
    },
    {
      kept: (period, date) =>
        t('clientCard.rhythm.mark.kept', { period, date }),
      repaired: (period) => t('clientCard.rhythm.mark.repaired', { period }),
      protected: (period, reason) =>
        t('clientCard.rhythm.mark.protected', { period, reason }),
      missed: (period) => t('clientCard.rhythm.mark.missed', { period }),
      reason: (word) => t(`clientCard.rhythm.reason.${word}`),
    },
  );
}

/** The sample's open period: covered while a protection carries it, else the due date. */
function sampleOpen(
  context: AdminRhythmContext,
  mark: StreakTrackMark,
): UiStreakPeriod {
  return {
    id: 'current',
    mark:
      mark.streakTrackMarkKind === StreakTrackMarkKind.Protected
        ? 'protected'
        : 'current',
    caption: '',
    description: context.translate('clientCard.rhythm.mark.current', {
      date: longDay(mark.on, context.today, context.lang),
    }),
  };
}

/**
 * The sample client's periods as the track draws them
 * (`StreakSystem.track`, which picks and dates the marks): the
 * projection's closed periods (a visit that kept the run, a due date
 * covered or missed, the visit that restored it), then the open one —
 * nobody in the chair, not paused, nothing cut. The sample's facts are
 * visits alone, so a FROZEN open mark's day is its due date (§7 R-12,
 * proven in `streak.system.spec.ts`). Captions are empty: the small track
 * draws none, and the rule card says the rule.
 */
export function samplePeriods(
  context: AdminRhythmContext,
  state: StreakState,
): readonly UiStreakPeriod[] {
  const track = StreakSystem.track(state, {
    today: context.today,
    inChairToday: false,
    paused: false,
    limit: state.periods.length + 1,
  });
  return track.marks.map((mark, index) =>
    mark.open || !isRhythmClosedMark(mark)
      ? sampleOpen(context, mark)
      : sampleClosed(context, mark, index),
  );
}

/** «6 посещения в ритъм» — the sample track's name. */
export function sampleLabel(
  context: AdminRhythmContext,
  state: StreakState,
): string {
  return counted(context, 'clientCard.rhythm.label', state.current, {
    best: '',
    next: '',
  });
}

/** «в ритъм» — the word under the sample's figure (the glance's tile says the same). */
export function sampleUnit(context: AdminRhythmContext): string {
  return context.translate('clientCard.loyalty.rhythmLabel');
}

// ── A refused field ──────────────────────────────────────────────────────

/**
 * The control's label for a field the domain or the server refused
 * («Поправи: Гратисен период.»), named by its flat `StreakRuleField`; a
 * field the page does not know is said as written.
 */
export function fieldName(context: AdminRhythmContext, field: string): string {
  const t = context.translate;
  const key = 'admin.rhythm';
  switch (field) {
    case StreakRuleField.QualifierKind:
      return t(`${key}.counts.label`);
    case StreakRuleField.QualifierServiceIds:
    case StreakRuleField.QualifierCategoryIds:
      return t(`${key}.counts.servicesRow`);
    case StreakRuleField.MinGapDays:
      return t(`${key}.counts.minGap`);
    case StreakRuleField.BookingHoldMaxDaysPastDue:
      return t(`${key}.counts.holdDays`);
    case StreakRuleField.IntervalKind:
    case StreakRuleField.IntervalDays:
      return t(`${key}.interval.label`);
    case StreakRuleField.IntervalTolerancePct:
      return t(`${key}.interval.personal`);
    case StreakRuleField.IntervalMinDays:
      return t(`${key}.interval.min`);
    case StreakRuleField.IntervalMaxDays:
      return t(`${key}.interval.max`);
    case StreakRuleField.IntervalFallbackDays:
      return t(`${key}.interval.fallback`);
    case StreakRuleField.GraceDays:
      return t(`${key}.grace.title`);
    case StreakRuleField.RiskLeadDays:
      return t(`${key}.grace.lead`);
    case StreakRuleField.ProtectionsMaxBanked:
      return t(`${key}.protections.max`);
    case StreakRuleField.ProtectionsEarnEvery:
      return t(`${key}.protections.every`);
    case StreakRuleField.ProtectionsStartWith:
      return t(`${key}.protections.first`);
    case StreakRuleField.Excuses:
      return t(`${key}.excuses.title`);
    case StreakRuleField.ClientPauseMaxDaysPerYear:
      return t(`${key}.pause.days`);
    case StreakRuleField.RepairWindowDays:
      return t(`${key}.repair.window`);
    case StreakRuleField.RepairPerYear:
      return t(`${key}.repair.perYear`);
    case StreakRuleField.OnBreak:
      return t(`${key}.onBreak.label`);
    case StreakRuleField.EffectiveFromLocalDate:
    case StreakRuleField.ScheduledEffectiveFromLocalDate:
      return t(`${key}.effective.from`);
    default:
      return field;
  }
}

/**
 * «Гратисен период и Срок» — the fields an `INVALID` refusal names, each
 * once, as a list: the `{{field}}` the page spreads over the struct when it
 * words `errors.LOYALTY_STREAK_PUBLISH_INVALID` («Поправи: {{field}}.»).
 */
export function refusedFields(
  context: AdminRhythmContext,
  fields: readonly string[],
): string {
  const names = fields
    .map((field) => fieldName(context, field))
    .filter((name, index, all) => all.indexOf(name) === index);
  return new Intl.ListFormat(context.lang, { type: 'conjunction' }).format(
    names,
  );
}
