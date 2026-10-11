import {
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
} from '@core/components';
import {
  Weekday,
  defect,
  DurationMinutes,
  MinuteDelta,
  LocalDate,
  type EndMinute,
  type MinuteOfDay,
} from '@core/primitives';
import { RecurrenceSystem } from './recurrence.system';

/**
 * The repeat page's shortcuts — Apple's Repeat list with Google's and
 * Outlook's «every weekday» (a shop's lunch break). The ONLY source of these
 * strings. A preset is never STORED: the draft holds the rule, and which row
 * wears the check is read back off it ({@link VisitDraftSystem.presetOf}).
 */
export const RepeatPreset = {
  Never: 'NEVER',
  Daily: 'DAILY',
  Weekdays: 'WEEKDAYS',
  Weekly: 'WEEKLY',
  Monthly: 'MONTHLY',
  Yearly: 'YEARLY',
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
const DEFAULT_SPAN_MINUTES = durationOf(30);

/** A positive whole number of minutes this file knows is one (a constant, a sum, a span). */
function durationOf(raw: number): DurationMinutes {
  const minutes = DurationMinutes.of(raw);
  return minutes.ok ? minutes.value : defect('visit-draft: a duration ≤ 0');
}

/** A leg as the span reads it — its minutes. */
export type DraftLegMinutes = { readonly durationMinutes: DurationMinutes };

/**
 * A leg as the placeholder rule reads it — whose it is. The person key is
 * OPAQUE to the system (the editor's own key: an account's uid, a guest's
 * key or {@link PLACEHOLDER_CLIENT_ID}), so it stays the caller's type `K`;
 * the rule only compares it with the placeholder and hands a new one over.
 */
export type DraftLegClient<K extends string = string> = {
  readonly clientId: K;
};

/**
 * A seat as the catalogue tag reads it: the catalogue's minutes for it, or
 * `null` when the catalogue no longer knows the service, and the minutes it
 * was booked (sold) for.
 */
export type CatalogLegMinutes = {
  readonly catalogMinutes: DurationMinutes | null;
  readonly bookedMinutes: DurationMinutes;
};

/** One stranger's name on a visit — the person by the caller's own opaque key `K`. */
export type WalkInLabel<K extends string = string> = {
  readonly personId: K;
  readonly label: string;
};

/** A repeat preset that names a rule (every one but «never»). */
type RulePreset = Exclude<RepeatPreset, typeof RepeatPreset.Never>;

function patternOf(
  preset: RulePreset,
  startLocalDate: LocalDate,
): RecurrencePattern {
  switch (preset) {
    case RepeatPreset.Weekdays:
      return RecurrencePattern.weekly(MONDAY_TO_FRIDAY);
    case RepeatPreset.Daily:
      return RecurrenceSystem.patternFor(
        RecurrenceFrequency.Daily,
        startLocalDate,
      );
    case RepeatPreset.Weekly:
      return RecurrenceSystem.patternFor(
        RecurrenceFrequency.Weekly,
        startLocalDate,
      );
    case RepeatPreset.Monthly:
      return RecurrenceSystem.patternFor(
        RecurrenceFrequency.Monthly,
        startLocalDate,
      );
    case RepeatPreset.Yearly:
      return RecurrenceSystem.patternFor(
        RecurrenceFrequency.Yearly,
        startLocalDate,
      );
  }
}

/**
 * A rule from its parts whose end still makes a series from `start` — or,
 * where it no longer does (an end the start overtook, a year of weeks
 * turned daily), the frequency's own default end. Only for moves the SHEET
 * makes on someone's behalf; an end a person set stands as set.
 */
function fitted(
  pattern: RecurrencePattern,
  interval: number,
  end: RecurrenceEndRule | null,
  startLocalDate: LocalDate,
): RecurrenceRule | null {
  if (end !== null) {
    const kept = RecurrenceRule.create(pattern, interval, end);
    if (kept.ok && RecurrenceSystem.series(startLocalDate, kept.value).ok) {
      return kept.value;
    }
  }
  const fresh = RecurrenceRule.create(
    pattern,
    interval,
    VisitDraftSystem.defaultEnd(pattern.recurrenceFrequency, startLocalDate),
  );
  return fresh.ok ? fresh.value : null;
}

/**
 * VisitDraftSystem — the moves a staff sheet makes on a DRAFT on someone's
 * behalf, as minutes, keys and rules (never words), on the shop's calendar
 * alone (`LocalDate`, Law 7 — no zone, no instant):
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
  legMinutes(legs: readonly DraftLegMinutes[]): DurationMinutes {
    if (legs.length === 0) return DEFAULT_SPAN_MINUTES;
    let total = (legs[0] as DraftLegMinutes).durationMinutes;
    for (let i = 1; i < legs.length; i++) {
      total = DurationMinutes.sum(
        total,
        (legs[i] as DraftLegMinutes).durationMinutes,
      );
    }
    return total;
  },

  /** The minutes a draft describes — its override, or the legs it holds. */
  span(
    durationOverride: DurationMinutes | null,
    legs: readonly DraftLegMinutes[],
  ): DurationMinutes {
    return durationOverride ?? VisitDraftSystem.legMinutes(legs);
  },

  /**
   * The override a seeded draft pins: none when the booked span — from its
   * start to its exclusive end on the shop's clock — IS the legs' own
   * minutes, else the booked span: only a number that never was the
   * catalogue's is pinned. A span with no length pins nothing.
   */
  durationOverrideOf(
    start: MinuteOfDay,
    end: EndMinute,
    legs: readonly DraftLegMinutes[],
  ): DurationMinutes | null {
    const span = DurationMinutes.between(start, end);
    if (!span.ok) return null;
    return span.value === VisitDraftSystem.legMinutes(legs) ? null : span.value;
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
    personId: L['clientId'],
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
  walkInLabels<K extends string>(
    unlabelled: readonly K[],
    taken: readonly string[],
    word: (number: number | null) => string,
  ): readonly WalkInLabel<K>[] {
    const used = new Set<string>(taken);
    const seen = new Set<K>();
    const people: K[] = [];
    for (let i = 0; i < unlabelled.length; i++) {
      const id = unlabelled[i] as K;
      if (seen.has(id)) continue;
      seen.add(id);
      people.push(id);
    }
    const limit = used.size + people.length + 2;
    const out: WalkInLabel<K>[] = [];
    for (let i = 0; i < people.length; i++) {
      const personId = people[i] as K;
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
  catalogMinutesOf(legs: readonly CatalogLegMinutes[]): DurationMinutes | null {
    let total: DurationMinutes | null = null;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i] as CatalogLegMinutes;
      const minutes = leg.catalogMinutes ?? leg.bookedMinutes;
      total = total === null ? minutes : DurationMinutes.sum(total, minutes);
    }
    return total;
  },

  /**
   * How far a visit runs from the catalogue's length, signed — `null` when
   * it runs exactly as the catalogue says, and when the catalogue cannot say.
   */
  minutesDelta(
    spanMinutes: DurationMinutes,
    catalogMinutes: DurationMinutes | null,
  ): MinuteDelta | null {
    if (catalogMinutes === null) return null;
    const delta = MinuteDelta.of(spanMinutes - catalogMinutes);
    if (!delta.ok) return defect('visit-draft: a delta off the integers');
    return delta.value === 0 ? null : delta.value;
  },

  /* ── The repeat page's policy ────────────────────────────────────────── */

  /**
   * Where a series ends unless told otherwise. Always a DATE: four weeks on
   * for a daily or weekly series, six months for a monthly one, four years
   * for a yearly one — the month's last day where it has no such date.
   */
  defaultEnd(
    frequency: RecurrenceFrequency,
    startLocalDate: LocalDate,
  ): RecurrenceEndRule {
    return RecurrenceEndRule.until(
      frequency === RecurrenceFrequency.Daily ||
        frequency === RecurrenceFrequency.Weekly
        ? LocalDate.addDays(startLocalDate, DEFAULT_DAYS)
        : LocalDate.addMonths(
            startLocalDate,
            frequency === RecurrenceFrequency.Monthly
              ? DEFAULT_MONTHS_MONTHLY
              : DEFAULT_MONTHS_YEARLY,
          ),
    );
  },

  /** Which shortcut a rule is from `start` — `null` for none of them («Персонализирано»). */
  presetOf(
    rule: RecurrenceRule | null,
    startLocalDate: LocalDate,
  ): RepeatPreset | null {
    if (rule === null) return RepeatPreset.Never;
    if (rule.recurrenceInterval !== 1) return null;
    for (let i = 0; i < REPEAT_PRESETS.length; i++) {
      const preset = REPEAT_PRESETS[i] as RepeatPreset;
      if (preset === RepeatPreset.Never) continue;
      const candidate = RecurrenceRule.create(
        patternOf(preset, startLocalDate),
        1,
        RecurrenceRule.endOf(rule),
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
    startLocalDate: LocalDate,
    current: RecurrenceRule | null,
  ): RecurrenceRule | null {
    if (preset === RepeatPreset.Never) return null;
    return fitted(
      patternOf(preset, startLocalDate),
      1,
      current === null ? null : RecurrenceRule.endOf(current),
      startLocalDate,
    );
  },

  /**
   * «Персонализирано», tapped: the rule there is (the same struct), or —
   * from nothing — Google's own custom default, every week on the start's
   * weekday.
   */
  ruleForCustom(
    startLocalDate: LocalDate,
    current: RecurrenceRule | null,
  ): RecurrenceRule | null {
    return (
      current ??
      VisitDraftSystem.ruleForPreset(RepeatPreset.Weekly, startLocalDate, null)
    );
  },

  /**
   * The frequency changed: the start's own days for it, the interval and
   * the end kept. The same struct back when the frequency is unchanged, or
   * when no rule of the new frequency can be made.
   */
  ruleForFrequency(
    rule: RecurrenceRule,
    frequency: RecurrenceFrequency,
    startLocalDate: LocalDate,
  ): RecurrenceRule {
    if (RecurrenceRule.frequency(rule) === frequency) return rule;
    return (
      fitted(
        RecurrenceSystem.patternFor(frequency, startLocalDate),
        rule.recurrenceInterval,
        RecurrenceRule.endOf(rule),
        startLocalDate,
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
    recurrenceEnd: RecurrenceEnd,
    startLocalDate: LocalDate,
  ): RecurrenceRule {
    if (rule.recurrenceEnd === recurrenceEnd) return rule;
    const series = RecurrenceSystem.series(startLocalDate, rule);
    let end: RecurrenceEndRule;
    if (recurrenceEnd === RecurrenceEnd.Count) {
      end = RecurrenceEndRule.count(
        series.ok ? series.value.localDates.length : DEFAULT_COUNT,
      );
    } else if (series.ok) {
      const days = series.value.localDates;
      end = RecurrenceEndRule.until(days[days.length - 1] as LocalDate);
    } else {
      end = VisitDraftSystem.defaultEnd(
        RecurrenceRule.frequency(rule),
        startLocalDate,
      );
    }
    const next = RecurrenceRule.create(
      RecurrenceRule.patternOf(rule),
      rule.recurrenceInterval,
      end,
    );
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
    fromLocalDate: LocalDate,
    toLocalDate: LocalDate,
  ): RecurrenceRule {
    const followed = RecurrenceSystem.followingStart(
      rule,
      fromLocalDate,
      toLocalDate,
    );
    return (
      fitted(
        RecurrenceRule.patternOf(followed),
        followed.recurrenceInterval,
        RecurrenceRule.endOf(followed),
        toLocalDate,
      ) ?? followed
    );
  },
} as const;
