import {
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
  RepeatPreset,
} from '@core/components';
import {
  Weekday,
  defect,
  DraftPersonKey,
  DurationMinutes,
  MinuteDelta,
  LocalDate,
  TrackMinute,
  type MinuteOfDay,
} from '@core/primitives';
import type { TrackSpan } from './grid-layout.system';
import { RecurrenceSystem } from './recurrence.system';

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

/** The key a service picked before anyone was named sits on — `DraftPersonKey.PLACEHOLDER` (`primary`). */
const PLACEHOLDER_CLIENT_ID = DraftPersonKey.PLACEHOLDER;
/** A visit with no service yet still needs a shape to draw: half an hour. */
const DEFAULT_SPAN_MINUTES = durationOf(30);
/**
 * The booking increment — every authored time on a staff sheet lands on it,
 * and the shortest span a visit or a block may be drawn at.
 */
const GRAIN_MINUTES = durationOf(5);
/** A shop day's minutes — a typed end before the start runs into the next day. */
const DAY_MINUTES = 1440;

/** A positive whole number of minutes this file knows is one (a constant, a sum, a span). */
function durationOf(raw: number): DurationMinutes {
  const minutes = DurationMinutes.of(raw);
  return minutes.ok ? minutes.value : defect('visit-draft: a duration ≤ 0');
}

/** The nearer of the two grain marks around `minute` (a half rounds up). */
function snapToGrain(minute: number): number {
  return Math.round(minute / GRAIN_MINUTES) * GRAIN_MINUTES;
}

/** The legs' minutes summed — `null` for no legs at all. */
function legSum(legs: readonly DraftLegMinutes[]): DurationMinutes | null {
  if (legs.length === 0) return null;
  let total = (legs[0] as DraftLegMinutes).durationMinutes;
  for (let i = 1; i < legs.length; i++) {
    total = DurationMinutes.sum(
      total,
      (legs[i] as DraftLegMinutes).durationMinutes,
    );
  }
  return total;
}

/** A leg as the span reads it — its minutes. */
export type DraftLegMinutes = { readonly durationMinutes: DurationMinutes };

/**
 * A leg as the placeholder rule reads it — whose it is: the editor's own
 * person key (a `DraftPersonKey` — an account's uid, a guest's key or
 * {@link PLACEHOLDER_CLIENT_ID}). The rule only compares it with the
 * placeholder and hands a new one over.
 */
