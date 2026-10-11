import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  EngagementErrorCode,
  HeadRole,
  LocalDate,
  type ScheduledStreakRule,
  ServiceCategoryId,
  ServiceId,
  StreakExcuse as SystemExcuse,
  StreakIntervalRule,
  StreakOnBreak as SystemOnBreak,
  StreakQualifierRule,
  type StreakRule,
  StreakRuleDirection as SystemDirection,
  StreakRuleSystem,
  type StreakScheduleError,
  type StreakSchedule as SystemSchedule,
  StreakTransition as SystemTransition,
  defect,
} from '@creativo/ecs-core';
import { IsoDate } from './loyalty-calendar';
import type {
  StreakDefinition,
  StreakExcuse,
  StreakOnBreak,
  StreakRuleChange,
  StreakRuleDirection,
} from './streak-definition';
import type { StreakIntervalProps } from './streak-interval';
import type { StreakQualifierProps } from './streak-qualifier';
import {
  StreakDefinitionError,
  StreakScheduleIdMismatchError,
  StreakScheduledNotAfterCurrentError,
  StreakUnknownOptionError,
  StreakVersionNotRisingError,
} from './streak-definition.errors';

/*
 * The rhythm's head over time — a thin shim since the ECS migration's
 * Phase 2: which version a day is judged by, what waits, and the earliest
 * day a change may start are `StreakRuleSystem` (`@creativo/ecs-core`,
 * `streak-rule.system.ts`); the day count is `LocalDate`'s epoch-day math.
 * The class keeps its API and the instances it was handed; the bridge to
 * the plain structs is the private helpers at the end. The one check the
 * system does not make — both halves name the same rule — stays here with
 * the class that carries ids (engagement Q8 retired it with the class).
 */

/**
 * What a new rule does to the runs that exist: `grandfather` keeps every
 * count, best and banked protection and never moves an open due date
 * earlier; `recompute` replays the history under the new rule.
 */
export const STREAK_TRANSITIONS = ['grandfather', 'recompute'] as const;
export type StreakTransition = (typeof STREAK_TRANSITIONS)[number];

/** A rule that waits for its day, and what it will do to the runs that exist. */
export interface ScheduledStreakDefinition {
  readonly definition: StreakDefinition;
  readonly transition: StreakTransition;
}

/** When a change may take effect: whether clients see the rhythm yet, and the notice they are owed (R29). */
export interface StreakNoticePolicy {
  readonly clientsSeeRhythm: boolean;
  readonly noticeDays: number;
}

/**
 * The shape the legacy reader (`Date.parse` of `${day}T00:00:00.000Z`)
 * accepted: four-digit year, month 01–12, day 01–31 — a day past the
 * month's end rolls over, exactly as `LocalDate.epochDayOf` rolls it.
 */
const ISO_DAY_SHAPE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * The calendar day `days` after `day` (before it, when negative). Two
 * dates and a count, no instant between them, so no zone and no DST:
 * `LocalDate`'s epoch days, civil integer arithmetic — the ONE calendar.
 * Text that is no calendar day is refused at this edge the way it always
 * was (a `RangeError`), never computed on.
 */
export function addDays(day: IsoDate, days: number): IsoDate {
  if (!ISO_DAY_SHAPE.test(day)) throw new RangeError('Invalid time value');
  return LocalDate.fromEpochDay(
    LocalDate.epochDayOf(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)),
      Number(day.slice(8, 10)),
    ) + days,
  );
}

/**
 * `streakDefinitions/{id}`, the head document as a model: the rule in
 * force and at most ONE that waits for its day. A reader resolves the rule
 * BY DATE, so nothing has to run at midnight to flip it.
 */
export class StreakDefinitionSchedule {
  private constructor(
    readonly current: StreakDefinition,
    readonly scheduled: ScheduledStreakDefinition | null,
  ) {}

  static create(props: {
    current: StreakDefinition;
    scheduled: {
      definition: StreakDefinition;
      transition: StreakTransition;
    } | null;
  }): Result<StreakDefinitionSchedule, StreakDefinitionError[]> {
    const { current, scheduled } = props;
    if (scheduled === null) {
      return ok(new StreakDefinitionSchedule(current, null));
    }
    const { definition, transition } = scheduled;
    const errors: StreakDefinitionError[] = [];
    if (definition.id !== current.id) {
      errors.push(new StreakScheduleIdMismatchError(current.id, definition.id));
    }
    const checked = StreakRuleSystem.schedule(
      ruleOf(current),
      waitingOf(definition, transition),
    );
    if (!checked.ok) {
      for (const error of checked.error) {
        errors.push(legacyErrorOf(error, current, definition, transition));
      }
    }
    if (errors.length > 0) return fail(errors);
    return ok(
      new StreakDefinitionSchedule(
        current,
        Object.freeze({ definition, transition }),
      ),
    );
  }

  /** The rule's id: both halves are versions of it. */
  get id(): string {
    return this.current.id;
  }

  /** The rule a Sofia day is judged by: what waits, from its own day on. */
  inForceOn(today: IsoDate): StreakDefinition {
    return StreakRuleSystem.inForceOn(headOf(this), dayOf(today)).headRole ===
      HeadRole.Current
      ? this.current
      : (this.scheduled?.definition ?? this.current);
  }

  /** What still waits on a Sofia day, or `null` once its day has come. */
  upcomingOn(today: IsoDate): ScheduledStreakDefinition | null {
    return StreakRuleSystem.upcomingOn(headOf(this), dayOf(today)) === null
      ? null
      : this.scheduled;
  }

