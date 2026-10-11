import {
  EngagementError,
  StreakRuleField,
  Result,
  defect,
  LocalDate,
} from '@core/primitives';
import {
  StreakInterval,
  StreakIntervalRule,
  QualifierComparison,
  StreakQualifierRule,
  HeadRole,
  STREAK_SHOP_EXCUSES,
  StreakOnBreak,
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
  type ScheduledStreakRule,
  type StreakExcuse,
  type StreakHeadRule,
} from '@core/components';
import type { StreakDefinition } from '@core/entities';

/*
 * THE RHYTHM'S RULE, OVER TIME (client-card revision 3 §4.1, §4.4) — the
 * math of `streak-schedule.ts` (the head: which version a day is judged by,
 * what waits, the earliest day a change may start) and of the rule's own
 * comparisons in `streak-definition.ts` (`changeFrom`, `summary`,
 * `equals`). The edge guard of one version is the component's
 * (`StreakRule.parse`); everything here takes rules already parsed — flat
 * (Law 6), the qualifier and the interval variant slices of the rule.
 *
 * The head is the 1-to-N `rules` list (F-9): one `CURRENT` element, at most
 * one `SCHEDULED`, sorted by `effectiveFromLocalDate`. The head's id is not
 * checked against its versions: the bodies carry no id, and the business
 * has one constant rhythm (`StreakRule.DEFAULT_DEFINITION_ID`) —
 * engagement Q8 retired `streak_schedule.id_mismatch`.
 */

/**
 * The rule in force and at most ONE that waits for its day — the head's
 * `rules` list, so the head entity is handed in as it is (Law 3).
 */
export type StreakSchedule = Pick<StreakDefinition, 'rules'>;

/** When a change may take effect: whether clients see the rhythm yet, and the notice they are owed (R29). */
export type StreakNoticePolicy = {
  readonly clientsSeeRhythm: boolean;
  readonly noticeDays: number;
};

/** A change, by whom it favours, and the parameters that moved, in the rule's own order. */
export type StreakRuleChange = {
  readonly direction: StreakRuleDirection;
  /** Never a version's identity (`version`, `effectiveFromLocalDate`): every revision changes that. */
  readonly changed: readonly StreakRuleParameter[];
};

/**
 * The rule as the card and the editor word it: structure, never copy — a
 * system value (F-8): the interval and the qualifier are slices of their
 * own. A part is `null` when the rule has nothing to say about it, so a
 * sentence is printed only for what holds.
 */
