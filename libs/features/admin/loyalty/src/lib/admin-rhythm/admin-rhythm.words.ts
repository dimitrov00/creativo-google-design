import {
  type IsoDate,
  STREAK_EXCUSES,
  type StreakDefinitionProps,
  type StreakDefinitionVersion,
  type StreakPreview,
  type StreakRuleChange,
  type StreakStandingCounts,
  type StreakState,
  sofiaDayOf,
} from '@creativo/application/engagement';
import type {
  RhythmRuleWords,
  VisitTranslate,
} from '@creativo/features/shared/visits';
import { pluralForm } from '@creativo/infrastructure/i18n';
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
 */

/** What every function below reads: the catalogue, the day and the rule's units. */
export interface AdminRhythmContext {
  readonly translate: VisitTranslate;
  readonly lang: string;
  /** The shop's today: a date in another year says its year. */
  readonly today: IsoDate;
  /** «7 дни» · «6 седмици» — the rule's own units (`rhythmRuleWords(...).days / .weeks`). */
  readonly rule: Pick<RhythmRuleWords, 'days' | 'weeks'>;
}

const DAYS_IN_WEEK = 7;

/** The typographic minus, as the spec draws a signed figure. */
const MINUS = '−';

// ── Dates (the house form, R59; the card's formatter is another feature's) ──

/** A `YYYY-MM-DD` shop day as a `Date` that reads back as that day in UTC. */
function noonOf(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12, 0, 0),
  );
}

function formatDay(
  day: string,
  lang: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' }).format(
    noonOf(day),
  );
}

const yearUnlessCurrent = (
  day: string,
  today: string,
): Pick<Intl.DateTimeFormatOptions, 'year'> =>
  day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' };

/** «1.09» · «1.03.2025 г.» — a capsule's or a row's date, the year only outside today's. */
export function shortDay(day: IsoDate, today: IsoDate, lang: string): string {
  return formatDay(day, lang, {
    day: 'numeric',
    month: '2-digit',
    ...yearUnlessCurrent(day, today),
  });
}

/** «4 септември» — a date someone hears. */
export function longDay(day: IsoDate, today: IsoDate, lang: string): string {
  return formatDay(day, lang, {
    day: 'numeric',
    month: 'long',
    ...yearUnlessCurrent(day, today),
  });
}

/** «септември» — the month in words (a track mark's description). */
export function monthWord(day: IsoDate, lang: string): string {
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

/** «1 000» — a figure grouped the language's way. */
function figure(context: AdminRhythmContext, value: number): string {
  return new Intl.NumberFormat(context.lang).format(value);
}

/** «+17» · «−3»; `null` for no change. */
export function signedDelta(
  context: AdminRhythmContext,
  from: number,
  to: number,
): string | null {
  const delta = to - from;
  if (delta === 0) return null;
  return delta > 0
    ? `+${figure(context, delta)}`
    : `${MINUS}${figure(context, -delta)}`;
}

/** Days ↔ weeks, as the interval is edited in weeks and held in days. */
export const weeksOf = (days: number): number =>
  Math.round(days / DAYS_IN_WEEK);
export const daysOf = (weeks: number): number => weeks * DAYS_IN_WEEK;

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
    option('anyVisit', t('admin.rhythm.counts.any'), 'qualifier-anyVisit'),
    option('services', t('admin.rhythm.counts.services'), 'qualifier-services'),
  ];
}

/** P5 «Срок»: the same for everyone, or by the client's habit. */
export function intervalOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  const t = context.translate;
  return [
    option('fixed', t('admin.rhythm.interval.fixed'), 'interval-fixed'),
    option(
      'personal',
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
    option('restart', t('admin.rhythm.onBreak.restart'), 'on-break-restart'),
    option('hold', t('admin.rhythm.onBreak.hold'), 'on-break-hold'),
  ];
}

/** P13 «От»: tomorrow, the first of next month, a day of the admin's own. */
export type EffectiveChoice = 'tomorrow' | 'firstOfMonth' | 'pick';

export function effectiveOptions(
  context: AdminRhythmContext,
): readonly UiChoiceOption[] {
  const t = context.translate;
  return [
    option(
      'tomorrow',
      t('admin.rhythm.effective.tomorrow'),
      'effective-tomorrow',
    ),
    option(
      'firstOfMonth',
      t('admin.rhythm.effective.firstOfMonth'),
      'effective-first-of-month',
    ),
    option('pick', t('admin.rhythm.effective.pick'), 'effective-pick'),
  ];
}

/**
 * Which of P13's three the day in hand is, and the trigger's reading:
 * «От утре», «От 1-во число», or the day itself («от 12.10»).
 */
