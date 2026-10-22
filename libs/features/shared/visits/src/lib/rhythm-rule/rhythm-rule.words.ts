import {
  StreakInterval,
  StreakIntervalSource,
  type StreakPeriodTerms,
  StreakQualifier,
  type StreakQualifierRule,
} from '@core/components';
import type { StreakRuleSummary } from '@core/systems';
import { pluralForm } from '@creativo/infrastructure/i18n';
import type { VisitTranslate } from '../visit-row.presenter';

/*
 * THE RHYTHM RULE, IN WORDS (client-card revision 3 §3.11, R2-J).
 *
 * The rule's sentences are COPY, and copy is a feature's (the precedent:
 * `visitWordsOf`, in this same lib). ONE pure function words the rule for
 * the client card («Ритъм», the medal detail's rhythm family) and for the
 * admin page (the live rule sentence), and neither feature imports the
 * other. The keys are `rhythmRule.*` (§6.1), their own root.
 *
 * The domain hands over STRUCTURE (`StreakRuleSystem.summary`,
 * `@core/systems`), in which
 * a part is `null` when the rule has nothing to say about it. This file
 * says one sentence for every part that holds and none for a part that
 * does not, in the rule's own order, so the card and the editor can never
 * word one rule apart.
 *
 * It holds NO rule arithmetic. A person's interval arrives computed (the
 * open period's pinned terms, `StreakState.periodTerms`); nothing here
 * derives a due date from a habit, so there is no second copy of the rule
 * to drift from the projector's.
 */

/** The rule in force, worded once for every place that prints it. */
export interface RhythmRuleWords {
  /** «Посещение на всеки 6 седмици пази ритъма.» */
  readonly sentence: string;
  /** «7 дни гратис след срока.» · «До 2 защити …» · … in the rule's own order. */
  readonly details: readonly string[];
  /** «На всеки 6 седмици · 7 дни гратис» */
  readonly short: string;
  /** «7 дни» — a count of days in the rule's own plural (`rhythmRule.days.*`). */
  readonly days: (count: number) => string;
  /** «6 седмици» · «5½ седмици» — a count of weeks (`rhythmRule.weeks.*`, `.weeksHalf`). */
  readonly weeks: (count: number) => string;
}

/**
 * What a sentence may name beyond the rule itself. Every part is optional:
 * the admin page words a draft that is nobody's yet, and a rule that
 * counts every visit names no service.
 */
export interface RhythmRuleContext {
  /**
   * The person's open period as the projection pinned it
   * (`StreakState.periodTerms`). Read under a PERSONAL interval only, where it
   * turns «Срокът е 6 седмици, докато опознаем навика му.» into «Идва на
   * около 4 седмици, срокът му е 5½ седмици.». A fixed rule is the same
   * sentence for everyone, whatever an older period still holds.
   */
  readonly period?: StreakPeriodTerms | null;
  /**
   * A counted service's name by its id (a category's, when the rule counts
   * by category), for «Броят се посещения с: …». An id it cannot name is
   * left out; with no name at all the sentence is not said.
   */
  readonly nameOf?: ((id: string) => string | null) | null;
}

/**
 * The rule's two units ALONE, in the plural a count asks for: «ден» ·
 * «дни» · «седмица» · «седмици». For a control that holds the figure
 * itself (`ui-unit-field [uiUnit]`), where «7 дни» would say the 7 twice.
 */
export interface RhythmRuleUnits {
  readonly days: (count: number) => string;
  readonly weeks: (count: number) => string;
}

/** Below two weeks a span is said in days; from there on, in weeks. */
const WEEKS_FROM_DAYS = 14;
const DAYS_IN_WEEK = 7;

/** A count as the rule holds one: whole, never negative, never a non-number. */
const counted = (count: number, step = 1): number =>
  Number.isFinite(count) ? Math.max(0, Math.round(count / step)) : 0;

interface CountWords {
  readonly days: (count: number) => string;
  readonly weeks: (count: number) => string;
  /** A span of days in the unit it reads best in: «10 дни» · «6 седмици» · «5½ седмици». */
  readonly span: (days: number) => string;
}

function countWords(translate: VisitTranslate, lang: string): CountWords {
  const plural = (key: string, count: number) =>
    translate(`${key}.${pluralForm(count, lang)}`, { count });
  const days = (count: number) => plural('rhythmRule.days', counted(count));
  // To the nearest HALF week: an interval is edited in weeks and held in
  // days, and a personal one lands between two whole weeks more often than
  // on one. «5½ седмици» is honest about 39 days; «6 седмици» is not.
  const weeks = (count: number) => {
    const halves = counted(count, 0.5);
    const whole = Math.trunc(halves / 2);
    if (halves % 2 === 0) return plural('rhythmRule.weeks', whole);
    // Under one week the half stands alone: «½ седмици», never «0½».
    return translate('rhythmRule.weeksHalf', {
      count: whole === 0 ? '' : whole,
    });
  };
  const span = (count: number) => {
    const whole = counted(count);
    return whole < WEEKS_FROM_DAYS ? days(whole) : weeks(whole / DAYS_IN_WEEK);
  };
  return { days, weeks, span };
}

