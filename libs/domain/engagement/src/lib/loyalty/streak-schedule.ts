import { Result, fail, ok } from '@creativo/domain/kernel';
import { IsoDate } from './loyalty-calendar';
import type { StreakDefinition, StreakRuleChange } from './streak-definition';
import {
  StreakDefinitionError,
  StreakScheduleIdMismatchError,
  StreakScheduledNotAfterCurrentError,
  StreakUnknownOptionError,
  StreakVersionNotRisingError,
} from './streak-definition.errors';

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

const DAY_MS = 86_400_000;

/**
 * The calendar day `days` after `day` (before it, when negative). Two
 * dates and a count, no instant between them, so no zone and no DST: the
 * `daysBetween` rule of `loyalty-calendar.ts`, the other way round.
 */
export function addDays(day: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
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
    if (definition.version <= current.version) {
      errors.push(
        new StreakVersionNotRisingError(current.version, definition.version),
      );
    }
    if (definition.effectiveFrom <= current.effectiveFrom) {
      errors.push(
        new StreakScheduledNotAfterCurrentError(
          current.effectiveFrom,
          definition.effectiveFrom,
        ),
      );
    }
    if (!(STREAK_TRANSITIONS as readonly string[]).includes(transition)) {
      errors.push(
        new StreakUnknownOptionError(
          'scheduled.transition',
          transition,
          STREAK_TRANSITIONS,
        ),
      );
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
    const { scheduled } = this;
    return scheduled !== null && today >= scheduled.definition.effectiveFrom
      ? scheduled.definition
      : this.current;
  }

  /** What still waits on a Sofia day, or `null` once its day has come. */
  upcomingOn(today: IsoDate): ScheduledStreakDefinition | null {
    const { scheduled } = this;
    return scheduled !== null && today < scheduled.definition.effectiveFrom
      ? scheduled
      : null;
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
    switch (change.direction) {
      case 'neutral':
        return today;
      case 'looser':
      case 'switch':
        return addDays(today, 1);
      case 'stricter':
      case 'mixed':
        return addDays(
          today,
          policy.clientsSeeRhythm ? Math.max(1, policy.noticeDays) : 1,
        );
    }
  }
}
