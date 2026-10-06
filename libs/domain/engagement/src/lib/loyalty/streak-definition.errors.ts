import { DomainError } from '@creativo/domain/kernel';

/**
 * The field of the rule an error names: a path into `StreakDefinitionProps`
 * (and, for the head, into the schedule), spelled as the admin page keys
 * its controls (client-card revision 3 §2.6.2). A closed set, so a page
 * that words a refusal by its field cannot miss one.
 */
export type StreakDefinitionField =
  | 'id'
  | 'name.bg'
  | 'name.en'
  | 'version'
  | 'effectiveFrom'
  | 'qualifier.kind'
  | 'qualifier.serviceIds'
  | 'qualifier.categoryIds'
  | 'minGapDays'
  | 'bookingHold.maxDaysPastDue'
  | 'interval.kind'
  | 'interval.days'
  | 'interval.tolerancePct'
  | 'interval.minDays'
  | 'interval.maxDays'
  | 'interval.fallbackDays'
  | 'graceDays'
  | 'riskLeadDays'
  | 'protections.maxBanked'
  | 'protections.earnEvery'
  | 'protections.startWith'
  | 'excuses'
  | 'clientPause.maxDaysPerYear'
  | 'repair.windowDays'
  | 'repair.perYear'
  | 'onBreak'
  | 'scheduled.id'
  | 'scheduled.version'
  | 'scheduled.effectiveFrom'
  | 'scheduled.transition';

/**
 * Why a rhythm rule was refused. One class per reason below; each carries
 * the stable `code`, the `field` at fault and the `value` handed in, which
 * is all a page needs to name the control and all the callable needs to
 * answer `invalid` with its fields.
 */
export abstract class StreakDefinitionError extends DomainError {
  protected constructor(
    message: string,
    public readonly field: StreakDefinitionField,
    public readonly value: unknown,
    params: Record<string, unknown> = {},
  ) {
    super(message, { field, value, ...params });
  }
}

const shown = (value: unknown): string =>
  typeof value === 'string' ? `"${value}"` : String(value);

// ── The identity of a version ──────────────────────────────────────────────

export class StreakIdEmptyError extends StreakDefinitionError {
  override readonly code = 'engagement.streak_definition.id_empty' as const;
  constructor(value: unknown) {
    super('A rhythm rule needs an id', 'id', value);
  }
}

export class StreakNameEmptyError extends StreakDefinitionError {
  override readonly code = 'engagement.streak_definition.name_empty' as const;
  constructor(
    public readonly locale: 'bg' | 'en',
    value: unknown,
  ) {
    super(
      `A rhythm rule is named in both languages: "${locale}" is empty`,
      locale === 'bg' ? 'name.bg' : 'name.en',
      value,
      { locale },
    );
  }
}

/** Versions count from 1. */
export class StreakVersionNotPositiveError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.version_not_positive' as const;
  constructor(value: unknown) {
    super(
      `A rhythm rule's version is a positive whole number: ${shown(value)}`,
      'version',
      value,
    );
  }
}

/** The effective day is a Europe/Sofia calendar day, `YYYY-MM-DD`. */
export class StreakEffectiveDayInvalidError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.effective_day_invalid' as const;
  constructor(value: unknown) {
    super(
      `A rhythm rule takes effect on a calendar day: ${shown(value)}`,
      'effectiveFrom',
      value,
    );
  }
}

/** A choice outside its closed set: what a miss does, the kind of interval, the kind of qualifier, the transition. */
export class StreakUnknownOptionError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.unknown_option' as const;
  constructor(
    field:
      'onBreak' | 'interval.kind' | 'qualifier.kind' | 'scheduled.transition',
    value: unknown,
    public readonly options: readonly string[],
  ) {
    super(
      `The rhythm's ${field} is one of ${options.join(', ')}: ${shown(value)}`,
      field,
      value,
      { options },
    );
  }
}

// ── What counts ────────────────────────────────────────────────────────────

/** A list of services or categories names at least one, and no blank id. */
export class StreakQualifierEmptyError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.qualifier_empty' as const;
  constructor(
    field: 'qualifier.serviceIds' | 'qualifier.categoryIds',
    value: unknown,
  ) {
    super(
      `A rhythm that counts chosen ${
        field === 'qualifier.serviceIds' ? 'services' : 'categories'
      } names at least one`,
      field,
      value,
    );
  }
}

/** Close visits count once: whole days, within the range, shorter than the shortest interval. */
export class StreakMinGapOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.min_gap_out_of_range' as const;
  constructor(
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `The rhythm's minimum gap is ${min}–${max} whole days: ${shown(value)}`,
      'minGapDays',
      value,
      { min, max },
    );
  }
}

export class StreakBookingHoldOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.booking_hold_out_of_range' as const;
  constructor(
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `A booked visit holds the due date ${min}–${max} whole days past it: ${shown(value)}`,
      'bookingHold.maxDaysPastDue',
      value,
      { min, max },
    );
  }
}

// ── The interval ───────────────────────────────────────────────────────────

/** Every interval, fixed or a bound of the personal one, is whole days within the range. */
export class StreakIntervalOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.interval_out_of_range' as const;
  constructor(
    field:
      | 'interval.days'
      | 'interval.minDays'
      | 'interval.maxDays'
      | 'interval.fallbackDays',
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `The rhythm's ${field} is ${min}–${max} whole days: ${shown(value)}`,
      field,
      value,
      { min, max },
    );
  }
}