/** Which sentence the interval is said in, and the figures it names. */
type IntervalSaid =
  | { readonly key: 'fixed' | 'fallback'; readonly days: number }
  | {
      readonly key: 'personal';
      readonly days: number;
      readonly habitDays: number;
    };

function intervalSaid(
  summary: StreakRuleSummary,
  period: RhythmRuleContext['period'],
): IntervalSaid {
  const interval = summary.interval;
  if (interval.streakInterval === StreakInterval.Fixed) {
    return { key: 'fixed', days: interval.intervalDays };
  }
  // The habit is known only where the period's length CAME from it. A
  // newcomer, a period an older fixed rule opened and a draft on the admin
  // page all read the rule's own figure for someone it does not know yet.
  if (
    period?.source === StreakIntervalSource.Personal &&
    period.habitDays !== null &&
    period.habitDays > 0
  ) {
    return {
      key: 'personal',
      days: period.intervalDays,
      habitDays: period.habitDays,
    };
  }
  return { key: 'fallback', days: interval.intervalFallbackDays };
}

/** «Фейд и Оформяне на брада» — the chosen list by name, in the admin's order; `null` when nothing can be named. */
function countedNames(
  qualifier: StreakQualifierRule,
  nameOf: RhythmRuleContext['nameOf'],
  lang: string,
): string | null {
  if (qualifier.streakQualifier === StreakQualifier.AnyVisit || !nameOf) {
    return null;
  }
  const ids: readonly string[] =
    qualifier.streakQualifier === StreakQualifier.Services
      ? qualifier.qualifierServiceIds
      : qualifier.qualifierCategoryIds;
  const names = ids
    .map((id) => nameOf(id)?.trim() ?? '')
    .filter((name, index, all) => name !== '' && all.indexOf(name) === index);
  return names.length === 0
    ? null
    : new Intl.ListFormat(lang, { type: 'conjunction' }).format(names);
}

/**
 * The rule, worded. Pure: the same summary, catalogue and context give the
 * same words, and nothing is read from a clock or a store.
 *
 * - `sentence` is the interval's: «Посещение на всеки 6 седмици пази
 *   ритъма.» for a fixed one; under a personal one the person's own
 *   (`context.period`), or the newcomer's while the habit is unknown.
 * - `details` follow in the rule's order: grace, protections, the shop's
 *   excuses, a booked visit's hold, the way back after a break (or «Пропускът
 *   не нулира броя.» where a miss holds the count), the counted services.
 * - `short` is the rule line: the interval and, when there is one, the grace.
 * - A rule that is OFF says only that it is off.
 */
export function rhythmRuleWords(
  summary: StreakRuleSummary,
  translate: VisitTranslate,
  lang: string,
  context: RhythmRuleContext = {},
): RhythmRuleWords {
  const { days, weeks, span } = countWords(translate, lang);

  if (!summary.enabled) {
    const off = translate('rhythmRule.off');
    return { sentence: off, details: [], short: off, days, weeks };
  }

  const said = intervalSaid(summary, context.period);
  const interval = span(said.days);
  const sentence =
    said.key === 'personal'
      ? translate('rhythmRule.personal', {
          habit: span(said.habitDays),
          interval,
        })
      : translate(`rhythmRule.${said.key}`, { interval });

  const { graceDays, protections, hold, repair } = summary;
  const services = countedNames(summary.qualifier, context.nameOf, lang);
  const details = [
    graceDays > 0
      ? translate('rhythmRule.grace', { days: days(graceDays) })
      : null,
    protections
      ? translate('rhythmRule.protections', {
          max: protections.maxBanked,
          n: protections.earnEvery,
        })
      : null,
    summary.shopExcuses ? translate('rhythmRule.excuses') : null,
    hold
      ? translate('rhythmRule.hold', { days: days(hold.maxDaysPastDue) })
      : null,
    repair
      ? translate('rhythmRule.repair', { days: days(repair.windowDays) })
      : null,
    summary.holdsCount ? translate('rhythmRule.holdCount') : null,
    services !== null ? translate('rhythmRule.services', { services }) : null,
  ].filter((line): line is string => line !== null);

  const short =
    graceDays > 0
      ? translate('rhythmRule.short', { interval, grace: days(graceDays) })
      : translate('rhythmRule.shortNoGrace', { interval });

  return { sentence, details, short, days, weeks };
}

/**
 * The units alone, read from the SAME keys as the counted words
 * (`rhythmRule.days.*`, `rhythmRule.weeks.*`) with the count left out, so
 * a field's unit and a sentence's can never be two spellings.
 */
export function rhythmRuleUnits(
  translate: VisitTranslate,
  lang: string,
): RhythmRuleUnits {
  const unit = (key: string, count: number) =>
    translate(`${key}.${pluralForm(counted(count), lang)}`, {
      count: '',
    }).trim();
  return {
    days: (count) => unit('rhythmRule.days', count),
    weeks: (count) => unit('rhythmRule.weeks', count),
  };
}