export function effectiveReading(
  context: AdminRhythmContext,
  day: IsoDate,
  days: { readonly tomorrow: IsoDate; readonly firstOfMonth: IsoDate },
): { readonly choice: EffectiveChoice; readonly label: string } {
  const t = context.translate;
  if (day === days.tomorrow) {
    return { choice: 'tomorrow', label: t('admin.rhythm.effective.tomorrow') };
  }
  if (day === days.firstOfMonth) {
    return {
      choice: 'firstOfMonth',
      label: t('admin.rhythm.effective.firstOfMonth'),
    };
  }
  return {
    choice: 'pick',
    label: t('admin.rhythm.effective.picked', {
      date: shortDay(day, context.today, context.lang),
    }),
  };
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
  draft: StreakDefinitionProps,
): string {
  const t = context.translate;
  return draft.protections.enabled
    ? t('admin.rhythm.row.protections', { count: draft.protections.maxBanked })
    : t('admin.rhythm.row.protectionsOff');
}

/** «3 от 4» · «3 от 4 · пауза до 90 дни» — the excuses row. */
export function excusesRow(
  context: AdminRhythmContext,
  draft: StreakDefinitionProps,
): string {
  const t = context.translate;
  const on = draft.excuses.length;
  const all = STREAK_EXCUSES.length;
  return draft.clientPause.enabled
    ? t('admin.rhythm.row.excusesPause', {
        on,
        all,
        days: context.rule.days(draft.clientPause.maxDaysPerYear),
      })
    : t('admin.rhythm.row.excuses', { on, all });
}

