import type { DayKey } from '../components/day-key.data';
import {
  Frequency,
  RecurrenceEndKind,
  RecurrenceRule,
} from '../components/recurrence-rule.data';
import { Weekday } from '../components/weekday.data';
import { RecurrenceSystem } from './recurrence.system';
import { ZonedTimeSystem } from './zoned-time.system';

/**
 * The repeat page's shortcuts — Apple's Repeat list with Google's and
 * Outlook's «every weekday» (a shop's lunch break). The ONLY source of these
 * strings. A preset is never STORED: the draft holds the rule, and which row
 * wears the check is read back off it ({@link VisitDraftSystem.presetOf}).
 */
export const RepeatPreset = {
  Never: 'never',
  Daily: 'daily',
  Weekdays: 'weekdays',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Yearly: 'yearly',
} as const;
export type RepeatPreset = (typeof RepeatPreset)[keyof typeof RepeatPreset];

/** The shortcuts, in the page's order. */
const REPEAT_PRESETS: readonly RepeatPreset[] = [
  RepeatPreset.Never,
  RepeatPreset.Daily,
  RepeatPreset.Weekdays,
  RepeatPreset.Weekly,
  RepeatPreset.Monthly,
  RepeatPreset.Yearly,
];

/** Monday to Friday — the working week a calendar's «weekdays» means. */
const MONDAY_TO_FRIDAY: readonly Weekday[] = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
];

/** How far a daily or weekly series reaches unless told — four weeks of lunches. */
const DEFAULT_DAYS = 28;
/** A monthly one, half a year. */
const DEFAULT_MONTHS_MONTHLY = 6;
/** An anniversary, four more years of it. */
const DEFAULT_MONTHS_YEARLY = 48;
/** The count a series takes when its end turns into «after N times» with nothing to keep. */
const DEFAULT_COUNT = 10;

/** The id a service picked before anyone was named sits on. */
const PLACEHOLDER_CLIENT_ID = 'primary';
/** A visit with no service yet still needs a shape to draw: half an hour. */
const DEFAULT_SPAN_MINUTES = 30;

/** A leg as the span reads it — its minutes. */
export type DraftLegMinutes = { readonly minutes: number };

/** A leg as the placeholder rule reads it — whose it is. */
export type DraftLegClient = { readonly clientId: string };

/**
 * A seat as the catalogue tag reads it: the catalogue's minutes for it, or
 * `null` when the catalogue no longer knows the service, and the minutes it
 * was booked (sold) for.
 */
export type CatalogLegMinutes = {
  readonly catalogMinutes: number | null;
  readonly bookedMinutes: number;
};

/** One stranger's name on a visit. */
export type WalkInLabel = {
  readonly personId: string;
  readonly label: string;
};

/** A repeat preset that names a rule (every one but «never»). */
type RulePreset = Exclude<RepeatPreset, typeof RepeatPreset.Never>;

function patternOf(
  preset: RulePreset,
  startDayKey: DayKey,
): RecurrenceRule.Pattern {
  switch (preset) {
    case RepeatPreset.Weekdays:
      return { kind: Frequency.Weekly, weekdays: MONDAY_TO_FRIDAY };
    case RepeatPreset.Daily:
      return RecurrenceSystem.patternFor(Frequency.Daily, startDayKey);
    case RepeatPreset.Weekly:
      return RecurrenceSystem.patternFor(Frequency.Weekly, startDayKey);
    case RepeatPreset.Monthly:
      return RecurrenceSystem.patternFor(Frequency.Monthly, startDayKey);
    case RepeatPreset.Yearly:
      return RecurrenceSystem.patternFor(Frequency.Yearly, startDayKey);
  }
}

/**
 * A rule from its parts whose end still makes a series from `start` — or,
 * where it no longer does (an end the start overtook, a year of weeks
 * turned daily), the frequency's own default end. Only for moves the SHEET
 * makes on someone's behalf; an end a person set stands as set.
 */
function fitted(
  pattern: RecurrenceRule.Pattern,
  interval: number,
  end: RecurrenceRule.End | null,
  startDayKey: DayKey,
): RecurrenceRule | null {
  if (end !== null) {
    const kept = RecurrenceRule.create(pattern, interval, end);
    if (kept.ok && RecurrenceSystem.series(startDayKey, kept.value).ok) {
      return kept.value;
    }
  }
  const fresh = RecurrenceRule.create(
    pattern,
    interval,
    VisitDraftSystem.defaultEnd(pattern.kind, startDayKey),
  );
  return fresh.ok ? fresh.value : null;
}