export type StreakRuleSummary = {
  readonly enabled: boolean;
  readonly interval: StreakIntervalRule;
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
  readonly qualifier: StreakQualifierRule;
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
  switch (StreakQualifierRule.compare(after, before)) {
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
  if (
    after.streakInterval === StreakInterval.Fixed &&
    before.streakInterval === StreakInterval.Fixed
  ) {
    return moved(
      before.intervalDays,
      after.intervalDays,
      StreakRuleDirection.Looser,
    );
  }
  if (
    after.streakInterval === StreakInterval.Personal &&
    before.streakInterval === StreakInterval.Personal
  ) {
    return blend([
      moved(
        before.intervalTolerancePct,
        after.intervalTolerancePct,
        StreakRuleDirection.Looser,
      ),
      moved(
        before.intervalMinDays,
        after.intervalMinDays,
        StreakRuleDirection.Looser,
      ),
      moved(
        before.intervalMaxDays,
        after.intervalMaxDays,
        StreakRuleDirection.Looser,
      ),
      moved(
        before.intervalFallbackDays,
        after.intervalFallbackDays,
        StreakRuleDirection.Looser,
      ),
    ]);
  }
  const longer =
    StreakIntervalRule.shortestDays(after) >=
    StreakIntervalRule.longestDays(before);
  const shorter =
    StreakIntervalRule.longestDays(after) <=
    StreakIntervalRule.shortestDays(before);
  if (longer && shorter) return StreakRuleDirection.Neutral;
  if (longer) return StreakRuleDirection.Looser;
  return shorter ? StreakRuleDirection.Stricter : StreakRuleDirection.Mixed;
}

/** What the reserve can hold: nothing when protections are off. */
const reserveOf = (rule: StreakRule): number =>
  rule.protectionsEnabled ? rule.protectionsMaxBanked : 0;

/** The days past the due date a booking holds: none when the hold is off. */
const heldDays = (rule: StreakRule): number =>
  rule.bookingHoldEnabled ? rule.bookingHoldMaxDaysPastDue : 0;

/** The days a year a client may pause: none when the pause is off. */
const pauseDays = (rule: StreakRule): number =>
  rule.clientPauseEnabled ? rule.clientPauseMaxDaysPerYear : 0;

function protectionsFrom(after: StreakRule, before: StreakRule): PartDirection {
  const a = reserveOf(after);
  const b = reserveOf(before);
  if (a === 0 || b === 0) return moved(b, a, StreakRuleDirection.Looser);
  return blend([
    moved(b, a, StreakRuleDirection.Looser),
    moved(
      before.protectionsEarnEvery,
      after.protectionsEarnEvery,
      StreakRuleDirection.Stricter,
    ),
    moved(
      before.protectionsStartWith,
      after.protectionsStartWith,
      StreakRuleDirection.Looser,
    ),
  ]);
}

/** The way back matters only where a miss breaks the run: under `HOLD` nothing is broken, before or after. */
function repairFrom(after: StreakRule, before: StreakRule): PartDirection {
  if (
    after.onBreak === StreakOnBreak.Hold ||
    before.onBreak === StreakOnBreak.Hold
  ) {
    return StreakRuleDirection.Neutral;
  }
  if (!after.repairEnabled || !before.repairEnabled) {
    return moved(
      Number(before.repairEnabled),
      Number(after.repairEnabled),
      StreakRuleDirection.Looser,
    );
  }
  return blend([
    moved(
      before.repairWindowDays,
      after.repairWindowDays,
      StreakRuleDirection.Looser,
    ),
    moved(
      before.repairPerYear,
      after.repairPerYear,
      StreakRuleDirection.Looser,
    ),
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

/** The head's element in one role, or `null` — a linear scan of a list of at most two. */
function inRole(head: StreakSchedule, role: HeadRole): StreakHeadRule | null {
  for (let i = 0; i < head.rules.length; i++) {
    const rule = head.rules[i] as StreakHeadRule;
    if (rule.headRole === role) return rule;
  }
  return null;
}

/** The rule in force since its day — a head always holds one (F-9). */
function currentOf(head: StreakSchedule): StreakHeadRule {
  return (
    inRole(head, HeadRole.Current) ??
    defect('a streak head holds no CURRENT rule')
  );
}

export const StreakRuleSystem = {
  /**
   * A head as a model: the rule in force and at most ONE that waits — a
   * later version (a withdrawn number may be skipped), from a later day, by
   * a transition the vocabulary knows. Every fault at once, in that order.
   * The answer is the head's `rules` list (F-9), sorted by day: the rule in
   * force first, then what waits — each element the rule alone (whatever
   * else the struct handed in carried is not copied) and its role.
   */
  schedule(
    current: StreakRule,
    scheduled: ScheduledStreakRule | null,
  ): Result<StreakSchedule, readonly StreakScheduleError[]> {
    const inForce: StreakHeadRule = {
      ...StreakRule.of(current),
      headRole: HeadRole.Current,
      streakTransition: null,
    };
    if (scheduled === null) return Result.ok({ rules: [inForce] });
    const errors: StreakScheduleError[] = [];
    if (scheduled.version <= current.version) {
      errors.push(
        EngagementError.streakScheduleVersionNotRising(
          current.version,
          scheduled.version,
        ),
      );
    }
    if (scheduled.effectiveFromLocalDate <= current.effectiveFromLocalDate) {
      errors.push(
        EngagementError.streakScheduleNotAfterCurrent(
          current.effectiveFromLocalDate,
          scheduled.effectiveFromLocalDate,
        ),
      );
    }
    let known = false;
    for (let i = 0; i < STREAK_TRANSITIONS.length; i++) {
      if (STREAK_TRANSITIONS[i] === scheduled.streakTransition) known = true;
    }
    if (!known) {
      errors.push(
        EngagementError.streakUnknownOption(
          StreakRuleField.ScheduledTransition,
          scheduled.streakTransition,
          STREAK_TRANSITIONS,
        ),
      );
    }
    return errors.length > 0
      ? Result.err(errors)
      : Result.ok({
          rules: [
            inForce,
            {
              ...StreakRule.of(scheduled),
              headRole: HeadRole.Scheduled,
              streakTransition: scheduled.streakTransition,
            },
          ],
        });
  },

  /** The head's element in force today's role holds — the `CURRENT` one (a head always has it). */
  current(head: StreakSchedule): StreakHeadRule {
    return currentOf(head);
  },

  /** The head's waiting element, its day come or not, or `null` when nothing waits. */
  scheduled(head: StreakSchedule): StreakHeadRule | null {
    return inRole(head, HeadRole.Scheduled);
  },

  /** The rule a shop day is judged by: what waits, from its own day on. A reader resolves BY DATE, so nothing flips at midnight. */
  inForceOn(head: StreakSchedule, today: LocalDate): StreakHeadRule {
    const scheduled = inRole(head, HeadRole.Scheduled);
    return scheduled !== null && today >= scheduled.effectiveFromLocalDate
      ? scheduled
      : currentOf(head);
  },

  /** What still waits on a shop day, or `null` once its day has come. */
  upcomingOn(head: StreakSchedule, today: LocalDate): StreakHeadRule | null {
    const scheduled = inRole(head, HeadRole.Scheduled);
    return scheduled !== null && today < scheduled.effectiveFromLocalDate
      ? scheduled
      : null;
  },

  /**
   * The earliest day a change may take effect. What only moves the staff's
   * cue may start today. What favours the client, and the rule going on or
   * off, starts tomorrow: a day is judged by ONE rule. What takes something
   * away starts tomorrow while no client can see the rhythm, and a notice
   * period ahead once one can. Shop-day arithmetic (T8).
   */
  earliestEffectiveDay(
    direction: StreakRuleDirection,
    today: LocalDate,
    policy: StreakNoticePolicy,
  ): LocalDate {
    switch (direction) {
      case StreakRuleDirection.Neutral:
        return today;
      case StreakRuleDirection.Looser:
      case StreakRuleDirection.Switch:
        return LocalDate.addDays(today, 1);
      default:
        return LocalDate.addDays(
          today,
          policy.clientsSeeRhythm ? Math.max(1, policy.noticeDays) : 1,
        );
    }
  },

  /**
   * What moved from `before` to `after`, and whom it favours. A part is
   * judged by what it DOES: a figure of a part that is off, before and
   * after, is listed as changed and moves nothing (`NEUTRAL`). The name is
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
      !StreakQualifierRule.equals(after, before),
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
      after.bookingHoldEnabled !== before.bookingHoldEnabled ||
        after.bookingHoldMaxDaysPastDue !== before.bookingHoldMaxDaysPastDue,
      () =>
        moved(heldDays(before), heldDays(after), StreakRuleDirection.Looser),
    );
    part(
      StreakRuleParameter.Interval,
      !StreakIntervalRule.equals(after, before),
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
      after.protectionsEnabled !== before.protectionsEnabled ||
        after.protectionsMaxBanked !== before.protectionsMaxBanked ||
        after.protectionsEarnEvery !== before.protectionsEarnEvery ||
        after.protectionsStartWith !== before.protectionsStartWith,
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
      after.clientPauseEnabled !== before.clientPauseEnabled ||
        after.clientPauseMaxDaysPerYear !== before.clientPauseMaxDaysPerYear,
      () =>
        moved(pauseDays(before), pauseDays(after), StreakRuleDirection.Looser),
    );
    part(
      StreakRuleParameter.Repair,
      after.repairEnabled !== before.repairEnabled ||
        after.repairWindowDays !== before.repairWindowDays ||
        after.repairPerYear !== before.repairPerYear,
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

  /** The rule as structure for its sentences; the interval and the qualifier are fresh slices of their own. */
  summary(rule: StreakRule): StreakRuleSummary {
    let shopExcuses = true;
    for (let i = 0; i < STREAK_SHOP_EXCUSES.length; i++) {
      if (!includes(rule.excuses, STREAK_SHOP_EXCUSES[i] as StreakExcuse)) {
        shopExcuses = false;
      }
    }
    return {
      enabled: rule.enabled,
      interval: StreakIntervalRule.of(rule),
      graceDays: rule.graceDays,
      protections:
        rule.protectionsEnabled && rule.protectionsMaxBanked > 0
          ? {
              maxBanked: rule.protectionsMaxBanked,
              earnEvery: rule.protectionsEarnEvery,
            }
          : null,
      shopExcuses,
      hold:
        rule.bookingHoldEnabled && rule.bookingHoldMaxDaysPastDue > 0
          ? { maxDaysPastDue: rule.bookingHoldMaxDaysPastDue }
          : null,
      repair:
        rule.repairEnabled && rule.onBreak === StreakOnBreak.Restart
          ? { windowDays: rule.repairWindowDays }
          : null,
      holdsCount: rule.onBreak === StreakOnBreak.Hold,
      qualifier: StreakQualifierRule.of(rule),
    };
  },

  /** The same version (number and day) with the same figures; the name is the head's and not compared. */
  equals(a: StreakRule, b: StreakRule): boolean {
    return (
      a.version === b.version &&
      a.effectiveFromLocalDate === b.effectiveFromLocalDate &&
      StreakRuleSystem.changeFrom(a, b, false).changed.length === 0
    );
  },
} as const;
