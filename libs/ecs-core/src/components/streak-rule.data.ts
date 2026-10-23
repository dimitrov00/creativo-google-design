import {
  StreakDefinitionId,
  LocalDate,
  Locale,
  Result,
} from '@core/primitives';
import {
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from '@core/errors';
import type { LocalizedText } from './localized-text.data';
import { StreakInterval, StreakIntervalRule } from './streak-interval.data';
import { StreakQualifier, StreakQualifierRule } from './streak-qualifier.data';

/**
 * What never counts against the client's rhythm — the rule's `excuses`
 * (1-to-N). The first three are the shop calling a visit off;
 * `CLOSED_DAYS` is the due date falling on days the shop was closed, with
 * no booking involved. Today the tuple `STREAK_EXCUSES`
 * (`streak-definition.ts:34`).
 */
export const StreakExcuse = {
  ShopClosure: 'SHOP_CLOSURE',
  BarberAbsence: 'BARBER_ABSENCE',
  StaffCancelled: 'STAFF_CANCELLED',
  ClosedDays: 'CLOSED_DAYS',
} as const;
export type StreakExcuse = (typeof StreakExcuse)[keyof typeof StreakExcuse];

/** Every excuse, dictionary order — the order a rule's `excuses` are kept in. */
export const STREAK_EXCUSES: readonly StreakExcuse[] =
  Object.values(StreakExcuse);

/** The excuses that are a visit the SHOP called off: the rule's sentence promises them together. Derived. */
export const STREAK_SHOP_EXCUSES: readonly StreakExcuse[] = [
  StreakExcuse.ShopClosure,
  StreakExcuse.BarberAbsence,
  StreakExcuse.StaffCancelled,
];

/** What a miss does: the count starts over (the best stays), or it holds and goes on at the next visit — the rule's `onBreak`. */
export const StreakOnBreak = {
  Restart: 'RESTART',
  Hold: 'HOLD',
} as const;
export type StreakOnBreak = (typeof StreakOnBreak)[keyof typeof StreakOnBreak];

const STREAK_ON_BREAK: readonly StreakOnBreak[] = Object.values(StreakOnBreak);

/**
 * What a new rule does to the runs that exist — the field
 * `streakTransition`: `GRANDFATHER` keeps every count, best and banked
 * protection and never moves an open due date earlier; `RECOMPUTE` replays
 * the history under the new rule.
 */
export const StreakTransition = {
  Grandfather: 'GRANDFATHER',
  Recompute: 'RECOMPUTE',
} as const;
export type StreakTransition =
  (typeof StreakTransition)[keyof typeof StreakTransition];

/**
 * A change, by whom it favours — the field `streakRuleDirection`. `LOOSER`
 * and `STRICTER` are the client's view; `MIXED` is both at once; `NEUTRAL`
 * moves nothing for the client (the staff's cue, the name, a figure of a
 * part that is off); `SWITCH` is the rule going on or off, whatever else
 * moved with it.
 */
export const StreakRuleDirection = {
  Looser: 'LOOSER',
  Stricter: 'STRICTER',
  Mixed: 'MIXED',
  Neutral: 'NEUTRAL',
  Switch: 'SWITCH',
} as const;
export type StreakRuleDirection =
  (typeof StreakRuleDirection)[keyof typeof StreakRuleDirection];

/**
 * A parameter of the rule a change can list, in the rule's own order —
 * every one of them, and the head's name. A version's identity (`version`,
 * `effectiveFromLocalDate`) is never listed: it is what every revision
 * changes. They name rule PARTS in the UI: consumers map by this dictionary.
 */
export const StreakRuleParameter = {
  Name: 'NAME',
  Enabled: 'ENABLED',
  Qualifier: 'QUALIFIER',
  MinGapDays: 'MIN_GAP_DAYS',
  BookingHold: 'BOOKING_HOLD',
  Interval: 'INTERVAL',
  GraceDays: 'GRACE_DAYS',
  RiskLeadDays: 'RISK_LEAD_DAYS',
  Protections: 'PROTECTIONS',
  Excuses: 'EXCUSES',
  ClientPause: 'CLIENT_PAUSE',
  Repair: 'REPAIR',
  OnBreak: 'ON_BREAK',
} as const;
export type StreakRuleParameter =
  (typeof StreakRuleParameter)[keyof typeof StreakRuleParameter];

/** Where a rule stands in its head's `rules` list — the field `headRole`. */
export const HeadRole = {
  /** In force since its day — exactly one per head. */
  Current: 'CURRENT',
  /** Waiting for its day — at most one per head. */
  Scheduled: 'SCHEDULED',
} as const;
export type HeadRole = (typeof HeadRole)[keyof typeof HeadRole];

/**
 * ONE VERSION of the rhythm's rule, «Посещения в ритъм», as the admin
 * publishes it (client-card revision 3 §4.1, P1–P12) — FLAT (Law 6): the
 * four option parts of today's nested rule (`bookingHold`, `protections`,
 * `clientPause`, `repair`) sit at the root prefixed by their part (N9), the
 * qualifier and the interval are variant slices intersected in. It is what
 * every element of the head's `rules` list holds, and what every version
 * document holds at its root (§3.1). It carries neither the rule's id (the
 * document's) nor its name (the head's). Every figure is whole days or a
 * count. The UI word for a protection is «защита»; a protection is
 * automatic and free, a no-show never breaks the rhythm by itself and the
 * best run never decreases — fixed by ethics, not parameters.
 */
export type StreakRule = StreakRule.Options &
  StreakQualifierRule &
  StreakIntervalRule;

/**
 * A rule as FOREIGN input (the L3 escape, F-22): every figure as a draft or
 * an admin callable holds it, and its first day AS WRITTEN — the editor's
 * day is no brand until {@link StreakRule.parse}, the only way it becomes a
 * `LocalDate` (Law 7.4). Every `StreakRule` is one.
 */
export type StreakRuleInput = Omit<
  StreakRule.Options,
  'effectiveFromLocalDate'
> & {
  /** The first day the version would judge by, as written — `parse` checks it is a real calendar day. */
  readonly effectiveFromLocalDate: string;
} & StreakQualifierRule &
  StreakIntervalRule;

/** The version that waits for its day, and what it will do to the runs that exist — a system value. */
export type ScheduledStreakRule = StreakRule & {
  readonly streakTransition: StreakTransition;
};

/**
 * One element of the head's 1-to-N `rules` list (F-9): a whole flat rule
 * and its role — the `CURRENT` one in force (no transition), or the
 * `SCHEDULED` one waiting with what it will do to the runs.
 */
export type StreakHeadRule = StreakRule & {
  readonly headRole: HeadRole;
  readonly streakTransition: StreakTransition | null;
};

type Whole = { readonly min: number; readonly max: number };

/**
 * Every range of the rule, inclusive, in ONE table keyed by the flat
 * fields: what `parse` refuses by and what an editor clamps to. Three
 * figures have a second bound that moves with the rule: grace, the cue and
 * the minimum gap stay under the shortest interval, and nobody starts with
 * more protections than the reserve holds.
 */
const LIMITS = {
  intervalDays: StreakIntervalRule.LIMITS.intervalDays,
  intervalTolerancePct: StreakIntervalRule.LIMITS.intervalTolerancePct,
  minGapDays: { min: 0, max: 14 },
  bookingHoldMaxDaysPastDue: { min: 0, max: 28 },
  graceDays: { min: 0, max: 21 },
  riskLeadDays: { min: 0, max: 21 },
  protectionsMaxBanked: { min: 0, max: 5 },
  protectionsEarnEvery: { min: 1, max: 24 },
  protectionsStartWith: { min: 0, max: 5 },
  clientPauseMaxDaysPerYear: { min: 0, max: 180 },
  repairWindowDays: { min: 1, max: 60 },
  repairPerYear: { min: 1, max: 4 },
} as const;

/**
 * The recommended rule, and what an editor opens on when the shop has
 * published none: a visit every six weeks, a week of grace, a week's cue,
 * two protections earned one per five visits, every visit the shop calls
 * off excused, one way back a year within two weeks of a break, and a miss
 * that starts the count over (`StreakDefinition.default()`).
 */
const DEFAULT_RULE: StreakRule = {
  version: 1,
  /** 2025-03-01 — the day the dev shop opened its rhythm (pure civil math, no cast). */
  effectiveFromLocalDate: LocalDate.fromEpochDay(
    LocalDate.epochDayOf(2025, 3, 1),
  ),
  enabled: true,
  streakQualifier: StreakQualifier.AnyVisit,
  minGapDays: 7,
  bookingHoldEnabled: true,
  bookingHoldMaxDaysPastDue: 14,
  streakInterval: StreakInterval.Fixed,
  intervalDays: 42,
  graceDays: 7,
  riskLeadDays: 7,
  protectionsEnabled: true,
  protectionsMaxBanked: 2,
  protectionsEarnEvery: 5,
  protectionsStartWith: 0,
  excuses: STREAK_SHOP_EXCUSES,
  clientPauseEnabled: false,
  clientPauseMaxDaysPerYear: 90,
  repairEnabled: true,
  repairWindowDays: 14,
  repairPerYear: 1,
  onBreak: StreakOnBreak.Restart,
};

/** The recommended rule's name. */
const DEFAULT_NAME: LocalizedText = {
  bg: 'Посещения в ритъм',
  en: 'Visits in rhythm',
};

function wholeWithin(value: unknown, range: Whole): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
  );
}