export type DraftLegClient = {
  readonly clientId: DraftPersonKey;
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

/** One stranger's name on a visit — the person by the editor's own key. */
export type WalkInLabel = {
  readonly personId: DraftPersonKey;
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
 * - the five-minute grain every authored time lands on, and the typed
 *   pair of a block (`block-editor/staff-block-editor.ts`
 *   `commitStart`/`commitEnd`) — pass C;
 * - the visit's span and the placeholder seats
 *   (`visit-editor/staff-visit-editor.ts` `spanOf`/`seedDraft`/
 *   `adoptPlaceholderLegs`), the frame's and the typed figure's two
 *   override rules and a typed end (`onFrameDraft`/`setDuration`/
 *   `commitEnd`) — pass C;
 * - names for the strangers on one visit (the staff dashboard's
 *   `walkInNames`);
 * - the catalogue tag's arithmetic (the `−10 мин` wording is the dashboard's
 *   `shared/catalog-tag.words.ts`);
 * - the repeat page's policy over a `RecurrenceRule`
 *   (`block-editor/block-repeat.ts`), on `RecurrenceSystem`'s walk.
 */
export const VisitDraftSystem = {
  PLACEHOLDER_CLIENT_ID,
  DEFAULT_SPAN_MINUTES,
  GRAIN_MINUTES,
  REPEAT_PRESETS,
  MONDAY_TO_FRIDAY,

  /* ── The grain ───────────────────────────────────────────────────────── */

  /*
   * THE TRACK AXIS (R-5). A clock minute goes in branded (`MinuteOfDay`); a
   * snapped mark comes out as a `TrackMinute` — a minute on the sheets'
   * anchored axis — because a half rounds up, so `1439` lands on the
   * closing midnight `1440`, which no `MinuteOfDay` holds, while `0` stays
   * `0`, which no `EndMinute` holds. The block sheet's typed pair is a
   * `TrackSpan` for the same reason: a start typed at 23:58 snaps to `1440`
   * and pushes its end one grain past it, to `1445`; clamping either at 1440
   * would change what the sheet does.
   */

  /**
   * A clock minute pulled onto the nearer grain mark — a half rounds up, so
   * `1439` lands on `1440` (the staff sheets' `snap`). A track minute out,
   * in `[0, 1440]`; the caller's own bounds apply after.
   */
  snap(minute: MinuteOfDay): TrackMinute {
    // A whole minute in [0, 1440) rounded to the 5-minute grain: a whole
    // number in [0, 1440] — on the track by construction.
    return TrackMinute.ofProven(snapToGrain(minute));
  },

  /**
   * A clock minute pulled UP to the next grain mark — a walk-in starts at
   * the next tick. A track minute out, in `[0, 1440]` (`1436`–`1439` land
   * on `1440`).
   */
  snapUp(minute: MinuteOfDay): TrackMinute {
    // A whole minute in [0, 1440) raised to the 5-minute grain: a whole
    // number in [0, 1440] — on the track by construction.
    return TrackMinute.ofProven(
      Math.ceil(minute / GRAIN_MINUTES) * GRAIN_MINUTES,
    );
  },

  /**
   * A START typed on a block sheet: snapped, and the end pushed out to keep
   * at least one grain of block after it (an end already further on stays).
   * The draft's pair passes straight in, on the track axis (see above).
   */
  typedStart(range: TrackSpan, minute: MinuteOfDay): TrackSpan {
    const start = snapToGrain(minute);
    // A whole minute of [0, 1440) snapped: a whole number in [0, 1440]; the
    // end is the larger of it plus a grain and the range's own track
    // minute — both whole and non-negative, on the track by construction.
    return {
      startMinute: TrackMinute.ofProven(start),
      endMinute: TrackMinute.ofProven(
        Math.max(start + GRAIN_MINUTES, range.endMinute),
      ),
    };
  },

  /**
   * An END typed on a block sheet: snapped, and the start pulled back to
   * keep at least one grain of block before it (an earlier start stays) —
   * never before the day's first minute.
   */
  typedEnd(range: TrackSpan, minute: MinuteOfDay): TrackSpan {
    const end = snapToGrain(minute);
    const start = Math.min(range.startMinute, end - GRAIN_MINUTES);
    // The snapped end is a whole number in [0, 1440]; the start is whole and
    // floored at 0 — both on the track by construction.
    return {
      startMinute: TrackMinute.ofProven(Math.max(0, start)),
      endMinute: TrackMinute.ofProven(end),
    };
  },

  /**
   * A drawn span floored at one grain — the shortest span a visit or a
   * block may be drawn at. Its minutes are a count read off the track axis
   * (a frame's end minus its start, which may run past midnight; a legs'
   * sum; `0` for none), so they come in raw, as `TrackSpan`'s do; whole
   * minutes, the brand out. No snap: the grid already drew on the grain.
   */
  floorSpan(minutes: number): DurationMinutes {
    return durationOf(Math.max(GRAIN_MINUTES, minutes));
  },

  /**
   * A duration TYPED on the visit sheet, believed: pulled onto the nearer
   * grain mark, then floored at one grain ({@link floorSpan}) — a `0`, a
   * `2` or a negative figure is a typo for the floor, never a shorter
   * booking. The field's figure comes in as the field hands it; the brand
   * comes out — this IS the typed figure's ingestion.
   */
  typedSpan(typed: number): DurationMinutes {
    return VisitDraftSystem.floorSpan(snapToGrain(typed));
  },

  /* ── The span and the placeholder seats ─────────────────────────────── */

  /** The legs' minutes summed — or half an hour for a visit with none yet. */
  legMinutes(legs: readonly DraftLegMinutes[]): DurationMinutes {
    return legSum(legs) ?? DEFAULT_SPAN_MINUTES;
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
   * start to its exclusive end on the frame's track axis — IS the legs' own
   * minutes, else the booked span: only a number that never was the
   * catalogue's is pinned. A span with no length pins nothing. Measured on
   * the track, not the shop's clock: a seeded frame may sit past the closing
   * midnight (its start at 1440, its end beyond it), which no wall-clock
   * span holds — the span is still the frame's, and nothing here refuses it.
   */
  durationOverrideOf(
    start: TrackMinute,
    end: TrackMinute,
    legs: readonly DraftLegMinutes[],
  ): DurationMinutes | null {
    const span = DurationMinutes.of(TrackMinute.span(start, end));
    if (!span.ok) return null;
    return span.value === VisitDraftSystem.legMinutes(legs) ? null : span.value;
  },

  /**
   * The minutes the visit sheet draws — its override, else its legs (half
   * an hour with none), never under one grain. Unlike {@link span}, the
   * legs' figure is floored at {@link GRAIN_MINUTES}.
   */
  editorSpan(
    durationOverride: DurationMinutes | null,
    legs: readonly DraftLegMinutes[],
  ): DurationMinutes {
    if (durationOverride !== null) return durationOverride;
    return VisitDraftSystem.floorSpan(VisitDraftSystem.legMinutes(legs));
  },

  /**
   * The override a FRAME pins (the grid's drag or resize): none when the
   * frame's span is what the legs would draw — their raw sum (`0` with no
   * legs), floored at one grain — else the span. Differs from
   * {@link typedOverrideFor}, which compares a typed figure with the raw
   * sum unfloored, and from {@link durationOverrideOf} (a seeded draft,
   * half an hour for no legs).
   */
  overrideFor(
    span: DurationMinutes,
    legs: readonly DraftLegMinutes[],
  ): DurationMinutes | null {
    const drawn = VisitDraftSystem.floorSpan(legSum(legs) ?? 0);
    return span === drawn ? null : span;
  },

  /**
   * The override a TYPED figure pins (minutes or an end typed on the visit
   * sheet): none when it is the legs' raw sum, else the figure. With no
   * legs the sum is `0`, so any typed figure is pinned — five typed on a
   * draft with no service stores five.
   */
  typedOverrideFor(
    minutes: DurationMinutes,
    legs: readonly DraftLegMinutes[],
  ): DurationMinutes | null {
    return minutes === (legSum(legs) ?? 0) ? null : minutes;
  },

  /**
   * The span an END typed as a clock describes from `start`: an end at or
   * before the start's minute is the NEXT day (a 23:25 cut that ends at
   * 00:15 — never a negative visit), then snapped to the grain and floored
   * at one grain, like a typed duration.
   */
  spanToEnd(start: MinuteOfDay, typedEnd: MinuteOfDay): DurationMinutes {
    let span = typedEnd - (start % DAY_MINUTES);
    if (span <= 0) span += DAY_MINUTES;
    return VisitDraftSystem.typedSpan(span);
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
    personId: DraftPersonKey,
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
    unlabelled: readonly DraftPersonKey[],
    taken: readonly string[],
    word: (number: number | null) => string,
  ): readonly WalkInLabel[] {
    const used = new Set<string>(taken);
    const seen = new Set<DraftPersonKey>();
    const people: DraftPersonKey[] = [];
    for (let i = 0; i < unlabelled.length; i++) {
      const id = unlabelled[i] as DraftPersonKey;
      if (seen.has(id)) continue;
      seen.add(id);
      people.push(id);
    }
    const limit = used.size + people.length + 2;
    const out: WalkInLabel[] = [];
    for (let i = 0; i < people.length; i++) {
      const personId = people[i] as DraftPersonKey;
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