/**
 * VisitDraftSystem — the moves a staff sheet makes on a DRAFT on someone's
 * behalf, as numbers, ids and rules (never words):
 *
 * - the visit's span and the placeholder seats
 *   (`visit-editor/staff-visit-editor.ts` `spanOf`/`seedDraft`/
 *   `adoptPlaceholderLegs`);
 * - names for the strangers on one visit (`shared/walk-in-labels.ts`);
 * - the catalogue tag's arithmetic (`shared/catalog-delta.ts` — the
 *   `−10 мин` wording stays in the presenter);
 * - the repeat page's policy over a `RecurrenceRule`
 *   (`block-editor/block-repeat.ts`), on `RecurrenceSystem`'s walk.
 */
export const VisitDraftSystem = {
  PLACEHOLDER_CLIENT_ID,
  DEFAULT_SPAN_MINUTES,
  REPEAT_PRESETS,
  MONDAY_TO_FRIDAY,

  /* ── The span and the placeholder seats ─────────────────────────────── */

  /** The legs' minutes summed — or half an hour for a visit with none yet. */
  legMinutes(legs: readonly DraftLegMinutes[]): number {
    if (legs.length === 0) return DEFAULT_SPAN_MINUTES;
    let total = 0;
    for (let i = 0; i < legs.length; i++) {
      total += (legs[i] as DraftLegMinutes).minutes;
    }
    return total;
  },

  /** The minutes a draft describes — its override, or the legs it holds. */
  span(
    durationOverride: number | null,
    legs: readonly DraftLegMinutes[],
  ): number {
    return durationOverride ?? VisitDraftSystem.legMinutes(legs);
  },

  /**
   * The override a seeded draft pins: none when the booked span IS the
   * legs' own minutes, else the booked span — only a number that never was
   * the catalogue's is pinned.
   */
  durationOverrideOf(
    startMinute: number,
    endMinute: number,
    legs: readonly DraftLegMinutes[],
  ): number | null {
    const span = endMinute - startMinute;
    return span === VisitDraftSystem.legMinutes(legs) ? null : span;
  },

  /**
   * THE FIRST PERSON TAKES THE PLACEHOLDER'S SEATS: a service picked before
   * anyone was named sits on the placeholder id; when the first person joins
   * an EMPTY draft those seats become theirs. With anyone already seated the
   * legs come back as given (the same array).
   */
  adoptPlaceholderLegs<L extends DraftLegClient>(
    clientCount: number,
    legs: readonly L[],
    personId: string,
  ): readonly L[] {
    if (clientCount > 0) return legs;
    const out: L[] = [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i] as L;
      out.push(
        leg.clientId === PLACEHOLDER_CLIENT_ID
          ? { ...leg, clientId: personId }
          : leg,
      );
    }
    return out;
  },

  /* ── Strangers' names ────────────────────────────────────────────────── */

  /**
   * NAMES FOR THE PEOPLE ON ONE VISIT WHO HAVE NONE. The first stranger
   * keeps the plain word, every later one is numbered — skipping any label
   * the visit already holds, whoever holds it — and one person (one id,
   * however many legs) is named once, in first-seen order. `word(null)` is
   * the plain label, `word(n)` the numbered one; the search is bounded, so a
   * catalogue that words every number alike still ends.
   */
  walkInLabels(
    unlabelled: readonly string[],
    taken: readonly string[],
    word: (number: number | null) => string,
  ): readonly WalkInLabel[] {
    const used = new Set<string>(taken);
    const seen = new Set<string>();
    const people: string[] = [];
    for (let i = 0; i < unlabelled.length; i++) {
      const id = unlabelled[i] as string;
      if (seen.has(id)) continue;
      seen.add(id);
      people.push(id);
    }
    const limit = used.size + people.length + 2;
    const out: WalkInLabel[] = [];
    for (let i = 0; i < people.length; i++) {
      const personId = people[i] as string;
      let label = word(null);
      for (let number = 2; used.has(label) && number <= limit; number += 1) {
        label = word(number);
      }
      out.push({ personId, label });
      used.add(label);
    }
    return out;
  },

  /* ── The catalogue tag ───────────────────────────────────────────────── */

  /**
   * The catalogue's minutes for a run of seats. A seat the catalogue no
   * longer knows stands at its own booked length — a retired service reads
   * as running exactly as sold. `null` for no seats at all.
   */
  catalogMinutesOf(legs: readonly CatalogLegMinutes[]): number | null {
    if (legs.length === 0) return null;
    let total = 0;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i] as CatalogLegMinutes;
      total += leg.catalogMinutes ?? leg.bookedMinutes;
    }
    return total;
  },

  /**
   * How far a visit runs from the catalogue's length, signed — `null` when
   * it runs exactly as the catalogue says, and when the catalogue cannot say.
   */
  minutesDelta(
    spanMinutes: number,
    catalogMinutes: number | null,
  ): number | null {
    if (catalogMinutes === null) return null;
    const delta = spanMinutes - catalogMinutes;
    return delta === 0 ? null : delta;
  },

  /* ── The repeat page's policy ────────────────────────────────────────── */

  /**
   * Where a series ends unless told otherwise. Always a DATE: four weeks on
   * for a daily or weekly series, six months for a monthly one, four years
   * for a yearly one — the month's last day where it has no such date.
   */
  defaultEnd(frequency: Frequency, startDayKey: DayKey): RecurrenceRule.End {
    const dayKey =
      frequency === Frequency.Daily || frequency === Frequency.Weekly
        ? ZonedTimeSystem.addDays(startDayKey, DEFAULT_DAYS)
        : ZonedTimeSystem.addMonths(
            startDayKey,
            frequency === Frequency.Monthly
              ? DEFAULT_MONTHS_MONTHLY
              : DEFAULT_MONTHS_YEARLY,
          );
    return { kind: RecurrenceEndKind.Until, dayKey };
  },

  /** Which shortcut a rule is from `start` — `null` for none of them («Персонализирано»). */
  presetOf(
    rule: RecurrenceRule | null,
    startDayKey: DayKey,
  ): RepeatPreset | null {
    if (rule === null) return RepeatPreset.Never;
    if (rule.interval !== 1) return null;
    for (let i = 0; i < REPEAT_PRESETS.length; i++) {
      const preset = REPEAT_PRESETS[i] as RepeatPreset;
      if (preset === RepeatPreset.Never) continue;
      const candidate = RecurrenceRule.create(
        patternOf(preset, startDayKey),
        1,
        rule.end,
      );
      if (candidate.ok && RecurrenceRule.equals(candidate.value, rule)) {
        return preset;
      }
    }
    return null;
  },

  /** A shortcut, tapped: what it means from `start`, keeping the end the series had. */
  ruleForPreset(
    preset: RepeatPreset,
    startDayKey: DayKey,
    current: RecurrenceRule | null,
  ): RecurrenceRule | null {
    if (preset === RepeatPreset.Never) return null;
    return fitted(
      patternOf(preset, startDayKey),
      1,
      current === null ? null : current.end,
      startDayKey,
    );
  },

  /**
   * «Персонализирано», tapped: the rule there is (the same struct), or —
   * from nothing — Google's own custom default, every week on the start's
   * weekday.
   */
  ruleForCustom(
    startDayKey: DayKey,
    current: RecurrenceRule | null,
  ): RecurrenceRule | null {
    return (
      current ??
      VisitDraftSystem.ruleForPreset(RepeatPreset.Weekly, startDayKey, null)
    );
  },

  /**
   * The frequency changed: the start's own days for it, the interval and
   * the end kept. The same struct back when the frequency is unchanged, or
   * when no rule of the new frequency can be made.
   */
  ruleForFrequency(
    rule: RecurrenceRule,
    frequency: Frequency,
    startDayKey: DayKey,
  ): RecurrenceRule {
    if (RecurrenceRule.frequency(rule) === frequency) return rule;
    return (
      fitted(
        RecurrenceSystem.patternFor(frequency, startDayKey),
        rule.interval,
        rule.end,
        startDayKey,
      ) ?? rule
    );
  },

  /**
   * How the series ends, switched between «На дата» and «След брой пъти» —
   * WITHOUT changing its days where it has any: the date becomes the last
   * day's, the count becomes how many there are. The same struct back when
   * the kind is unchanged.
   */
  ruleForEndKind(
    rule: RecurrenceRule,
    kind: RecurrenceEndKind,
    startDayKey: DayKey,
  ): RecurrenceRule {
    if (rule.end.kind === kind) return rule;
    const series = RecurrenceSystem.series(startDayKey, rule);
    let end: RecurrenceRule.End;
    if (kind === RecurrenceEndKind.Count) {
      end = {
        kind: RecurrenceEndKind.Count,
        count: series.ok ? series.value.dayKeys.length : DEFAULT_COUNT,
      };
    } else if (series.ok) {
      const days = series.value.dayKeys;
      end = {
        kind: RecurrenceEndKind.Until,
        dayKey: days[days.length - 1] as DayKey,
      };
    } else {
      end = VisitDraftSystem.defaultEnd(
        RecurrenceRule.frequency(rule),
        startDayKey,
      );
    }
    const next = RecurrenceRule.create(rule.pattern, rule.interval, end);
    return next.ok ? next.value : rule;
  },

  /**
   * The frame stepped to another day, so the series starts there: a
   * pattern that was the start's own follows it
   * (`RecurrenceSystem.followingStart`), and an end the new start overtook
   * moves on to the default.
   */
  ruleForStart(
    rule: RecurrenceRule,
    fromDayKey: DayKey,
    toDayKey: DayKey,
  ): RecurrenceRule {
    const followed = RecurrenceSystem.followingStart(
      rule,
      fromDayKey,
      toDayKey,
    );
    return (
      fitted(followed.pattern, followed.interval, followed.end, toDayKey) ??
      followed
    );
  },
} as const;