export const StreakRule = {
  LIMITS,

  /**
   * The notice, in whole days, a stricter rule owes the clients who can see
   * the rhythm (R29); while nobody can, a stricter rule may start tomorrow.
   * The ONE figure the publish pipeline's notice policy and the admin
   * page's assessment share.
   */
  RULE_CHANGE_NOTICE_DAYS: 30,

  /**
   * The recommended rule (version 1) — what `StreakDefinition.default()`
   * serves today. A constant, so identity is irrelevant (engagement Q7);
   * `StreakPublishSystem.assess`/`decide` and the admin store read it.
   */
  DEFAULT: DEFAULT_RULE,

  /**
   * The business's one rhythm: the stable id the recommended rule is served
   * under (`'cadence'`), and the only id a head may be opened under before
   * anything is published.
   */
  DEFAULT_DEFINITION_ID: StreakDefinitionId.of('cadence'),

  /** The recommended rule's name, the head's `name` until an admin renames it. */
  DEFAULT_NAME,

  /**
   * The edge guard — `StreakDefinition.create` minus the head's id and name:
   * every figure inside its range, grace and the cue shorter than the
   * shortest interval, a reserve that can hold what a run starts with. A
   * rule that reads as nonsense is refused with EVERY fault at once, before
   * it reaches a document or a client. The result is a fresh flat struct;
   * the excuses come back in the vocabulary's order, each once, and the
   * qualifier's lists de-duplicated.
   */
  parse(
    raw: StreakRuleInput,
  ): Result<StreakRule, readonly EngagementError.StreakRuleError[]> {
    const errors: EngagementError.StreakRuleError[] = [];

    if (!Number.isInteger(raw.version) || raw.version < 1) {
      errors.push(
        EngagementError.streakRule(
          EngagementErrorCode.StreakVersionNotPositive,
          StreakRuleField.Version,
          raw.version,
        ),
      );
    }
    // The smart constructor is the only door from the written day to the
    // brand (Law 7.4); a non-string is refused the same way.
    const effectiveFrom =
      typeof raw.effectiveFromLocalDate === 'string'
        ? LocalDate.parse(raw.effectiveFromLocalDate)
        : null;
    if (effectiveFrom === null || !effectiveFrom.ok) {
      errors.push(
        EngagementError.streakRule(
          EngagementErrorCode.StreakEffectiveDayInvalid,
          StreakRuleField.EffectiveFromLocalDate,
          raw.effectiveFromLocalDate,
        ),
      );
    }

    const qualifier = StreakQualifierRule.parse(raw);
    if (!qualifier.ok) pushAll(errors, qualifier.error);
    const interval = StreakIntervalRule.parse(raw);
    if (!interval.ok) pushAll(errors, interval.error);

    // What stays under the interval is judged against a SOUND interval
    // only: with a broken one, the figure's own range is all that is known.
    const shortest = interval.ok
      ? StreakIntervalRule.shortestDays(interval.value)
      : null;
    const under = (range: Whole): Whole =>
      shortest === null
        ? range
        : { min: range.min, max: Math.min(range.max, shortest - 1) };

    const minGap = under(LIMITS.minGapDays);
    if (!wholeWithin(raw.minGapDays, minGap)) {
      errors.push(
        range(
          EngagementErrorCode.StreakMinGapOutOfRange,
          StreakRuleField.MinGapDays,
          raw.minGapDays,
          minGap,
        ),
      );
    }
    const hold = LIMITS.bookingHoldMaxDaysPastDue;
    if (!wholeWithin(raw.bookingHoldMaxDaysPastDue, hold)) {
      errors.push(
        range(
          EngagementErrorCode.StreakBookingHoldOutOfRange,
          StreakRuleField.BookingHoldMaxDaysPastDue,
          raw.bookingHoldMaxDaysPastDue,
          hold,
        ),
      );
    }
    if (!wholeWithin(raw.graceDays, LIMITS.graceDays)) {
      errors.push(
        range(
          EngagementErrorCode.StreakGraceOutOfRange,
          StreakRuleField.GraceDays,
          raw.graceDays,
          LIMITS.graceDays,
        ),
      );
    } else if (shortest !== null && raw.graceDays >= shortest) {
      errors.push(
        EngagementError.streakGraceNotShorterThanInterval(
          raw.graceDays,
          shortest,
        ),
      );
    }
    const riskLead = under(LIMITS.riskLeadDays);
    if (!wholeWithin(raw.riskLeadDays, riskLead)) {
      errors.push(
        range(
          EngagementErrorCode.StreakRiskLeadOutOfRange,
          StreakRuleField.RiskLeadDays,
          raw.riskLeadDays,
          riskLead,
        ),
      );
    }

    const maxBanked = raw.protectionsMaxBanked;
    const earnEvery = raw.protectionsEarnEvery;
    const startWith = raw.protectionsStartWith;
    const reserveHolds = wholeWithin(maxBanked, LIMITS.protectionsMaxBanked);
    if (!reserveHolds) {
      errors.push(
        range(
          EngagementErrorCode.StreakProtectionsOutOfRange,
          StreakRuleField.ProtectionsMaxBanked,
          maxBanked,
          LIMITS.protectionsMaxBanked,
        ),
      );
    }
    if (!wholeWithin(earnEvery, LIMITS.protectionsEarnEvery)) {
      errors.push(
        range(
          EngagementErrorCode.StreakProtectionsOutOfRange,
          StreakRuleField.ProtectionsEarnEvery,
          earnEvery,
          LIMITS.protectionsEarnEvery,
        ),
      );
    }
    if (!wholeWithin(startWith, LIMITS.protectionsStartWith)) {
      errors.push(
        range(
          EngagementErrorCode.StreakProtectionsOutOfRange,
          StreakRuleField.ProtectionsStartWith,
          startWith,
          LIMITS.protectionsStartWith,
        ),
      );
    } else if (reserveHolds && startWith > maxBanked) {
      errors.push(
        EngagementError.streakStartWithAboveCap(startWith, maxBanked),
      );
    }

    for (let i = 0; i < raw.excuses.length; i++) {
      const excuse: unknown = raw.excuses[i];
      if (!isStreakExcuse(excuse)) {
        errors.push(
          EngagementError.streakRule(
            EngagementErrorCode.StreakUnknownExcuse,
            StreakRuleField.Excuses,
            excuse,
          ),
        );
      }
    }

    const pause = LIMITS.clientPauseMaxDaysPerYear;
    if (!wholeWithin(raw.clientPauseMaxDaysPerYear, pause)) {
      errors.push(
        range(
          EngagementErrorCode.StreakClientPauseOutOfRange,
          StreakRuleField.ClientPauseMaxDaysPerYear,
          raw.clientPauseMaxDaysPerYear,
          pause,
        ),
      );
    }
    if (!wholeWithin(raw.repairWindowDays, LIMITS.repairWindowDays)) {
      errors.push(
        range(
          EngagementErrorCode.StreakRepairOutOfRange,
          StreakRuleField.RepairWindowDays,
          raw.repairWindowDays,
          LIMITS.repairWindowDays,
        ),
      );
    }
    if (!wholeWithin(raw.repairPerYear, LIMITS.repairPerYear)) {
      errors.push(
        range(
          EngagementErrorCode.StreakRepairOutOfRange,
          StreakRuleField.RepairPerYear,
          raw.repairPerYear,
          LIMITS.repairPerYear,
        ),
      );
    }
    if (!isOneOf(STREAK_ON_BREAK, raw.onBreak)) {
      errors.push(
        EngagementError.streakUnknownOption(
          StreakRuleField.OnBreak,
          raw.onBreak,
          STREAK_ON_BREAK,
        ),
      );
    }

    if (
      errors.length > 0 ||
      effectiveFrom === null ||
      !effectiveFrom.ok ||
      !qualifier.ok ||
      !interval.ok
    ) {
      return Result.err(errors);
    }
    return Result.ok({
      version: raw.version,
      effectiveFromLocalDate: effectiveFrom.value,
      enabled: raw.enabled,
      ...qualifier.value,
      minGapDays: raw.minGapDays,
      bookingHoldEnabled: raw.bookingHoldEnabled,
      bookingHoldMaxDaysPastDue: raw.bookingHoldMaxDaysPastDue,
      ...interval.value,
      graceDays: raw.graceDays,
      riskLeadDays: raw.riskLeadDays,
      protectionsEnabled: raw.protectionsEnabled,
      protectionsMaxBanked: maxBanked,
      protectionsEarnEvery: earnEvery,
      protectionsStartWith: startWith,
      excuses: inVocabularyOrder(raw.excuses),
      clientPauseEnabled: raw.clientPauseEnabled,
      clientPauseMaxDaysPerYear: raw.clientPauseMaxDaysPerYear,
      repairEnabled: raw.repairEnabled,
      repairWindowDays: raw.repairWindowDays,
      repairPerYear: raw.repairPerYear,
      onBreak: raw.onBreak,
    });
  },

  /**
   * The rule alone — a fresh flat struct of exactly the rule's own fields,
   * whatever else the struct handed in carries (a head element's `headRole`
   * and `streakTransition`, a version document's history), the lists copied.
   */
  of(rule: StreakRule): StreakRule {
    return {
      version: rule.version,
      effectiveFromLocalDate: rule.effectiveFromLocalDate,
      enabled: rule.enabled,
      ...StreakQualifierRule.of(rule),
      minGapDays: rule.minGapDays,
      bookingHoldEnabled: rule.bookingHoldEnabled,
      bookingHoldMaxDaysPastDue: rule.bookingHoldMaxDaysPastDue,
      ...StreakIntervalRule.of(rule),
      graceDays: rule.graceDays,
      riskLeadDays: rule.riskLeadDays,
      protectionsEnabled: rule.protectionsEnabled,
      protectionsMaxBanked: rule.protectionsMaxBanked,
      protectionsEarnEvery: rule.protectionsEarnEvery,
      protectionsStartWith: rule.protectionsStartWith,
      excuses: [...rule.excuses],
      clientPauseEnabled: rule.clientPauseEnabled,
      clientPauseMaxDaysPerYear: rule.clientPauseMaxDaysPerYear,
      repairEnabled: rule.repairEnabled,
      repairWindowDays: rule.repairWindowDays,
      repairPerYear: rule.repairPerYear,
      onBreak: rule.onBreak,
    };
  },

  /**
   * The head's id guard (`streakDefinitions/{id}`): a blank or
   * whitespace-only id is refused; anything else is kept exactly as given.
   */
  parseDefinitionId(
    raw: string,
  ): Result<StreakDefinitionId, EngagementError.StreakBare> {
    return typeof raw === 'string' && raw.trim().length > 0
      ? Result.ok(StreakDefinitionId.of(raw))
      : Result.err(
          EngagementError.streakRule(
            EngagementErrorCode.StreakIdEmpty,
            StreakRuleField.Id,
            raw,
          ),
        );
  },

  /**
   * The head's name guard: a rule is named in BOTH languages, each trimmed;
   * every blank one is reported, `en` first (the `LocalizedText.create`
   * order the legacy refusal followed).
   */
  parseName(
    raw: LocalizedText,
  ): Result<LocalizedText, readonly EngagementError.StreakRuleError[]> {
    const bg = raw.bg.trim();
    const en = raw.en.trim();
    const errors: EngagementError.StreakRuleError[] = [];
    if (en.length === 0)
      errors.push(EngagementError.streakNameEmpty(Locale.En, raw.en));
    if (bg.length === 0)
      errors.push(EngagementError.streakNameEmpty(Locale.Bg, raw.bg));
    return errors.length > 0 ? Result.err(errors) : Result.ok({ bg, en });
  },

  /** Is this cause one the rule never counts against the client? */
  isExcused(rule: Pick<StreakRule, 'excuses'>, cause: StreakExcuse): boolean {
    return isOneOf(rule.excuses, cause);
  },
} as const;