export class StreakToleranceOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.tolerance_out_of_range' as const;
  constructor(
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `The rhythm's tolerance is a whole percentage, ${min}–${max}: ${shown(value)}`,
      'interval.tolerancePct',
      value,
      { min, max },
    );
  }
}

/** The personal interval's floor sits above its ceiling. */
export class StreakClampInvertedError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.clamp_inverted' as const;
  constructor(
    public readonly minDays: number,
    public readonly maxDays: number,
  ) {
    super(
      `The personal interval's shortest (${minDays}) is above its longest (${maxDays})`,
      'interval.minDays',
      minDays,
      { minDays, maxDays },
    );
  }
}

/** A new client's interval sits inside the personal one's bounds. */
export class StreakFallbackOutsideClampError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.fallback_outside_clamp' as const;
  constructor(
    value: number,
    public readonly minDays: number,
    public readonly maxDays: number,
  ) {
    super(
      `A new client's interval (${value}) is within ${minDays}–${maxDays} days`,
      'interval.fallbackDays',
      value,
      { minDays, maxDays },
    );
  }
}

// ── Grace and the staff's cue ──────────────────────────────────────────────

export class StreakGraceOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.grace_out_of_range' as const;
  constructor(
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `The rhythm's grace is ${min}–${max} whole days: ${shown(value)}`,
      'graceDays',
      value,
      { min, max },
    );
  }
}

/** A grace as long as the interval is a second interval, not a grace. */
export class StreakGraceNotShorterThanIntervalError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.grace_not_shorter_than_interval' as const;
  constructor(
    value: number,
    public readonly shortestIntervalDays: number,
  ) {
    super(
      `The rhythm's grace (${value}) is shorter than its shortest interval (${shortestIntervalDays})`,
      'graceDays',
      value,
      { shortestIntervalDays },
    );
  }
}

/** The staff's cue: whole days, within the range, shorter than the shortest interval. */
export class StreakRiskLeadOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.risk_lead_out_of_range' as const;
  constructor(
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `The rhythm's cue leads the due date by ${min}–${max} whole days: ${shown(value)}`,
      'riskLeadDays',
      value,
      { min, max },
    );
  }
}

// ── Protections, excuses, the pause, the way back ──────────────────────────

export class StreakProtectionsOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.protections_out_of_range' as const;
  constructor(
    field:
      | 'protections.maxBanked'
      | 'protections.earnEvery'
      | 'protections.startWith',
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `The rhythm's ${field} is a whole number, ${min}–${max}: ${shown(value)}`,
      field,
      value,
      { min, max },
    );
  }
}

/** Nobody starts with more protections than the reserve holds. */
export class StreakStartWithAboveCapError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.start_with_above_cap' as const;
  constructor(
    value: number,
    public readonly maxBanked: number,
  ) {
    super(
      `A rhythm starts with ${value} protections, above its reserve of ${maxBanked}`,
      'protections.startWith',
      value,
      { maxBanked },
    );
  }
}

export class StreakUnknownExcuseError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.unknown_excuse' as const;
  constructor(value: unknown) {
    super(`The rhythm knows no excuse ${shown(value)}`, 'excuses', value);
  }
}

export class StreakClientPauseOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.client_pause_out_of_range' as const;
  constructor(
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `A client pauses the rhythm ${min}–${max} whole days a year: ${shown(value)}`,
      'clientPause.maxDaysPerYear',
      value,
      { min, max },
    );
  }
}

export class StreakRepairOutOfRangeError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_definition.repair_out_of_range' as const;
  constructor(
    field: 'repair.windowDays' | 'repair.perYear',
    value: unknown,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `The rhythm's ${field} is a whole number, ${min}–${max}: ${shown(value)}`,
      field,
      value,
      { min, max },
    );
  }
}

// ── The head: the rule in force and the one that waits ─────────────────────

/** Both halves of a head are versions of ONE rule. */
export class StreakScheduleIdMismatchError extends StreakDefinitionError {
  override readonly code = 'engagement.streak_schedule.id_mismatch' as const;
  constructor(
    public readonly currentId: string,
    scheduledId: string,
  ) {
    super(
      `The scheduled rule ${shown(scheduledId)} is not a version of ${shown(currentId)}`,
      'scheduled.id',
      scheduledId,
      { currentId },
    );
  }
}

/** What waits was published after what is in force. */
export class StreakVersionNotRisingError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_schedule.version_not_rising' as const;
  constructor(
    public readonly currentVersion: number,
    scheduledVersion: number,
  ) {
    super(
      `The scheduled version (${scheduledVersion}) does not follow the one in force (${currentVersion})`,
      'scheduled.version',
      scheduledVersion,
      { currentVersion },
    );
  }
}

/** What waits takes effect later than what is in force did. */
export class StreakScheduledNotAfterCurrentError extends StreakDefinitionError {
  override readonly code =
    'engagement.streak_schedule.scheduled_not_after_current' as const;
  constructor(
    public readonly currentEffectiveFrom: string,
    scheduledEffectiveFrom: string,
  ) {
    super(
      `The scheduled rule takes effect on ${scheduledEffectiveFrom}, not after ${currentEffectiveFrom}`,
      'scheduled.effectiveFrom',
      scheduledEffectiveFrom,
      { currentEffectiveFrom },
    );
  }
}
