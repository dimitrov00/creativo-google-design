import type { DayKey } from '../components/day-key.data';
import {
  EngagementError,
  StreakRuleField,
} from '../components/engagement-errors.data';
import { Result } from '../components/result.data';
import {
  StreakInterval,
  StreakIntervalKind,
} from '../components/streak-interval.data';
import {
  QualifierComparison,
  StreakQualifier,
  StreakQualifierKind,
} from '../components/streak-qualifier.data';
import {
  STREAK_SHOP_EXCUSES,
  StreakOnBreak,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
  type ScheduledStreakRule,
  type StreakExcuse,
  type StreakRule,
} from '../components/streak-rule.data';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * THE RHYTHM'S RULE, OVER TIME (client-card revision 3 §4.1, §4.4) — the
 * math of `streak-schedule.ts` (the head: which version a day is judged by,
 * what waits, the earliest day a change may start) and of the rule's own
 * comparisons in `streak-definition.ts` (`changeFrom`, `summary`,
 * `equals`). The edge guard of one version is the component's
 * (`StreakRule.parse`); everything here takes rules already parsed.
 *
 * The head's id is not checked against its versions: the bodies carry no
 * id, and the business has one constant rhythm (`StreakRule.DEFAULT_
 * DEFINITION_ID`) — engagement Q8 retired `streak_schedule.id_mismatch`.
 */

/** The rule in force and at most ONE that waits for its day — the head's two halves (`StreakDefinitionEntity`). */
export type StreakSchedule = {
  readonly current: StreakRule;
  readonly scheduled: ScheduledStreakRule | null;
};

/** When a change may take effect: whether clients see the rhythm yet, and the notice they are owed (R29). */
export type StreakNoticePolicy = {
  readonly clientsSeeRhythm: boolean;
  readonly noticeDays: number;
};

/** A change, by whom it favours, and the parameters that moved, in the rule's own order. */
export type StreakRuleChange = {
  readonly direction: StreakRuleDirection;
  /** Never a version's identity (`version`, `effectiveFromDayKey`): every revision changes that. */
  readonly changed: readonly StreakRuleParameter[];
};

/**
 * The rule as the card and the editor word it: structure, never copy. A
 * part is `null` when the rule has nothing to say about it, so a sentence
 * is printed only for what holds.
 */
export type StreakRuleSummary = {
  readonly enabled: boolean;
  readonly interval: StreakInterval;
  readonly graceDays: number;
  /** `null`: protections are off, or the reserve holds none. */
  readonly protections: {
    readonly maxBanked: number;
    readonly earnEvery: number;
  } | null;
  /** Every visit the shop calls off is excused: all of `STREAK_SHOP_EXCUSES`. */
  readonly shopExcuses: boolean;
  /** `null`: off, or no day past the due date is held. */
  readonly hold: { readonly maxDaysPastDue: number } | null;
  /** `null`: off, or a miss holds the count and there is nothing to restore. */
  readonly repair: { readonly windowDays: number } | null;
  /** A miss does not reset the count. */
  readonly holdsCount: boolean;
  readonly qualifier: StreakQualifier;
};

/** What a schedule refuses: a waiting version that does not follow, or a transition nobody knows. */
export type StreakScheduleError =
  | EngagementError.StreakScheduleVersionNotRising
  | EngagementError.StreakScheduleNotAfterCurrent
  | EngagementError.StreakUnknownOption;

/** Every transition, dictionary order — what an unknown one is refused against. */
const STREAK_TRANSITIONS: readonly StreakTransition[] =
  Object.values(StreakTransition);

/** A part's direction: never `switch`, which only the rule as a whole takes. */
type PartDirection =
  | typeof StreakRuleDirection.Looser
  | typeof StreakRuleDirection.Stricter
  | typeof StreakRuleDirection.Mixed
  | typeof StreakRuleDirection.Neutral;

/** Which way a figure moved, given which way is the client's. */
function moved(
  before: number,
  after: number,
  more: typeof StreakRuleDirection.Looser | typeof StreakRuleDirection.Stricter,
): PartDirection {
  if (after === before) return StreakRuleDirection.Neutral;
  const less =
    more === StreakRuleDirection.Looser
      ? StreakRuleDirection.Stricter
      : StreakRuleDirection.Looser;
  return after > before ? more : less;
}

function blend(parts: readonly PartDirection[]): PartDirection {
  let looser = false;
  let stricter = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as PartDirection;
    if (part === StreakRuleDirection.Mixed) return StreakRuleDirection.Mixed;
    if (part === StreakRuleDirection.Looser) looser = true;
    if (part === StreakRuleDirection.Stricter) stricter = true;
  }
  if (looser && stricter) return StreakRuleDirection.Mixed;
  if (looser) return StreakRuleDirection.Looser;
  return stricter ? StreakRuleDirection.Stricter : StreakRuleDirection.Neutral;
}