export function isStreakExcuse(raw: unknown): raw is StreakExcuse {
  return isOneOf(STREAK_EXCUSES, raw);
}

function isOneOf<T extends string>(
  values: readonly T[],
  raw: unknown,
): raw is T {
  for (let i = 0; i < values.length; i++) if (values[i] === raw) return true;
  return false;
}

function pushAll<T>(into: T[], from: readonly T[]): void {
  for (let i = 0; i < from.length; i++) into.push(from[i] as T);
}

function range(
  errorCode: EngagementError.StreakRangeCode,
  field: StreakRuleField,
  value: unknown,
  bounds: Whole,
): EngagementError.StreakRange {
  return EngagementError.streakRuleRange(
    errorCode,
    field,
    value,
    bounds.min,
    bounds.max,
  );
}

/** The excuses a rule names, in the vocabulary's order, each once. */
function inVocabularyOrder(
  excuses: readonly StreakExcuse[],
): readonly StreakExcuse[] {
  const out: StreakExcuse[] = [];
  for (let i = 0; i < STREAK_EXCUSES.length; i++) {
    const excuse = STREAK_EXCUSES[i] as StreakExcuse;
    if (isOneOf(excuses, excuse)) out.push(excuse);
  }
  return out;
}

export namespace StreakRule {
  /**
   * The rule's own flat fields — every option part at the root, prefixed
   * by its part — beside which the qualifier and interval slices sit.
   */
  export type Options = {
    /** Rises by one with every publish; versions count from 1. */
    readonly version: number;
    /** The first shop-calendar DAY this version judges by. */
    readonly effectiveFromLocalDate: LocalDate;
    /** P1. Off: the rhythm is shown nowhere and nothing moves; runs are held, never erased. */
    readonly enabled: boolean;
    /** P3. A visit closer than this to the last counted one moves the due date and adds nothing to the count. */
    readonly minGapDays: number;
    /** P4. A visit on the book, starting no later than `bookingHoldMaxDaysPastDue` past the due date, keeps the period open. */
    readonly bookingHoldEnabled: boolean;
    readonly bookingHoldMaxDaysPastDue: number;
    /** P6. Days after the due date in which a visit still keeps the run. */
    readonly graceDays: number;
    /** P7. How early the staff's card turns to its cue. Coaching only. */
    readonly riskLeadDays: number;
    /** P8. A protection covers one missed due date and moves it one interval on. */
    readonly protectionsEnabled: boolean;
    readonly protectionsMaxBanked: number;
    readonly protectionsEarnEvery: number;
    readonly protectionsStartWith: number;
    /** P9. In the vocabulary's order, each once (1-to-N). */
    readonly excuses: readonly StreakExcuse[];
    /** P10. */
    readonly clientPauseEnabled: boolean;
    readonly clientPauseMaxDaysPerYear: number;
    /** P11. The first counted visit within the window of a break restores the run. */
    readonly repairEnabled: boolean;
    readonly repairWindowDays: number;
    readonly repairPerYear: number;
    /** P12. */
    readonly onBreak: StreakOnBreak;
  };
}