/** «Започва отначало» · «Продължава оттам» — the after-a-miss row. */
export function afterMissRow(
  context: AdminRhythmContext,
  draft: StreakDefinitionProps,
): string {
  return context.translate(`admin.rhythm.onBreak.${draft.onBreak}`);
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
const DIGEST_ORDER: readonly (keyof StreakDefinitionProps)[] = [
  'graceDays',
  'protections',
  'excuses',
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
  draft: StreakDefinitionProps,
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

/** «Клиент, който идва на 4 седмици, има срок 6 седмици.» — the tolerance explained on one habit. */
export function toleranceExample(
  context: AdminRhythmContext,
  interval: Extract<StreakDefinitionProps['interval'], { kind: 'personal' }>,
): string {
  const habitDays = 28;
  const raw = Math.round(habitDays * (1 + interval.tolerancePct / 100));
  const due = Math.min(interval.maxDays, Math.max(interval.minDays, raw));
  return context.translate('admin.rhythm.interval.example', {
    habit: context.rule.weeks(weeksOf(habitDays)),
    interval: context.rule.weeks(weeksOf(due)),
  });
}

/** «В сила от 1.09» · «От 1.10» — the rule card's capsule. */
export function inForceCapsule(
  context: AdminRhythmContext,
  day: IsoDate,
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
  day: IsoDate,
  short: string,
): string {
  return context.translate('rhythmRule.upcoming', {
    date: shortDay(day, context.today, context.lang),
    rule: short,
  });
}

// ── The history ──────────────────────────────────────────────────────────

/** The rule's own order, in which a version's changes are named. */
const CHANGE_ORDER: readonly (keyof StreakDefinitionProps)[] = [
  'enabled',
  'qualifier',
  'minGapDays',
  'bookingHold',
  'interval',
  'graceDays',
  'riskLeadDays',
  'protections',
  'excuses',
  'clientPause',
  'repair',
  'onBreak',
  'name',
];

/**
 * One parameter's change, lower case, no stop (`admin.rhythm.history.change.*`);
 * `null` for a member that is a version's identity and not a change.
 */
export function changeWord(
  context: AdminRhythmContext,
  parameter: keyof StreakDefinitionProps,
  props: StreakDefinitionProps,
): string | null {
  const t = context.translate;
  const { days, weeks } = context.rule;
  const key = 'admin.rhythm.history.change';
  switch (parameter) {
    case 'name':
      return t(`${key}.name`);
    case 'enabled':
      return t(`${key}.enabled.${props.enabled ? 'on' : 'off'}`);
    case 'qualifier':
      return t(`${key}.qualifier.${props.qualifier.kind}`);
    case 'minGapDays':
      return t(`${key}.minGapDays`, { days: days(props.minGapDays) });
    case 'bookingHold':
      return props.bookingHold.enabled
        ? t(`${key}.bookingHold.on`, {
            days: days(props.bookingHold.maxDaysPastDue),
          })
        : t(`${key}.bookingHold.off`);
    case 'interval':
      return props.interval.kind === 'fixed'
        ? t(`${key}.interval.fixed`, {
            interval: weeks(props.interval.days / DAYS_IN_WEEK),
          })
        : t(`${key}.interval.personal`);
    case 'graceDays':
      return props.graceDays > 0
        ? t(`${key}.graceDays.days`, { days: days(props.graceDays) })
        : t(`${key}.graceDays.none`);
    case 'riskLeadDays':
      return props.riskLeadDays > 0
        ? t(`${key}.riskLeadDays.days`, { days: days(props.riskLeadDays) })
        : t(`${key}.riskLeadDays.none`);
    case 'protections':
      return props.protections.enabled
        ? t(`${key}.protections.on`, { count: props.protections.maxBanked })
        : t(`${key}.protections.off`);
    case 'excuses':
      return t(`${key}.excuses`, {
        on: props.excuses.length,
        all: STREAK_EXCUSES.length,
      });
    case 'clientPause':
      return props.clientPause.enabled
        ? t(`${key}.clientPause.on`, {
            days: days(props.clientPause.maxDaysPerYear),
          })
        : t(`${key}.clientPause.off`);
    case 'repair':
      return props.repair.enabled
        ? t(`${key}.repair.on`, { days: days(props.repair.windowDays) })
        : t(`${key}.repair.off`);
    case 'onBreak':
      return t(`${key}.onBreak.${props.onBreak}`);
    case 'id':
    case 'version':
    case 'effectiveFrom':
      return null;
  }
}

/** The changes a version made, in the rule's order, each worded; the identity members left out. */
function changeWords(
  context: AdminRhythmContext,
  changed: StreakRuleChange['changed'],
  props: StreakDefinitionProps,
): readonly string[] {
  return CHANGE_ORDER.filter((parameter) => changed.includes(parameter))
    .map((parameter) => changeWord(context, parameter, props))
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
 * the day it was published ONLY when that is another day than the one
 * the title opens with (a rule saved on its own day, the seed's first
 * rule among them, would say the date twice: the wireframe's «системата»
 * stands alone).
 */
export function historyRow(
  context: AdminRhythmContext,
  version: StreakDefinitionVersion,
): AdminRhythmHistoryRow {
  const t = context.translate;
  const { today, lang } = context;
  const props = version.definition.toProps();
  const words = changeWords(context, version.changed, props);
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
  const name =
    version.publishedBy === 'system'
      ? t('admin.rhythm.history.system')
      : version.publishedBy;
  const publishedOn = sofiaDayOf(version.publishedAt);
  return {
    version: props.version,
    title: jointed(
      t('admin.rhythm.history.row', {
        date: shortDay(props.effectiveFrom, today, lang),
        change,
      }),
    ),
    by:
      publishedOn === props.effectiveFrom
        ? name
        : t('admin.rhythm.history.by', {
            name,
            date: shortDay(publishedOn, today, lang),
          }),
    withdrawn: version.withdrawnAt !== null,
  };
}

// ── The preview ──────────────────────────────────────────────────────────

/** One of the preview's three figures. */
export interface AdminRhythmPreviewMetric {
  readonly id: 'inRhythm' | 'inGrace' | 'broken';
  /** «В ритъм». */
  readonly caption: string;
  /** The count under the new rule, «148». */
  readonly value: string;
  /** «+17» · «−3»; `null` when the count does not move. */
  readonly delta: string | null;
  /** «В ритъм: 131 → 148» — what a reader hears. */
  readonly label: string;
}

/** «Какво ще се промени», worded. */
export type AdminRhythmPreviewWords =
  | {
      readonly kind: 'estimate';
      /** «214 клиенти с посещение за 12 месеца». */
      readonly clients: string;
      /** «от първите 1 000 клиенти»; `null` unless the walk stopped short. */
      readonly capped: string | null;
      /** Three figures; empty while either rule is off (an off rule judges nobody). */
      readonly metrics: readonly AdminRhythmPreviewMetric[];
      /** «17 се връщат в ритъм · никой не излиза от ритъм». */
      readonly summary: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** One standing's count, read by name (no dynamic index). */
function standingOf(
  counts: StreakStandingCounts,
  id: (typeof STANDINGS)[number][0],
): number {
  switch (id) {
    case 'inRhythm':
      return counts.inRhythm;
    case 'inGrace':
      return counts.inGrace;
    case 'broken':
      return counts.broken;
  }
}

const STANDINGS = [
  ['inRhythm', 'admin.rhythm.preview.inRhythm'],
  ['inGrace', 'admin.rhythm.preview.inGrace'],
  ['broken', 'admin.rhythm.preview.broken'],
] as const;

export function previewWords(
  context: AdminRhythmContext,
  preview: StreakPreview,
  capped: boolean,
  cap: number,
): AdminRhythmPreviewWords {
  const t = context.translate;
  if (preview.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      reason: t('admin.rhythm.preview.unavailable'),
    };
  }
  const { before, after } = preview;
  const metrics: AdminRhythmPreviewMetric[] =
    before === null || after === null
      ? []
      : STANDINGS.map(([id, key]) => {
          const caption = t(key);
          const from = standingOf(before, id);
          const to = standingOf(after, id);
          return {
            id,
            caption,
            value: figure(context, to),
            delta: signedDelta(context, from, to),
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
    kind: 'estimate',
    clients: counted(context, 'admin.rhythm.preview.clients', preview.clients),
    capped: capped
      ? t('admin.rhythm.preview.capped', { count: figure(context, cap) })
      : null,
    metrics,
    summary: jointed(t('admin.rhythm.preview.summary', { back, out })),
  };
}

// ── The sample track ─────────────────────────────────────────────────────

/**
 * The sample client's periods as the track draws them: the projection's
 * closed periods (a visit that kept the run, a due date covered or
 * missed, the visit that restored it), then the open one. Captions are
 * empty: the small track draws none, and the rule card says the rule.
 */
export function samplePeriods(
  context: AdminRhythmContext,
  state: StreakState,
): readonly UiStreakPeriod[] {
  const t = context.translate;
  const { today, lang } = context;
  const closed = state.periods.map((fact, index): UiStreakPeriod => {
    const period = monthWord(fact.on, lang);
    const id = `${fact.mark}-${fact.on}-${index}`;
    switch (fact.mark) {
      case 'kept':
        return {
          id,
          mark: 'kept',
          caption: '',
          description: t('clientCard.rhythm.mark.kept', {
            period,
            date: shortDay(fact.on, today, lang),
          }),
        };
      case 'repaired':
        return {
          id,
          mark: 'repaired',
          caption: '',
          description: t('clientCard.rhythm.mark.repaired', { period }),
        };
      case 'protected':
        return {
          id,
          mark: 'protected',
          caption: '',
          description: t('clientCard.rhythm.mark.protected', {
            period,
            reason: t(`clientCard.rhythm.reason.${fact.reason ?? 'freeze'}`),
          }),
        };
      case 'missed':
        return {
          id,
          mark: 'missed',
          caption: '',
          description: t('clientCard.rhythm.mark.missed', { period }),
        };
    }
  });
  if (state.dueBy === null) return closed;
  return [
    ...closed,
    {
      id: 'current',
      mark: state.phase.kind === 'frozen' ? 'protected' : 'current',
      caption: '',
      description: t('clientCard.rhythm.mark.current', {
        date: longDay(state.dueBy, today, lang),
      }),
    },
  ];
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

/** The control's label for a field the domain or the server refused («Поправи: Гратисен период.»). */
export function fieldName(context: AdminRhythmContext, field: string): string {
  const t = context.translate;
  const key = 'admin.rhythm';
  switch (field) {
    case 'qualifier.kind':
      return t(`${key}.counts.label`);
    case 'qualifier.serviceIds':
    case 'qualifier.categoryIds':
      return t(`${key}.counts.servicesRow`);
    case 'minGapDays':
      return t(`${key}.counts.minGap`);
    case 'bookingHold.maxDaysPastDue':
      return t(`${key}.counts.holdDays`);
    case 'interval.kind':
    case 'interval.days':
      return t(`${key}.interval.label`);
    case 'interval.tolerancePct':
      return t(`${key}.interval.personal`);
    case 'interval.minDays':
      return t(`${key}.interval.min`);
    case 'interval.maxDays':
      return t(`${key}.interval.max`);
    case 'interval.fallbackDays':
      return t(`${key}.interval.fallback`);
    case 'graceDays':
      return t(`${key}.grace.title`);
    case 'riskLeadDays':
      return t(`${key}.grace.lead`);
    case 'protections.maxBanked':
      return t(`${key}.protections.max`);
    case 'protections.earnEvery':
      return t(`${key}.protections.every`);
    case 'protections.startWith':
      return t(`${key}.protections.first`);
    case 'excuses':
      return t(`${key}.excuses.title`);
    case 'clientPause.maxDaysPerYear':
      return t(`${key}.pause.days`);
    case 'repair.windowDays':
      return t(`${key}.repair.window`);
    case 'repair.perYear':
      return t(`${key}.repair.perYear`);
    case 'onBreak':
      return t(`${key}.onBreak.label`);
    case 'effectiveFrom':
    case 'scheduled.effectiveFrom':
      return t(`${key}.effective.from`);
    default:
      return field;
  }
}

/** «Поправи: Гратисен период, Срок.» — the refusal naming its fields, each once. */
export function invalidNotice(
  context: AdminRhythmContext,
  fields: readonly string[],
): string {
  const names = fields
    .map((field) => fieldName(context, field))
    .filter((name, index, all) => all.indexOf(name) === index);
  return context.translate('admin.rhythm.refused.invalid', {
    field: new Intl.ListFormat(context.lang, { type: 'conjunction' }).format(
      names,
    ),
  });
}
