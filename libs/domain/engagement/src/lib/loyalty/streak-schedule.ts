import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  DayKey,
  EngagementErrorCode,
  type ScheduledStreakRule,
  type ServiceCategoryId,
  type ServiceId,
  StreakIntervalKind,
  StreakQualifierKind,
  type StreakRule,
  type StreakRuleDirection as SystemDirection,
  StreakRuleSystem,
  type StreakScheduleError,
  type StreakSchedule as SystemSchedule,
  ZonedTimeSystem,
} from '@creativo/ecs-core';
import { IsoDate } from './loyalty-calendar';
import type { StreakDefinition, StreakRuleChange } from './streak-definition';
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
 * `streak-rule.system.ts`); the day count is `ZonedTimeSystem.addDays`.
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
 * month's end rolls over, exactly as `ZonedTimeSystem.addDays` rolls it.
 */
const ISO_DAY_SHAPE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * The calendar day `days` after `day` (before it, when negative). Two
 * dates and a count, no instant between them, so no zone and no DST:
 * `ZonedTimeSystem.addDays`, civil integer arithmetic — the ONE calendar.
 * Text that is no calendar day is refused at this edge the way it always
 * was (a `RangeError`), never computed on.
 */
export function addDays(day: IsoDate, days: number): IsoDate {
  if (!ISO_DAY_SHAPE.test(day)) throw new RangeError('Invalid time value');
  return ZonedTimeSystem.addDays(DayKey.of(day), days);
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
    const head = headOf(this);
    return StreakRuleSystem.inForceOn(head, DayKey.of(today)) === head.current
      ? this.current
      : (this.scheduled?.definition ?? this.current);
  }

  /** What still waits on a Sofia day, or `null` once its day has come. */
  upcomingOn(today: IsoDate): ScheduledStreakDefinition | null {
    return StreakRuleSystem.upcomingOn(headOf(this), DayKey.of(today)) === null
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
      change.direction as SystemDirection,
      DayKey.of(today),
      policy,
    );
  }
}

// ── The bridge: legacy class ↔ ecs-core struct (Phase 4 deletes it) ──────

/** A version as the system reads it: the class's figures, with the day as a day key. */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  const qualifier = props.qualifier;
  const interval = props.interval;
  return {
    version: props.version,
    effectiveFromDayKey: DayKey.of(props.effectiveFrom),
    enabled: props.enabled,
    qualifier:
      qualifier.kind === 'services'
        ? {
            kind: StreakQualifierKind.Services,
            serviceIds: qualifier.serviceIds as readonly ServiceId[],
          }
        : qualifier.kind === 'categories'
          ? {
              kind: StreakQualifierKind.Categories,
              categoryIds:
                qualifier.categoryIds as readonly ServiceCategoryId[],
            }
          : { kind: StreakQualifierKind.AnyVisit },
    minGapDays: props.minGapDays,
    bookingHold: props.bookingHold,
    interval:
      interval.kind === 'fixed'
        ? { kind: StreakIntervalKind.Fixed, days: interval.days }
        : {
            kind: StreakIntervalKind.Personal,
            tolerancePct: interval.tolerancePct,
            minDays: interval.minDays,
            maxDays: interval.maxDays,
            fallbackDays: interval.fallbackDays,
          },
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protections: props.protections,
    excuses: props.excuses,
    clientPause: props.clientPause,
    repair: props.repair,
    onBreak: props.onBreak,
  };
}

function waitingOf(
  definition: StreakDefinition,
  transition: StreakTransition,
): ScheduledStreakRule {
  return { ...ruleOf(definition), transition };
}

function headOf(schedule: StreakDefinitionSchedule): SystemSchedule {
  const { scheduled } = schedule;
  return {
    current: ruleOf(schedule.current),
    scheduled:
      scheduled === null
        ? null
        : waitingOf(scheduled.definition, scheduled.transition),
  };
}

/** The system's struct error as the class the legacy readers know. */
function legacyErrorOf(
  error: StreakScheduleError,
  current: StreakDefinition,
  definition: StreakDefinition,
  transition: StreakTransition,
): StreakDefinitionError {
  switch (error.code) {
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