  /**
   * The earliest day a change may take effect. What only moves the staff's
   * cue may start today. What favours the client, and the rule going on or
   * off, starts tomorrow: a day is judged by ONE rule. What takes
   * something away starts tomorrow while no client can see the rhythm, and
   * a notice period ahead once one can.
   */
  static earliestEffectiveDay(
    change: StreakRuleChange,
    today: IsoDate,
    policy: StreakNoticePolicy,
  ): IsoDate {
    return StreakRuleSystem.earliestEffectiveDay(
      SYSTEM_DIRECTION[change.direction],
      dayOf(today),
      policy,
    );
  }
}

// ── The bridge: legacy class ↔ ecs-core struct (Phase 4 deletes it) ──────

const SYSTEM_EXCUSE = {
  shopClosure: SystemExcuse.ShopClosure,
  barberAbsence: SystemExcuse.BarberAbsence,
  staffCancelled: SystemExcuse.StaffCancelled,
  closedDays: SystemExcuse.ClosedDays,
} as const satisfies Record<StreakExcuse, SystemExcuse>;

const SYSTEM_ON_BREAK = {
  restart: SystemOnBreak.Restart,
  hold: SystemOnBreak.Hold,
} as const satisfies Record<StreakOnBreak, SystemOnBreak>;

const SYSTEM_TRANSITION = {
  grandfather: SystemTransition.Grandfather,
  recompute: SystemTransition.Recompute,
} as const satisfies Record<StreakTransition, SystemTransition>;

const SYSTEM_DIRECTION = {
  looser: SystemDirection.Looser,
  stricter: SystemDirection.Stricter,
  mixed: SystemDirection.Mixed,
  neutral: SystemDirection.Neutral,
  switch: SystemDirection.Switch,
} as const satisfies Record<StreakRuleDirection, SystemDirection>;

/** A Sofia day the head is asked about: a clock's «today», a checked version day. */
function dayOf(raw: IsoDate): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/**
 * A transition in the system's words. One the vocabulary does not know
 * (an untyped caller's) is handed across as written: the system's own
 * guard refuses it, and the legacy error names it.
 */
function transitionOf(transition: StreakTransition): SystemTransition {
  const known: SystemTransition | undefined = (
    SYSTEM_TRANSITION as Readonly<Record<string, SystemTransition>>
  )[transition];
  return known ?? (transition as string as SystemTransition);
}

/**
 * A version as the system reads it: the class's figures, flat (every
 * part's figures prefixed by the part), its day a `LocalDate`, every tag
 * the dictionary's.
 */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  return {
    version: props.version,
    effectiveFromLocalDate: dayOf(props.effectiveFrom),
    enabled: props.enabled,
    ...qualifierOf(props.qualifier),
    minGapDays: props.minGapDays,
    bookingHoldEnabled: props.bookingHold.enabled,
    bookingHoldMaxDaysPastDue: props.bookingHold.maxDaysPastDue,
    ...intervalOf(props.interval),
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protectionsEnabled: props.protections.enabled,
    protectionsMaxBanked: props.protections.maxBanked,
    protectionsEarnEvery: props.protections.earnEvery,
    protectionsStartWith: props.protections.startWith,
    excuses: props.excuses.map((excuse) => SYSTEM_EXCUSE[excuse]),
    clientPauseEnabled: props.clientPause.enabled,
    clientPauseMaxDaysPerYear: props.clientPause.maxDaysPerYear,
    repairEnabled: props.repair.enabled,
    repairWindowDays: props.repair.windowDays,
    repairPerYear: props.repair.perYear,
    onBreak: SYSTEM_ON_BREAK[props.onBreak],
  };
}

function qualifierOf(qualifier: StreakQualifierProps): StreakQualifierRule {
  switch (qualifier.kind) {
    case 'services':
      return StreakQualifierRule.services(
        qualifier.serviceIds.map((id) => ServiceId.of(id)),
      );
    case 'categories':
      return StreakQualifierRule.categories(
        qualifier.categoryIds.map((id) => ServiceCategoryId.of(id)),
      );
    default:
      return StreakQualifierRule.anyVisit();
  }
}

function intervalOf(interval: StreakIntervalProps): StreakIntervalRule {
  return interval.kind === 'fixed'
    ? StreakIntervalRule.fixed(interval.days)
    : StreakIntervalRule.personal(
        interval.tolerancePct,
        interval.minDays,
        interval.maxDays,
        interval.fallbackDays,
      );
}

function waitingOf(
  definition: StreakDefinition,
  transition: StreakTransition,
): ScheduledStreakRule {
  return { ...ruleOf(definition), streakTransition: transitionOf(transition) };
}

/** The head as the system reads it: its `rules` list, the rule in force first. */
function headOf(schedule: StreakDefinitionSchedule): SystemSchedule {
  const { scheduled } = schedule;
  const current = {
    ...ruleOf(schedule.current),
    headRole: HeadRole.Current,
    streakTransition: null,
  };
  return {
    rules:
      scheduled === null
        ? [current]
        : [
            current,
            {
              ...waitingOf(scheduled.definition, scheduled.transition),
              headRole: HeadRole.Scheduled,
            },
          ],
  };
}

/** The system's struct error as the class the legacy readers know. */
function legacyErrorOf(
  error: StreakScheduleError,
  current: StreakDefinition,
  definition: StreakDefinition,
  transition: StreakTransition,
): StreakDefinitionError {
  switch (error.errorCode) {
    case EngagementErrorCode.StreakScheduleVersionNotRising:
      return new StreakVersionNotRisingError(
        current.version,
        definition.version,
      );
    case EngagementErrorCode.StreakScheduleNotAfterCurrent:
      return new StreakScheduledNotAfterCurrentError(
        current.effectiveFrom,
        definition.effectiveFrom,
      );
    default:
      return new StreakUnknownOptionError(
        'scheduled.transition',
        transition,
        STREAK_TRANSITIONS,
      );
  }
}
