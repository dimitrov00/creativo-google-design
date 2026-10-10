import { StreakDefinitionId } from '../entities/streak-definition.entity';
import { DayKey } from './day-key.data';
import {
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from './engagement-errors.data';
import type { LocalizedText } from './localized-text.data';
import { Locale } from './locale.data';
import { Result } from './result.data';
import { StreakInterval, StreakIntervalKind } from './streak-interval.data';
import { StreakQualifier, StreakQualifierKind } from './streak-qualifier.data';

/**
 * What never counts against the client's rhythm. The first three are the
 * shop calling a visit off; `closedDays` is the due date falling on days
 * the shop was closed, with no booking involved. Today the tuple
 * `STREAK_EXCUSES` (`streak-definition.ts:34`); stored strings unchanged.
 */
export const StreakExcuse = {
  ShopClosure: 'shopClosure',
  BarberAbsence: 'barberAbsence',
  StaffCancelled: 'staffCancelled',
  ClosedDays: 'closedDays',
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

/** What a miss does: the count starts over (the best stays), or it holds and goes on at the next visit. */
export const StreakOnBreak = {
  Restart: 'restart',
  Hold: 'hold',
} as const;
export type StreakOnBreak = (typeof StreakOnBreak)[keyof typeof StreakOnBreak];

const STREAK_ON_BREAK: readonly StreakOnBreak[] = Object.values(StreakOnBreak);

/**
 * What a new rule does to the runs that exist: `grandfather` keeps every
 * count, best and banked protection and never moves an open due date
 * earlier; `recompute` replays the history under the new rule.
 */
export const StreakTransition = {
  Grandfather: 'grandfather',
  Recompute: 'recompute',
} as const;
export type StreakTransition =
  (typeof StreakTransition)[keyof typeof StreakTransition];

/**
 * A change, by whom it favours. `looser` and `stricter` are the client's
 * view; `mixed` is both at once; `neutral` moves nothing for the client
 * (the staff's cue, the name, a figure of a part that is off); `switch` is
 * the rule going on or off, whatever else moved with it.
 */
export const StreakRuleDirection = {
  Looser: 'looser',
  Stricter: 'stricter',
  Mixed: 'mixed',
  Neutral: 'neutral',
  Switch: 'switch',
} as const;
export type StreakRuleDirection =
  (typeof StreakRuleDirection)[keyof typeof StreakRuleDirection];

/**
 * A parameter of the rule a change can list, in the rule's own order —
 * every one of them, and the head's name. A version's identity (`version`,
 * `effectiveFromDayKey`) is never listed: it is what every revision changes.
 */
export const StreakRuleParameter = {
  Name: 'name',
  Enabled: 'enabled',
  Qualifier: 'qualifier',
  MinGapDays: 'minGapDays',
  BookingHold: 'bookingHold',
  Interval: 'interval',
  GraceDays: 'graceDays',
  RiskLeadDays: 'riskLeadDays',
  Protections: 'protections',
  Excuses: 'excuses',
  ClientPause: 'clientPause',
  Repair: 'repair',
  OnBreak: 'onBreak',
} as const;
export type StreakRuleParameter =
  (typeof StreakRuleParameter)[keyof typeof StreakRuleParameter];

/**
 * ONE VERSION of the rhythm's rule, «Посещения в ритъм», as the admin
 * publishes it (client-card revision 3 §4.1, P1–P12) — the body the head
 * holds as `current` and `scheduled` and every version document holds at
 * its root (§3.1). It carries neither the rule's id (the document's) nor
 * its name (the head's). Every figure is whole days or a count. The UI word
 * for a protection is «защита»; a protection is automatic and free, a
 * no-show never breaks the rhythm by itself and the best run never
 * decreases — fixed by ethics, not parameters.
 *
 * Declared change (§2.6 StreakDefinitionEntity): the stored `effectiveFrom`
 * day is `effectiveFromDayKey`.
 */
export type StreakRule = {
  /** Rises by one with every publish; versions count from 1. */
  readonly version: number;
  /** The first shop-calendar DAY this version judges by. */
  readonly effectiveFromDayKey: DayKey;
  /** P1. Off: the rhythm is shown nowhere and nothing moves; runs are held, never erased. */
  readonly enabled: boolean;
  /** P2. Which visit keeps the rhythm. */
  readonly qualifier: StreakQualifier;
  /** P3. A visit closer than this to the last counted one moves the due date and adds nothing to the count. */
  readonly minGapDays: number;
  /** P4. A visit on the book, starting no later than this past the due date, keeps the period open. */
  readonly bookingHold: StreakRule.BookingHold;
  /** P5. */
  readonly interval: StreakInterval;
  /** P6. Days after the due date in which a visit still keeps the run. */
  readonly graceDays: number;
  /** P7. How early the staff's card turns to its cue. Coaching only. */
  readonly riskLeadDays: number;
  /** P8. A protection covers one missed due date and moves it one interval on. */
  readonly protections: StreakRule.Protections;
  /** P9. In the vocabulary's order, each once. */
  readonly excuses: readonly StreakExcuse[];
  /** P10. */
  readonly clientPause: StreakRule.ClientPause;
  /** P11. The first counted visit within the window of a break restores the run. */
  readonly repair: StreakRule.Repair;
  /** P12. */
  readonly onBreak: StreakOnBreak;
};

/** The version that waits for its day, and what it will do to the runs that exist — the head's `scheduled`. */
export type ScheduledStreakRule = StreakRule & {
  readonly transition: StreakTransition;
};

type Whole = { readonly min: number; readonly max: number };

/**
 * Every range of the rule, inclusive, in ONE table: what `parse` refuses by
 * and what an editor clamps to (`STREAK_LIMITS`). Three figures have a
 * second bound that moves with the rule: grace, the cue and the minimum
 * gap stay under the shortest interval, and nobody starts with more
 * protections than the reserve holds.
 */
const LIMITS = {
  interval: StreakInterval.LIMITS,
  minGapDays: { min: 0, max: 14 },
  bookingHold: { maxDaysPastDue: { min: 0, max: 28 } },
  graceDays: { min: 0, max: 21 },
  riskLeadDays: { min: 0, max: 21 },
  protections: {
    maxBanked: { min: 0, max: 5 },
    earnEvery: { min: 1, max: 24 },
    startWith: { min: 0, max: 5 },
  },
  clientPause: { maxDaysPerYear: { min: 0, max: 180 } },
  repair: {
    windowDays: { min: 1, max: 60 },
    perYear: { min: 1, max: 4 },
  },
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
  effectiveFromDayKey: DayKey.of('2025-03-01'),
  enabled: true,
  qualifier: { kind: StreakQualifierKind.AnyVisit },
  minGapDays: 7,
  bookingHold: { enabled: true, maxDaysPastDue: 14 },
  interval: { kind: StreakIntervalKind.Fixed, days: 42 },
  graceDays: 7,
  riskLeadDays: 7,
  protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 0 },
  excuses: STREAK_SHOP_EXCUSES,
  clientPause: { enabled: false, maxDaysPerYear: 90 },
  repair: { enabled: true, windowDays: 14, perYear: 1 },
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
   * it reaches a document or a client. The result is a fresh struct; the
   * excuses come back in the vocabulary's order, each once, and the
   * qualifier's lists de-duplicated.
   */
  parse(
    raw: StreakRule,
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
    if (!DayKey.isValid(raw.effectiveFromDayKey)) {
      errors.push(
        EngagementError.streakRule(
          EngagementErrorCode.StreakEffectiveDayInvalid,
          StreakRuleField.EffectiveFromDayKey,
          raw.effectiveFromDayKey,
        ),
      );
    }

    const qualifier = StreakQualifier.parse(raw.qualifier);
    if (!qualifier.ok) pushAll(errors, qualifier.error);
    const interval = StreakInterval.parse(raw.interval);
    if (!interval.ok) pushAll(errors, interval.error);

    // What stays under the interval is judged against a SOUND interval
    // only: with a broken one, the figure's own range is all that is known.
    const shortest = interval.ok
      ? StreakInterval.shortestDays(interval.value)
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
    const hold = LIMITS.bookingHold.maxDaysPastDue;
    if (!wholeWithin(raw.bookingHold.maxDaysPastDue, hold)) {
      errors.push(
        range(
          EngagementErrorCode.StreakBookingHoldOutOfRange,
          StreakRuleField.BookingHoldMaxDaysPastDue,
          raw.bookingHold.maxDaysPastDue,
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

    const { maxBanked, earnEvery, startWith } = raw.protections;
    const reserveHolds = wholeWithin(maxBanked, LIMITS.protections.maxBanked);
    if (!reserveHolds) {
      errors.push(
        range(
          EngagementErrorCode.StreakProtectionsOutOfRange,
          StreakRuleField.ProtectionsMaxBanked,
          maxBanked,
          LIMITS.protections.maxBanked,
        ),
      );
    }
    if (!wholeWithin(earnEvery, LIMITS.protections.earnEvery)) {
      errors.push(
        range(
          EngagementErrorCode.StreakProtectionsOutOfRange,
          StreakRuleField.ProtectionsEarnEvery,
          earnEvery,
          LIMITS.protections.earnEvery,
        ),
      );
    }
    if (!wholeWithin(startWith, LIMITS.protections.startWith)) {
      errors.push(
        range(
          EngagementErrorCode.StreakProtectionsOutOfRange,
          StreakRuleField.ProtectionsStartWith,
          startWith,
          LIMITS.protections.startWith,
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

    const pause = LIMITS.clientPause.maxDaysPerYear;
    if (!wholeWithin(raw.clientPause.maxDaysPerYear, pause)) {
      errors.push(
        range(
          EngagementErrorCode.StreakClientPauseOutOfRange,
          StreakRuleField.ClientPauseMaxDaysPerYear,
          raw.clientPause.maxDaysPerYear,
          pause,
        ),
      );
    }
    if (!wholeWithin(raw.repair.windowDays, LIMITS.repair.windowDays)) {
      errors.push(
        range(
          EngagementErrorCode.StreakRepairOutOfRange,
          StreakRuleField.RepairWindowDays,
          raw.repair.windowDays,
          LIMITS.repair.windowDays,
        ),
      );
    }
    if (!wholeWithin(raw.repair.perYear, LIMITS.repair.perYear)) {
      errors.push(
        range(
          EngagementErrorCode.StreakRepairOutOfRange,
          StreakRuleField.RepairPerYear,
          raw.repair.perYear,
          LIMITS.repair.perYear,
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

    if (errors.length > 0 || !qualifier.ok || !interval.ok) {
      return Result.err(errors);
    }
    return Result.ok({
      version: raw.version,
      effectiveFromDayKey: raw.effectiveFromDayKey,
      enabled: raw.enabled,
      qualifier: qualifier.value,
      minGapDays: raw.minGapDays,
      bookingHold: {
        enabled: raw.bookingHold.enabled,
        maxDaysPastDue: raw.bookingHold.maxDaysPastDue,
      },
      interval: interval.value,
      graceDays: raw.graceDays,
      riskLeadDays: raw.riskLeadDays,
      protections: {
        enabled: raw.protections.enabled,
        maxBanked,
        earnEvery,
        startWith,
      },
      excuses: inVocabularyOrder(raw.excuses),
      clientPause: {
        enabled: raw.clientPause.enabled,
        maxDaysPerYear: raw.clientPause.maxDaysPerYear,
      },
      repair: {
        enabled: raw.repair.enabled,
        windowDays: raw.repair.windowDays,
        perYear: raw.repair.perYear,
      },
      onBreak: raw.onBreak,
    });
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
  isExcused(rule: StreakRule, cause: StreakExcuse): boolean {
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
  code: EngagementError.StreakRangeCode,
  field: StreakRuleField,
  value: unknown,
  bounds: Whole,
): EngagementError.StreakRange {
  return EngagementError.streakRuleRange(
    code,
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
  export type BookingHold = {
    readonly enabled: boolean;
    readonly maxDaysPastDue: number;
  };
  export type Protections = {
    readonly enabled: boolean;
    readonly maxBanked: number;
    readonly earnEvery: number;
    readonly startWith: number;
  };
  export type ClientPause = {
    readonly enabled: boolean;
    readonly maxDaysPerYear: number;
  };
  export type Repair = {
    readonly enabled: boolean;
    readonly windowDays: number;
    readonly perYear: number;
  };
}