function qualifierFrom(after: StreakRule, before: StreakRule): PartDirection {
  switch (StreakQualifier.compare(after.qualifier, before.qualifier)) {
    case QualifierComparison.Same:
      return StreakRuleDirection.Neutral;
    case QualifierComparison.Wider:
      return StreakRuleDirection.Looser;
    case QualifierComparison.Narrower:
      return StreakRuleDirection.Stricter;
    default:
      return StreakRuleDirection.Mixed;
  }
}

/**
 * Two intervals of one kind are compared figure by figure: every figure of
 * an interval lengthens a period as it grows. Across kinds they are
 * compared by the periods they can open: a personal interval whose
 * shortest period is the fixed one's length favours everyone.
 */
function intervalFrom(after: StreakRule, before: StreakRule): PartDirection {
  const a = after.interval;
  const b = before.interval;
  if (
    a.kind === StreakIntervalKind.Fixed &&
    b.kind === StreakIntervalKind.Fixed
  ) {
    return moved(b.days, a.days, StreakRuleDirection.Looser);
  }
  if (
    a.kind === StreakIntervalKind.Personal &&
    b.kind === StreakIntervalKind.Personal
  ) {
    return blend([
      moved(b.tolerancePct, a.tolerancePct, StreakRuleDirection.Looser),
      moved(b.minDays, a.minDays, StreakRuleDirection.Looser),
      moved(b.maxDays, a.maxDays, StreakRuleDirection.Looser),
      moved(b.fallbackDays, a.fallbackDays, StreakRuleDirection.Looser),
    ]);
  }
  const longer =
    StreakInterval.shortestDays(a) >= StreakInterval.longestDays(b);
  const shorter =
    StreakInterval.longestDays(a) <= StreakInterval.shortestDays(b);
  if (longer && shorter) return StreakRuleDirection.Neutral;
  if (longer) return StreakRuleDirection.Looser;
  return shorter ? StreakRuleDirection.Stricter : StreakRuleDirection.Mixed;
}

/** What the reserve can hold: nothing when protections are off. */
const reserveOf = (rule: StreakRule): number =>
  rule.protections.enabled ? rule.protections.maxBanked : 0;

/** The days past the due date a booking holds: none when the hold is off. */
const heldDays = (rule: StreakRule): number =>
  rule.bookingHold.enabled ? rule.bookingHold.maxDaysPastDue : 0;

/** The days a year a client may pause: none when the pause is off. */
const pauseDays = (rule: StreakRule): number =>
  rule.clientPause.enabled ? rule.clientPause.maxDaysPerYear : 0;

function protectionsFrom(after: StreakRule, before: StreakRule): PartDirection {
  const a = reserveOf(after);
  const b = reserveOf(before);
  if (a === 0 || b === 0) return moved(b, a, StreakRuleDirection.Looser);
  return blend([
    moved(b, a, StreakRuleDirection.Looser),
    moved(
      before.protections.earnEvery,
      after.protections.earnEvery,
      StreakRuleDirection.Stricter,
    ),
    moved(
      before.protections.startWith,
      after.protections.startWith,
      StreakRuleDirection.Looser,
    ),
  ]);
}

/** The way back matters only where a miss breaks the run: under `hold` nothing is broken, before or after. */
function repairFrom(after: StreakRule, before: StreakRule): PartDirection {
  if (
    after.onBreak === StreakOnBreak.Hold ||
    before.onBreak === StreakOnBreak.Hold
  ) {
    return StreakRuleDirection.Neutral;
  }
  const a = after.repair;
  const b = before.repair;
  if (!a.enabled || !b.enabled) {
    return moved(
      Number(b.enabled),
      Number(a.enabled),
      StreakRuleDirection.Looser,
    );
  }
  return blend([
    moved(b.windowDays, a.windowDays, StreakRuleDirection.Looser),
    moved(b.perYear, a.perYear, StreakRuleDirection.Looser),
  ]);
}

function includes(
  excuses: readonly StreakExcuse[],
  excuse: StreakExcuse,
): boolean {
  for (let i = 0; i < excuses.length; i++)
    if (excuses[i] === excuse) return true;
  return false;
}

/** Any excuse of `a` that `b` does not name. */
function addsAny(
  a: readonly StreakExcuse[],
  b: readonly StreakExcuse[],
): boolean {
  for (let i = 0; i < a.length; i++) {
    if (!includes(b, a[i] as StreakExcuse)) return true;
  }
  return false;
}

/** The same excuses in the same order — the stored list is in the vocabulary's order. */
function sameList(
  a: readonly StreakExcuse[],
  b: readonly StreakExcuse[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function copyInterval(interval: StreakInterval): StreakInterval {
  return interval.kind === StreakIntervalKind.Fixed
    ? StreakInterval.fixed(interval.days)
    : StreakInterval.personal(
        interval.tolerancePct,
        interval.minDays,
        interval.maxDays,
        interval.fallbackDays,
      );
}

function copyQualifier(qualifier: StreakQualifier): StreakQualifier {
  switch (qualifier.kind) {
    case StreakQualifierKind.Services:
      return StreakQualifier.services([...qualifier.serviceIds]);
    case StreakQualifierKind.Categories:
      return StreakQualifier.categories([...qualifier.categoryIds]);
    default:
      return StreakQualifier.anyVisit();
  }
}

export const StreakRuleSystem = {
  /**
   * A head as a model: the rule in force and at most ONE that waits — a
   * later version (a withdrawn number may be skipped), from a later day, by
   * a transition the vocabulary knows. Every fault at once, in that order.
   */
  schedule(
    current: StreakRule,
    scheduled: ScheduledStreakRule | null,
  ): Result<StreakSchedule, readonly StreakScheduleError[]> {
    if (scheduled === null) return Result.ok({ current, scheduled: null });
    const errors: StreakScheduleError[] = [];
    if (scheduled.version <= current.version) {
      errors.push(
        EngagementError.streakScheduleVersionNotRising(
          current.version,
          scheduled.version,
        ),
      );
    }
    if (scheduled.effectiveFromDayKey <= current.effectiveFromDayKey) {
      errors.push(
        EngagementError.streakScheduleNotAfterCurrent(
          current.effectiveFromDayKey,
          scheduled.effectiveFromDayKey,
        ),
      );
    }
    let known = false;
    for (let i = 0; i < STREAK_TRANSITIONS.length; i++) {
      if (STREAK_TRANSITIONS[i] === scheduled.transition) known = true;
    }
    if (!known) {
      errors.push(
        EngagementError.streakUnknownOption(
          StreakRuleField.ScheduledTransition,
          scheduled.transition,
          STREAK_TRANSITIONS,
        ),
      );
    }
    return errors.length > 0
      ? Result.err(errors)
      : Result.ok({ current, scheduled });
  },

  /** The rule a shop day is judged by: what waits, from its own day on. A reader resolves BY DATE, so nothing flips at midnight. */
  inForceOn(head: StreakSchedule, today: DayKey): StreakRule {
    const { scheduled } = head;
    return scheduled !== null && today >= scheduled.effectiveFromDayKey
      ? scheduled
      : head.current;
  },

  /** What still waits on a shop day, or `null` once its day has come. */
  upcomingOn(head: StreakSchedule, today: DayKey): ScheduledStreakRule | null {
    const { scheduled } = head;
    return scheduled !== null && today < scheduled.effectiveFromDayKey
      ? scheduled
      : null;
  },

  /**
   * The earliest day a change may take effect. What only moves the staff's
   * cue may start today. What favours the client, and the rule going on or
   * off, starts tomorrow: a day is judged by ONE rule. What takes something
   * away starts tomorrow while no client can see the rhythm, and a notice
   * period ahead once one can.
   */
  earliestEffectiveDay(
    direction: StreakRuleDirection,
    today: DayKey,
    policy: StreakNoticePolicy,
  ): DayKey {
    switch (direction) {
      case StreakRuleDirection.Neutral:
        return today;
      case StreakRuleDirection.Looser:
      case StreakRuleDirection.Switch:
        return ZonedTimeSystem.addDays(today, 1);
      default:
        return ZonedTimeSystem.addDays(
          today,
          policy.clientsSeeRhythm ? Math.max(1, policy.noticeDays) : 1,
        );
    }
  },

  /**
   * What moved from `before` to `after`, and whom it favours. A part is
   * judged by what it DOES: a figure of a part that is off, before and
   * after, is listed as changed and moves nothing (`neutral`). The name is
   * the head's, not a version's: `nameChanged` says whether it moved.
   */
  changeFrom(
    after: StreakRule,
    before: StreakRule,
    nameChanged: boolean,
  ): StreakRuleChange {
    const changed: StreakRuleParameter[] = [];
    const parts: PartDirection[] = [];
    const part = (
      parameter: StreakRuleParameter,
      differs: boolean,
      direction: () => PartDirection,
    ): void => {
      if (!differs) return;
      changed.push(parameter);
      parts.push(direction());
    };
    const neutral = (): PartDirection => StreakRuleDirection.Neutral;

    part(StreakRuleParameter.Name, nameChanged, neutral);
    part(
      StreakRuleParameter.Enabled,
      after.enabled !== before.enabled,
      neutral,
    );
    part(
      StreakRuleParameter.Qualifier,
      !StreakQualifier.equals(after.qualifier, before.qualifier),
      () => qualifierFrom(after, before),
    );
    part(
      StreakRuleParameter.MinGapDays,
      after.minGapDays !== before.minGapDays,
      () =>
        moved(
          before.minGapDays,
          after.minGapDays,
          StreakRuleDirection.Stricter,
        ),
    );
    part(
      StreakRuleParameter.BookingHold,
      after.bookingHold.enabled !== before.bookingHold.enabled ||
        after.bookingHold.maxDaysPastDue !== before.bookingHold.maxDaysPastDue,
      () =>
        moved(heldDays(before), heldDays(after), StreakRuleDirection.Looser),
    );
    part(
      StreakRuleParameter.Interval,
      !StreakInterval.equals(after.interval, before.interval),
      () => intervalFrom(after, before),
    );
    part(
      StreakRuleParameter.GraceDays,
      after.graceDays !== before.graceDays,
      () =>
        moved(before.graceDays, after.graceDays, StreakRuleDirection.Looser),
    );
    part(
      StreakRuleParameter.RiskLeadDays,
      after.riskLeadDays !== before.riskLeadDays,
      neutral,
    );
    part(
      StreakRuleParameter.Protections,
      after.protections.enabled !== before.protections.enabled ||
        after.protections.maxBanked !== before.protections.maxBanked ||
        after.protections.earnEvery !== before.protections.earnEvery ||
        after.protections.startWith !== before.protections.startWith,
      () => protectionsFrom(after, before),
    );
    part(
      StreakRuleParameter.Excuses,
      !sameList(after.excuses, before.excuses),
      () =>
        blend([
          addsAny(after.excuses, before.excuses)
            ? StreakRuleDirection.Looser
            : StreakRuleDirection.Neutral,
          addsAny(before.excuses, after.excuses)
            ? StreakRuleDirection.Stricter
            : StreakRuleDirection.Neutral,
        ]),
    );
    part(
      StreakRuleParameter.ClientPause,
      after.clientPause.enabled !== before.clientPause.enabled ||
        after.clientPause.maxDaysPerYear !== before.clientPause.maxDaysPerYear,
      () =>
        moved(pauseDays(before), pauseDays(after), StreakRuleDirection.Looser),
    );
    part(
      StreakRuleParameter.Repair,
      after.repair.enabled !== before.repair.enabled ||
        after.repair.windowDays !== before.repair.windowDays ||
        after.repair.perYear !== before.repair.perYear,
      () => repairFrom(after, before),
    );
    part(StreakRuleParameter.OnBreak, after.onBreak !== before.onBreak, () =>
      after.onBreak === StreakOnBreak.Hold
        ? StreakRuleDirection.Looser
        : StreakRuleDirection.Stricter,
    );

    return {
      direction:
        after.enabled !== before.enabled
          ? StreakRuleDirection.Switch
          : blend(parts),
      changed,
    };
  },

  /** The rule as structure for its sentences; the interval and the qualifier are fresh copies. */
  summary(rule: StreakRule): StreakRuleSummary {
    const { protections, bookingHold, repair } = rule;
    let shopExcuses = true;
    for (let i = 0; i < STREAK_SHOP_EXCUSES.length; i++) {
      if (!includes(rule.excuses, STREAK_SHOP_EXCUSES[i] as StreakExcuse)) {
        shopExcuses = false;
      }
    }
    return {
      enabled: rule.enabled,
      interval: copyInterval(rule.interval),
      graceDays: rule.graceDays,
      protections:
        protections.enabled && protections.maxBanked > 0
          ? {
              maxBanked: protections.maxBanked,
              earnEvery: protections.earnEvery,
            }
          : null,
      shopExcuses,
      hold:
        bookingHold.enabled && bookingHold.maxDaysPastDue > 0
          ? { maxDaysPastDue: bookingHold.maxDaysPastDue }
          : null,
      repair:
        repair.enabled && rule.onBreak === StreakOnBreak.Restart
          ? { windowDays: repair.windowDays }
          : null,
      holdsCount: rule.onBreak === StreakOnBreak.Hold,
      qualifier: copyQualifier(rule.qualifier),
    };
  },

  /** The same version (number and day) with the same figures; the name is the head's and not compared. */
  equals(a: StreakRule, b: StreakRule): boolean {
    return (
      a.version === b.version &&
      a.effectiveFromDayKey === b.effectiveFromDayKey &&
      StreakRuleSystem.changeFrom(a, b, false).changed.length === 0
    );
  },
} as const;
